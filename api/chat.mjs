/* POST /api/chat -> Server-Sent Events.
   Events: meta {sid,t,ref,lang,message_id} · text {d} · card {id,kind,data} · chips {items}
           notice {kind} · error {code,message} · done {message_id,remaining}
   Text is released sentence by sentence after the number/claims guardrail. */
import { streamText, isStepCount } from 'ai';
import { waitUntil } from '@vercel/functions';
import { readJson, json, errorResponse, sseStream, ipHash, clientIp, clean, HttpError } from './_lib/http.mjs';
import { db } from './_lib/db.mjs';
import { loadProject } from './_lib/project.mjs';
import { ensureVisitor, storeEvents } from './_lib/leads.mjs';
import { verifyTurnstile } from './_lib/turnstile.mjs';
import { activeBookingForLead, bookingLabel } from './_lib/bookings.mjs';
import { createAlert } from './_lib/alerts.mjs';
import { createSession, loadSession, checkLimits, history, priorToolOutputs, budgetLeft, spend, costMicros, LIMITS } from './_lib/chat/session.mjs';
import { detectLang, redact } from './_lib/chat/lang.mjs';
import { getModel, modelSpecFor, providerOptions } from './_lib/chat/model.mjs';
import { staticPrompt, contextMessage } from './_lib/chat/prompt.mjs';
import { makeTools, humanCard } from './_lib/chat/tools.mjs';
import { SentenceGuard, buildAllowed, allowedFromTool, extractNumbers, SAFE_LINES } from './_lib/chat/guardrail.mjs';
import { chipsFor } from './_lib/chat/chips.mjs';

const UUID = /^[0-9a-f-]{36}$/i;
const BUSY = {
  en: 'Our assistant is taking a short break. The sales team can help you right away:',
  ar: 'المساعد في استراحة قصيرة. يمكن لفريق المبيعات مساعدتك الآن:',
  hi: 'हमारा असिस्टेंट थोड़ी देर के लिए उपलब्ध नहीं है। सेल्स टीम अभी आपकी मदद कर सकती है:',
  'hi-Latn': 'Assistant abhi thodi der ke liye available nahi hai. Sales team abhi madad kar sakti hai:',
};

export async function POST(request) {
  let body, project, session, token, visitor, ipH;
  try {
    // not set up yet on this deployment: the site tells the visitor to reach the sales team instead
    if (!process.env.DATABASE_URL || !hasModelKey() || (process.env.VERCEL && (!process.env.CHAT_TOKEN_SECRET || !process.env.TURNSTILE_SECRET))) {
      throw new HttpError(503, 'not_configured', 'The assistant is being set up.');
    }
    ipH = ipHash(request);   // needs the secret, so only after the configuration check (inside the error handling)
    body = await readJson(request, 24 * 1024);
    const text = clean(body.text, LIMITS.maxChars + 1);
    if (!text) throw new HttpError(400, 'empty');
    if (text.length > LIMITS.maxChars) throw new HttpError(413, 'too_long', 'Please keep messages under 1000 characters.');
    if (!UUID.test(body.client_id || '')) throw new HttpError(400, 'bad_client_id');
    project = await loadProject(clean(body.project, 60) || 'aurelle');
    if (!project.facts) throw new HttpError(503, 'no_facts', 'The assistant is not configured yet.');

    if (body.sid) {
      session = await loadSession(body.sid, body.t, project.id);
      token = body.t;
      [visitor] = await db()`select * from visitors where id = ${session.visitor_id}`;
    } else {
      await verifyTurnstile(body.turnstile, clientIp(request));
      visitor = await ensureVisitor(project.id, body.anon_id, { firstTouch: body.attribution?.first, lastTouch: body.attribution?.last, sessions7d: body.sessions_7d });
      ({ session, token } = await createSession({ project, visitor, ipHash: ipH, lang: detectLang(text) }));
    }
    await checkLimits(session, ipH);
    if (Array.isArray(body.events) && body.events.length) await storeEvents(project.id, visitor.id, session.id, body.events);
    return stream({ request, body, text, project, session, token, visitor, ipH });
  } catch (e) {
    return errorResponse(e);
  }
}

function stream({ request, body, text, project, session, token, visitor, ipH }) {
  const sse = sseStream();
  const sql = db();
  const started = Date.now();
  const lang = detectLang(text, session.lang || 'en');
  const ping = setInterval(() => sse.comment('ping'), 15000);

  const work = (async () => {
    const { text: redacted, found } = redact(text);
    const [userMsg] = await sql`insert into messages(session_id, project_id, role, content, content_redacted, client_id)
      values (${session.id}, ${project.id}, 'user', ${text}, ${redacted !== text ? redacted : null}, ${body.client_id})
      on conflict (session_id, client_id) do nothing returning id`;
    if (!userMsg) { sse.send('error', { code: 'duplicate' }); return; }
    sse.send('meta', { sid: session.id, t: token, ref: session.ref_code, lang });

    const leadId = session.lead_id || visitor.lead_id || null;
    const active = await activeBookingForLead(leadId, session.id);
    const booking = active ? { kind: active.kind, label: bookingLabel(active.starts_at, project.timezone, lang), id: active.id } : null;
    const page = sanitizePage(body.context, project);

    if ((await budgetLeft()) <= 0) {
      sse.send('text', { d: BUSY[lang] || BUSY.en });
      const card = { id: 'busy', kind: 'human', data: humanCard(project, session) };
      sse.send('card', card);
      await sql`insert into messages(session_id, project_id, role, content, cards) values (${session.id}, ${project.id}, 'assistant', ${BUSY[lang] || BUSY.en}, ${JSON.stringify([card])})`;
      await createAlert({ projectId: project.id, kind: 'cap', payload: { note: 'Daily assistant budget reached' }, email: true }).catch(() => {});
      sse.send('done', {});
      return;
    }

    // numbers the reply may contain: facts, this session's earlier tool results, small counts from the visitor
    const userCounts = extractNumbers(text).numbers.filter((n) => n.cls === 'count').map((n) => n.value);
    const allowed = buildAllowed({
      factNumbers: project.allowed_numbers || [],
      factTexts: (project.facts.facts || []).map((f) => f.text),
      toolOutputs: await priorToolOutputs(session.id),
      extra: userCounts,
    });
    const contact = project.settings?.contact || {};
    const guardCtx = {
      allowed,
      unitCodeRe: project.settings?.unit_code_pattern ? new RegExp(project.settings.unit_code_pattern) : null,
      forbidden: project.facts.forbidden_claims || [],
      pending: project.facts.pending || [],
      phones: [contact.phone, contact.whatsapp].filter(Boolean),
    };
    const guard = new SentenceGuard(guardCtx, lang);
    const state = { toolOutputs: [], cards: [], tools: [] };
    const toolCtx = {
      project, session: { ...session, lead_id: leadId }, lang, page, booking, state, guard: guardCtx,
      emit: (card) => { allowedFromTool(card.data, allowed); sse.send('card', card); },
    };
    const messages = [
      ...(await history(session.id)).slice(0, -1),            // the new user message is added below
      { role: 'system', content: contextMessage({ project, lang, page, captured: { contact: Boolean(leadId) }, booking, piiRemoved: found.phone || found.email || found.id }) },
      { role: 'user', content: redacted },
    ];

    let usage = { inputTokens: 0, outputTokens: 0 };
    let reported = false;
    let emitted = false;
    let modelSpec = modelSpecFor(lang);
    const run = async (spec) => {
      const { model, provider } = await getModel(spec);
      const result = streamText({
        model, instructions: staticPrompt(project), messages, allowSystemInMessages: true,
        tools: makeTools(toolCtx), stopWhen: isStepCount(3),
        maxOutputTokens: 1200, temperature: 0.3,
        providerOptions: providerOptions(provider),
        abortSignal: request.signal,
      });
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          const out = guard.push(part.text);
          if (out) { sse.send('text', { d: out }); emitted = true; }
        } else if (part.type === 'tool-result') {
          allowedFromTool(part.output, allowed);
          emitted = true;
        } else if (part.type === 'tool-error') {
          console.error('tool error', part.toolName, part.error);
        } else if (part.type === 'error') {
          throw part.error;
        } else if (part.type === 'finish') {
          // add, not replace: a fallback run's tokens come on top of the failed primary's
          usage = { inputTokens: usage.inputTokens + (part.totalUsage?.inputTokens || 0), outputTokens: usage.outputTokens + (part.totalUsage?.outputTokens || 0) };
          reported = true;
        }
      }
    };

    try {
      try { await run(modelSpec); } catch (e) {
        if (emitted || !process.env.CHAT_MODEL_FALLBACK || request.signal?.aborted) throw e;
        console.error('primary model failed, using fallback:', e?.message);
        modelSpec = process.env.CHAT_MODEL_FALLBACK;
        await run(modelSpec);
      }
    } catch (e) {
      if (!request.signal?.aborted) console.error('chat model error', e);
      const tail = guard.end();
      if (tail) sse.send('text', { d: tail });
      const card = { id: 'err', kind: 'human', data: humanCard(project, session) };
      state.cards.push(card);
      sse.send('card', card);
      sse.send('error', { code: 'model_unavailable', message: 'Sorry, I could not answer just now. The sales team can help right away.' });
    }

    const tail = guard.end();
    if (tail) sse.send('text', { d: tail });
    let reply = guard.released.trim();
    if (!reply && !state.cards.length) {
      reply = SAFE_LINES[lang] || SAFE_LINES.en;
      sse.send('text', { d: reply });
    }
    if (guard.violations.length) sse.send('notice', { kind: 'guardrail' });
    if (guard.violations.length >= 2 && !state.cards.some((c) => c.kind === 'human')) {
      const card = { id: 'gh', kind: 'human', data: humanCard(project, session) };
      state.cards.push(card);
      sse.send('card', card);
    }

    const chips = chipsFor({ lang, tools: state.tools, booked: Boolean(booking), contact: Boolean(leadId), unit: page?.unit });
    sse.send('chips', { items: chips });

    // a visitor who disconnects mid-reply still pays: estimate when the provider never reported usage
    if (!reported) usage = { inputTokens: Math.ceil((staticPrompt(project).length + JSON.stringify(messages).length) / 4), outputTokens: Math.ceil(guard.released.length / 3) + 300 };
    const micros = costMicros(usage);
    const [msg] = await sql`insert into messages(session_id, project_id, role, content, cards, tool_calls, guardrail, tokens_in, tokens_out, latency_ms)
      values (${session.id}, ${project.id}, 'assistant', ${reply}, ${state.cards.length ? JSON.stringify(state.cards) : null},
        ${state.toolOutputs.length ? JSON.stringify(state.tools.map((name, i) => ({ name, output: state.toolOutputs[i] }))) : null},
        ${guard.violations.length ? JSON.stringify(guard.violations) : null}, ${usage.inputTokens}, ${usage.outputTokens}, ${Date.now() - started})
      returning id`;
    await sql`update chat_sessions set last_message_at = now(), user_msgs = user_msgs + 1, lang = ${lang}, model = ${modelSpec},
        tokens_in = tokens_in + ${usage.inputTokens}, tokens_out = tokens_out + ${usage.outputTokens}, cost_micros = cost_micros + ${micros},
        guardrail_hits = guardrail_hits + ${guard.violations.length}, lead_id = coalesce(lead_id, ${leadId}), status = 'open'
      where id = ${session.id}`;
    await spend(micros);
    if (state.tools.includes('get_unit') || state.tools.includes('search_units')) {
      await storeEvents(project.id, visitor.id, session.id, [{ type: 'price_shown', props: { units: state.toolOutputs.flatMap((o) => o.shown?.map((u) => u.code) || (o.code ? [o.code] : [])).slice(0, 6).join(',') } }]);
    }
    sse.send('done', { message_id: String(msg.id), remaining: Math.max(0, LIMITS.userMessagesPerSession - session.user_msgs - 1) });
  })();

  const finished = work.catch((e) => {
    console.error('chat stream failed', e);
    sse.send('error', { code: 'server_error', message: 'Something went wrong. Please try again.' });
  }).finally(() => { clearInterval(ping); sse.close(); });
  try { waitUntil(finished); } catch { /* local dev: nothing to extend */ }
  return sse.response;
}

/* Only trust the shape of the page context, never its text. */
function sanitizePage(ctx = {}, project) {
  if (!ctx || typeof ctx !== 'object') return null;
  const re = project.settings?.unit_code_pattern ? new RegExp('^' + project.settings.unit_code_pattern.replace(/\\b/g, '') + '$') : /^\d{2}-[A-Z0-9]{1,2}$/;
  const unit = re.test(String(ctx.unit || '')) ? String(ctx.unit) : null;
  const level = Number.isInteger(ctx.level) && ctx.level > 0 && ctx.level < 200 ? ctx.level : null;
  const section = /^[a-z-]{2,20}$/.test(String(ctx.section || '')) ? ctx.section : null;
  return { unit, unit_name: unit ? clean(ctx.unit_name, 60) : null, level, is3d: Boolean(ctx.is3d), section };
}

export function GET() { return json({ ok: false, error: 'method_not_allowed' }, 405); }

function hasModelKey() {
  const p = (process.env.CHAT_MODEL || 'groq:').split(':')[0];
  return p === 'mock' ? !process.env.VERCEL
    : Boolean({ groq: process.env.GROQ_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY, google: process.env.GOOGLE_GENERATIVE_AI_API_KEY }[p]);
}
