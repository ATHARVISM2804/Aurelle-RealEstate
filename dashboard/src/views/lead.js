/* Lead detail: profile | unified timeline | AI summary + why-hot + next action. */
import { html, Top, Icon, Band, Stage, Avatar, Tag, Sparkline, Menu, toast, ask, ago, when, budgetText, fieldVal, sourceLabel, STAGES, stageLabel, duration } from '../ui.js';
import { useState, useEffect, useRef } from '../../vendor/hooks.mjs';
import { api, qs } from '../api.js';
import { navigate } from '../main.js';

const EVENT_TEXT = {
  section_reached: (p) => `Reached the ${p.section} section`, unit_opened: (p) => `Opened ${p.code} in the 3D explorer`, level_switched: (p) => `Browsed level ${p.level}`,
  toggle_3d: (p) => `Viewed ${p.code} in 3D`, room_opened: (p) => `Stepped inside the ${p.room || 'room'} of ${p.code}`, explorer_opened: (p) => `Opened the explorer at level ${p.level}`,
  explorer_closed: () => 'Closed the explorer', brochure_downloaded: () => 'Downloaded the brochure', enquiry_submitted: (p) => `Sent the ${p.kind || 'enquiry'} form`,
  cta_whatsapp: () => 'Tapped WhatsApp', chat_opened: () => 'Opened the AI assistant', chat_closed: () => 'Closed the AI assistant', unit_card_3d: (p) => `Opened ${p.code} in 3D from the chat`,
  price_shown: (p) => `Saw prices for ${p.units || 'units'}`, booking_created: (p) => `Booked a ${p.kind === 'video_call' ? 'video call' : 'site visit'}`, human_requested: () => 'Asked for a person', session_start: () => 'Started a visit',
};
const EVENT_ICON = { unit_opened: 'cube', toggle_3d: 'cube', unit_card_3d: 'cube', room_opened: 'cube', brochure_downloaded: 'doc', booking_created: 'calendar', human_requested: 'phone', price_shown: 'eye', cta_whatsapp: 'whatsapp' };
const FIELD_LABELS = [['budget', 'Budget'], ['configuration', 'Looking for'], ['unit_interest', 'Units'], ['timeline', 'Timeline'], ['purpose', 'Purpose'], ['financing', 'Financing'], ['decision_makers', 'Decides with'], ['preferred_contact', 'Prefers'], ['objections', 'Concerns']];
const PURPOSE = { end_use: 'To live in', investor: 'Investment', both: 'Live + invest' };
const FIN = { cash: 'Cash', mortgage_preapproved: 'Mortgage pre-approved', needs_mortgage: 'Needs a mortgage' };

export function LeadView({ ctx, id }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [team, setTeam] = useState([]);
  const [filter, setFilter] = useState('all');
  const [menu, setMenu] = useState(null);
  const [note, setNote] = useState('');
  const noteRef = useRef();
  const stageBtn = useRef(), ownerBtn = useRef();

  const load = () => api('leads/' + id).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); api('team?' + qs({ project: ctx.projectId })).then((r) => setTeam(r.members)).catch(() => {}); }, [id]);
  useEffect(() => { const on = () => load(); addEventListener('data-changed', on); return () => removeEventListener('data-changed', on); }, [id]);
  useEffect(() => {
    const on = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;
      if (e.key === 'Escape') navigate('/');
      else if (e.key === 'n') { e.preventDefault(); noteRef.current?.focus(); }
      else if (e.key === 's' && stageBtn.current) { e.preventDefault(); openStage(); }
      else if (e.key === 'e' && ownerBtn.current) { e.preventDefault(); openOwner(); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [d, team]);

  if (err) return html`<${Top} title="Lead" /><div class="empty"><b>Can’t open this lead</b>${err}</div>`;
  if (!d) return html`<${Top} title="…" /><section class="page"><div class="skeleton" style=${{ width: '40%', height: '30px' }}></div></section>`;
  const l = d.lead, f = l.fields || {}, s = d.summary?.data, canEdit = ctx.role !== 'viewer';
  const reasons = l.score_reasons || {};

  const patch = async (body, msg) => {
    try { const r = await api('leads/' + id, { method: 'PATCH', body }); setD((x) => ({ ...x, lead: { ...x.lead, ...r.lead } })); if (msg) toast(msg); load(); }
    catch (e) { toast(e.message); }
  };
  const openStage = () => setMenu({ anchor: stageBtn.current, items: STAGES.map(([k, label]) => ({ label, onClick: () => {
    if (k === 'lost') ask({ title: 'Mark as lost', label: 'What happened?', placeholder: 'Bought elsewhere, budget changed, not reachable…', ok: 'Mark lost' }).then((why) => why && patch({ stage: 'lost', lost_reason: why }, 'Marked lost'));
    else patch({ stage: k }, 'Stage: ' + label);
  } })) });
  const openOwner = () => setMenu({ anchor: ownerBtn.current, items: [...team.map((m) => ({ label: m.name + (m.id === ctx.me.user.id ? ' (me)' : ''), onClick: () => patch({ owner_id: m.id }, 'Assigned to ' + m.name) })), { label: 'Unassign', onClick: () => patch({ owner_id: null }, 'Unassigned') }] });
  const reached = async (channel) => { try { await api(`leads/${id}/touch`, { method: 'POST', body: { channel } }); load(); } catch (e) { /* the link still opens */ } };
  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    try { await api(`leads/${id}/notes`, { method: 'POST', body: { body: note } }); setNote(''); toast('Note added'); load(); } catch (x) { toast(x.message); }
  };
  const editField = async (key, label) => {
    const current = fieldVal(f[key]);
    const v = await ask({ title: 'Edit ' + label.toLowerCase(), label: 'Your edit is kept even when the AI learns something new.', value: Array.isArray(current) ? current.join(', ') : typeof current === 'object' && current ? (current.text || '') : current || '' });
    if (v == null) return;
    patch({ fields: { [key]: key === 'unit_interest' ? { value: v.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) } : v } }, label + ' updated');
  };

  const firstName = (l.name || '').split(' ')[0] || 'there';
  const waText = s?.next_best_action && /floor plan|visit|price sheet/i.test(s.next_best_action)
    ? `Hi ${firstName}, this is ${ctx.me.user.name.split(' ')[0]} from ${d.project.name}. Thanks for your interest${fieldVal(f.configuration) ? ' in the ' + fieldVal(f.configuration) + ' homes' : ''}. ${/visit/i.test(s.next_best_action) ? 'When would suit you to see the residence in person?' : 'May I share the floor plans and the latest price sheet here?'}`
    : `Hi ${firstName}, this is ${ctx.me.user.name.split(' ')[0]} from ${d.project.name}. Thanks for your enquiry — how can I help?`;
  const wa = l.phone_e164 ? `https://wa.me/${l.phone_e164.replace(/\D/g, '')}?text=${encodeURIComponent(waText)}` : null;
  const visit = d.bookings.find((b) => ['confirmed', 'reminded', 'checked_in'].includes(b.status));

  /* ---------- unified timeline ---------- */
  const items = [];
  for (const e of d.events) items.push({ at: e.at, kind: 'site', icon: EVENT_ICON[e.type] || 'eye', title: (EVENT_TEXT[e.type] || ((x) => x.type))(e.props || e), hot: ['booking_created', 'human_requested'].includes(e.type) });
  const bySession = {};
  for (const m of d.messages) (bySession[m.session_id] ||= []).push(m);
  for (const sess of d.sessions) {
    const msgs = bySession[sess.id] || [];
    if (msgs.length) items.push({ at: msgs[0].created_at, kind: 'chat', icon: 'chat', title: `Chat with the AI assistant · ${msgs.filter((m) => m.role === 'user').length} messages`, sub: `Ref ${sess.ref_code}${sess.lang && sess.lang !== 'en' ? ' · ' + sess.lang : ''}${sess.guardrail_hits ? ` · ${sess.guardrail_hits} answer${sess.guardrail_hits > 1 ? 's' : ''} held back by the price guard` : ''}`, msgs });
  }
  for (const b of d.bookings) items.push({ at: b.created_at, kind: 'visit', icon: 'calendar', hot: true, title: `${b.kind === 'video_call' ? 'Video call' : 'Site visit'} for ${when(b.starts_at, ctx.tz)}`, sub: `${b.status.replace('_', ' ')}${b.unit_code ? ' · ' + b.unit_code : ''}${b.outcome_note ? ' · ' + b.outcome_note : ''}` });
  for (const n of d.notes) items.push({ at: n.created_at, kind: 'note', icon: 'note', title: n.author + ' added a note', body: n.body });
  for (const h of d.history) if (h.diff?.stage) items.push({ at: h.at, kind: 'note', icon: 'arrow', title: `${h.actor || 'Someone'} moved this lead to ${stageLabel(h.diff.stage[1])}` });
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  const shown = items.filter((i) => filter === 'all' || i.kind === filter);

  const scoreSeries = d.scores.map((x) => x.score);
  const groups = reasons.groups || {};

  return html`
    <${Top} title=${html`<a href="/dashboard" class="icon-btn" style=${{ display: 'inline-grid', verticalAlign: 'middle', marginRight: '6px' }} aria-label="Back to inbox"><${Icon} name="back" /></a>Lead`} />
    <section class="page">
      <div class="lead-head">
        <${Avatar} name=${l.name} lg />
        <div>
          <h2>${l.name || l.phone_e164 || 'Unnamed lead'}</h2>
          <div class="lead-head__meta">
            <${Band} band=${l.band} score=${l.score} />
            <button class="btn btn--sm" ref=${stageBtn} disabled=${!canEdit} onClick=${openStage} title="Change stage (s)"><${Stage} stage=${l.stage} /></button>
            <button class="btn btn--sm" ref=${ownerBtn} disabled=${!canEdit} onClick=${openOwner} title="Assign (e)"><${Avatar} name=${d.owner?.name} />${d.owner?.name || 'Unassigned'}</button>
            <span class="muted">${sourceLabel(l.source)}${l.campaign ? ' · ' + l.campaign : ''} · arrived ${ago(l.created_at)}</span>
            ${l.first_response_at ? html`<span class="pill">First reply in ${duration((new Date(l.first_response_at) - new Date(l.created_at)) / 1000)}</span>` : html`<span class="pill pill--err">No reply yet</span>`}
            ${l.is_broker ? html`<span class="pill">Broker / channel partner</span>` : ''}
          </div>
        </div>
        <div class="lead-head__actions">
          ${wa ? html`<a class="btn btn--wa" href=${wa} target="_blank" rel="noopener" onClick=${() => reached('whatsapp')}><${Icon} name="whatsapp" />WhatsApp</a>` : ''}
          ${l.phone_e164 ? html`<a class="btn" href=${'tel:' + l.phone_e164} onClick=${() => reached('call')}><${Icon} name="phone" />${l.phone_e164}</a>` : ''}
          ${l.email ? html`<a class="btn" href=${'mailto:' + l.email} onClick=${() => reached('email')}><${Icon} name="mail" />Email</a>` : ''}
        </div>
      </div>

      <div class="cols">
        <!-- profile -->
        <div class="side-stack">
          <div class="card"><div class="card__h"><span class="eyebrow">What we know</span></div><div class="card__b"><dl class="fields">
            ${FIELD_LABELS.map(([k, label]) => {
              const raw = f[k];
              let v = fieldVal(raw);
              if (k === 'budget' && raw) v = budgetText(raw, ctx.currency);
              if (k === 'purpose') v = PURPOSE[v] || v;
              if (k === 'financing') v = FIN[v] || v;
              if (Array.isArray(v)) v = v.join(', ');
              return html`<div class="field-row"><dt>${label}</dt><dd>${v || html`<span class="muted">—</span>`} <${Tag} source=${raw?.source} />
                ${canEdit && k !== 'objections' ? html`<button class="icon-btn edit" aria-label=${'Edit ' + label} onClick=${() => editField(k, label)}><${Icon} name="note" size="13" /></button>` : ''}</dd></div>`;
            })}
          </dl></div></div>
          <div class="card"><div class="card__h"><span class="eyebrow">Contact & consent</span></div><div class="card__b"><dl class="fields">
            <div class="field-row"><dt>Phone</dt><dd class="num">${l.phone_e164 || '—'}</dd></div>
            <div class="field-row"><dt>Email</dt><dd>${l.email || '—'}</dd></div>
            <div class="field-row"><dt>Language</dt><dd>${{ en: 'English', ar: 'Arabic', hi: 'Hindi', 'hi-Latn': 'Hinglish' }[l.lang] || l.lang || '—'}</dd></div>
            ${['call', 'whatsapp', 'email', 'marketing'].map((p) => { const c = d.consents.find((x) => x.purpose === p); return html`<div class="field-row"><dt>${{ call: 'Calls', whatsapp: 'WhatsApp', email: 'Email', marketing: 'Marketing' }[p]}</dt><dd>${c ? (c.granted ? html`<span class="pill pill--ok">Allowed</span>` : html`<span class="pill pill--err">Not allowed</span>`) : html`<span class="muted">Not asked</span>`}</dd></div>`; })}
          </dl></div></div>
        </div>

        <!-- timeline -->
        <div class="card"><div class="card__b">
          ${canEdit ? html`<form class="note-box" onSubmit=${addNote}><textarea class="input" ref=${noteRef} rows="2" placeholder="Add a note for the team…  (n)" value=${note} onInput=${(e) => setNote(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(e); }}></textarea>
            ${note ? html`<div style=${{ display: 'flex', justifyContent: 'flex-end' }}><button class="btn btn--primary btn--sm">Add note</button></div>` : ''}</form>` : ''}
          <div class="tl-filters" role="toolbar">${[['all', 'Everything'], ['chat', 'Conversations'], ['site', 'On the website'], ['visit', 'Visits'], ['note', 'Notes']].map(([k, label]) => html`<button aria-pressed=${filter === k} onClick=${() => setFilter(k)}>${label}</button>`)}</div>
          <div class="timeline">
            ${shown.length ? shown.map((it) => html`<div class="tl-item">
              <span class=${'tl-ico' + (it.hot ? ' hot' : '')}><${Icon} name=${it.icon} /></span>
              <div class="tl-body"><div><b>${it.title}</b><span class="when" title=${new Date(it.at).toLocaleString()}>${ago(it.at)}</span></div>
                ${it.sub ? html`<p>${it.sub}</p>` : ''}${it.body ? html`<p style=${{ whiteSpace: 'pre-wrap', color: 'var(--text)' }}>${it.body}</p>` : ''}
                ${it.msgs ? html`<${Transcript} msgs=${it.msgs} />` : ''}</div></div>`) : html`<p class="muted">No activity yet.</p>`}
          </div>
        </div></div>

        <!-- intelligence -->
        <div class="side-stack">
          <div class="card summary"><div class="card__h"><span class="eyebrow"><${Icon} name="spark" size="11" /> AI summary</span>${d.summary ? html`<small class="muted">${ago(d.summary.created_at)}</small>` : ''}</div><div class="card__b">
            ${s ? html`${(s.summary || []).map((line) => html`<p>${line}</p>`)}
              ${fieldVal(s.questions_asked)?.length ? html`<p class="eyebrow" style=${{ marginTop: '14px' }}>Asked about</p><div class="chips-inline" style=${{ marginTop: '6px' }}>${fieldVal(s.questions_asked).slice(0, 5).map((x) => html`<span class="pill" title=${x}>${x.length > 42 ? x.slice(0, 40) + '…' : x}</span>`)}</div>` : ''}
              ${s.next_best_action ? html`<div class="nba"><span class="eyebrow">Next best action</span><b>${s.next_best_action}</b>
                ${wa ? html`<a class="btn btn--wa btn--sm" href=${wa} target="_blank" rel="noopener" onClick=${() => reached('whatsapp')} style=${{ justifySelf: 'start' }}><${Icon} name="whatsapp" />Send on WhatsApp</a>` : ''}</div>` : ''}`
              : html`<p class="muted">A summary appears after the visitor has chatted with the assistant.</p>`}
          </div></div>

          <div class="card"><div class="card__h"><span class="eyebrow">Why ${l.band}</span><${Band} band=${l.band} score=${l.score} /></div><div class="card__b">
            <div class="why">${(reasons.for || []).map((r) => html`<span title=${r.group}><b>+${r.points}</b>${r.label}</span>`)}${(reasons.against || []).map((r) => html`<span class="neg"><b>${r.points}</b>${r.label}</span>`)}
              ${!(reasons.for || []).length && !(reasons.against || []).length ? html`<span class="muted" style=${{ background: 'none', padding: 0 }}>Not enough signals yet.</span>` : ''}</div>
            <div class="groups">${[['fit', 'Fit', 35], ['intent', 'Intent', 45], ['reach', 'Reachable', 20]].map(([k, label, max]) => html`<div class="grp"><span>${label}</span><span class="bar"><i style=${{ width: Math.max(0, (groups[k] || 0) / max * 100) + '%' }}></i></span><span class="num">${groups[k] || 0}/${max}</span></div>`)}</div>
            ${scoreSeries.length > 1 ? html`<div style=${{ marginTop: '14px' }}><span class="eyebrow">Score over time</span><${Sparkline} values=${scoreSeries} color=${l.band === 'hot' ? 'var(--hot)' : 'var(--text)'} /></div>` : ''}
          </div></div>

          ${visit ? html`<div class="card visit-card"><div class="card__b"><span class="eyebrow">${visit.kind === 'video_call' ? 'Video call' : 'Site visit'}${visit.unit_code ? ' · ' + visit.unit_code : ''}</span>
            <div class="when">${when(visit.starts_at, ctx.tz)}</div><span class="muted">${ago(visit.starts_at)} · ${visit.status.replace('_', ' ')}</span>
            ${canEdit ? html`<div class="outcomes">${[['checked_in', 'Checked in'], ['done', 'Done'], ['no_show', 'No-show'], ['cancelled', 'Cancel']].map(([st, label]) => html`<button class="btn btn--sm" onClick=${async () => { try { await api('bookings/' + visit.id, { method: 'PATCH', body: { status: st } }); toast('Visit: ' + label); load(); } catch (e) { toast(e.message); } }}>${label}</button>`)}</div>` : ''}
          </div></div>` : ''}
          ${l.stage === 'lost' && l.lost_reason ? html`<div class="card"><div class="card__b"><span class="eyebrow">Lost because</span><p style=${{ marginTop: '6px' }}>${l.lost_reason}</p></div></div>` : ''}
        </div>
      </div>
    </section>
    ${menu ? html`<${Menu} ...${menu} onClose=${() => setMenu(null)} />` : ''}`;
}

function Transcript({ msgs }) {
  const [open, setOpen] = useState(msgs.length <= 6);
  const list = open ? msgs : msgs.slice(-4);
  return html`<div class="chat">
    ${!open ? html`<button class="btn btn--ghost btn--sm" onClick=${() => setOpen(true)} style=${{ justifySelf: 'center' }}>Show all ${msgs.length} messages</button>` : ''}
    ${list.map((m) => html`<div class=${'chat__m chat__m--' + (m.role === 'agent' ? 'assistant' : m.role)} id=${'m' + m.id}>${m.content || ''}
      ${m.cards?.length ? html`<small class="chat__card">Shown: ${m.cards.map((c) => c.kind === 'unit' ? 'unit ' + c.data?.code : c.kind === 'units' ? 'units ' + (c.data?.units || []).map((u) => u.code).join(', ') : c.kind.replace('_', ' ')).join(' · ')}</small>` : ''}
      ${m.guardrail ? html`<small title=${m.guardrail.map((g) => g.original).join('\n')}>Price guard replaced ${m.guardrail.length} sentence${m.guardrail.length > 1 ? 's' : ''}</small>` : ''}
    </div>`)}
  </div>`;
}
