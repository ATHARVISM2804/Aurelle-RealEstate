/* Assistant tools. Executors read the database and emit cards straight to the visitor; the model
   only receives a compact summary. There is deliberately no tool that books or stores contact
   details: those go through the deterministic UI with consent and a human check. */
import { tool } from 'ai';
import { z } from 'zod';
import { searchUnits, getUnit } from '../inventory.mjs';
import { loadSlots } from '../bookings.mjs';
import { createAlert } from '../alerts.mjs';
import { db } from '../db.mjs';
import { checkSentence } from './guardrail.mjs';

const KINDS = ['site_visit', 'video_call'];

/* ctx: { project, session, lang, emit(card), state: { toolOutputs: [], cards: [], tools: [] } } */
export function makeTools(ctx) {
  const { project } = ctx;
  const facts = project.facts || {};
  const s = project.settings || {};
  const show = (kind, data) => {
    const card = { id: 'c' + Math.random().toString(36).slice(2, 9), kind, data };
    ctx.state.cards.push(card);
    ctx.emit(card);
    return card;
  };
  const done = (name, output) => { ctx.state.tools.push(name); ctx.state.toolOutputs.push(output); return output; };

  return {
    search_units: tool({
      description: 'Find available homes. Use before recommending units. Returns at most 3 units, shown to the visitor as cards.',
      inputSchema: z.object({
        bedrooms: z.number().int().min(1).max(4).nullish().describe('1, 2, 3 or 4'),
        plan: z.enum(['oneBhk', 'oneBhkStudy', 'twoBhk', 'threeBhk', 'fourBhk']).nullish(),
        max_budget_aed: z.number().positive().nullish().describe('Only if the visitor gave a budget'),
        min_level: z.number().int().min(1).max(16).nullish(),
        max_level: z.number().int().min(1).max(16).nullish(),
        sort: z.enum(['price', 'highest_floor', 'largest']).nullish(),
        include_unavailable: z.boolean().nullish(),
      }),
      execute: async (input) => {
        const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v != null));
        const r = await searchUnits(project, { ...clean, max_budget: clean.max_budget_aed, limit: 3 });
        if (r.units.length) show('units', { units: r.units, total: r.total_matches });
        return done('search_units', {
          total_matches: r.total_matches,
          shown: r.units.map((u) => ({ code: u.code, name: u.name, level: u.level, status: u.status, price: u.price_display, total_sqft: u.areas_sqft?.total })),
          note: r.units.length ? 'Cards with these units are already visible to the visitor.' : 'No matching available units. Suggest relaxing a filter or a consultant.',
        });
      },
    }),

    get_unit: tool({
      description: 'Details of one unit by code, e.g. "08-C" or "15-P1". Shows a unit card with plan, area and availability.',
      inputSchema: z.object({ code: z.string().regex(/^\d{1,2}-[A-Ea-e]$|^\d{1,2}-[Pp][1-3]$/).describe('Level-unit code like 04-A') }),
      execute: async ({ code }) => {
        const [lvl, id] = code.split('-');
        const u = await getUnit(project, String(lvl).padStart(2, '0') + '-' + id.toUpperCase());
        if (!u) return done('get_unit', { found: false });
        show('unit', u);
        return done('get_unit', {
          found: true, code: u.code, name: u.name, level: u.level, status: u.status, price: u.price_display, areas_sqft: u.areas_sqft,
          alternatives: u.alternatives?.map((a) => ({ code: a.code, level: a.level, status: a.status, price: a.price_display })),
          note: 'A card with this unit is already visible to the visitor.',
        });
      },
    }),

    show_info: tool({
      description: 'Show a card about the location, the amenities, the specifications, or the sales gallery.',
      inputSchema: z.object({ kind: z.enum(['location', 'amenities', 'specs', 'sales_gallery']) }),
      execute: async ({ kind }) => {
        const topicFacts = (t) => (facts.facts || []).filter((f) => f.topic === t && f.status === 'confirmed').map((f) => f.text);
        if (kind === 'location' || kind === 'sales_gallery') {
          show('location', { title: kind === 'sales_gallery' ? 'Sales gallery' : project.name, address: s.location?.address, maps_url: s.location?.maps_url, img: s.location?.map_img, travel: facts.travel || [], hours: topicFacts('sales_gallery')[0] || null });
          return done('show_info', { shown: kind, facts: [...topicFacts('location'), ...topicFacts('sales_gallery')] });
        }
        if (kind === 'amenities') {
          show('amenities', { items: (facts.amenities || []).map(({ name, desc, img, cat }) => ({ name, desc, img, cat })) });
          return done('show_info', { shown: 'amenities', facts: topicFacts('amenities'), names: (facts.amenities || []).map((a) => a.name) });
        }
        const specs = topicFacts('specs');
        show('specs', { items: specs });
        return done('show_info', { shown: 'specs', facts: specs });
      },
    }),

    offer_visit: tool({
      description: 'Show available times to book a private site visit at the sales gallery or a video call. The visitor picks a time in the card.',
      inputSchema: z.object({ kind: z.enum(KINDS).nullish().describe('site_visit (default) or video_call'), unit_code: z.string().nullish() }),
      execute: async ({ kind, unit_code }) => {
        kind = kind || 'site_visit';
        if (ctx.booking) {
          show('booking_done', ctx.booking);
          return done('offer_visit', { already_booked: ctx.booking.label, note: 'The visitor already has a booking; the card lets them reschedule.' });
        }
        const days = await loadSlots(project, kind, { lang: ctx.lang });
        const first = days.find((d) => d.slots.length);
        show('booking', { kind, kinds: s.booking?.kinds || KINDS, tz: project.timezone, unit_code: unit_code || ctx.page?.unit || null, days, selected: first ? first.slots[0].at : null });
        return done('offer_visit', {
          kind, earliest: first ? `${first.label} ${first.slots[0].label}` : null,
          days_with_slots: days.filter((d) => d.slots.length).length,
          note: first ? 'A time picker is visible to the visitor; the earliest slot is pre-selected.' : 'No free slots in the next week. Offer a callback instead.',
        });
      },
    }),

    request_contact: tool({
      description: 'Show the secure contact form for a callback, the price sheet, or the brochure by email. Never collect details in chat.',
      inputSchema: z.object({ purpose: z.enum(['callback', 'price_sheet', 'brochure_email']), reason: z.string().max(140).describe('One short line on why, in the visitor\'s language') }),
      execute: async ({ purpose, reason }) => {
        // the reason line is model text shown to the visitor, so it passes the same guardrail as replies
        const safe = reason && (!ctx.guard || checkSentence(reason, ctx.guard).ok) ? reason : null;
        show('form', { purpose, reason: safe });
        return done('request_contact', { shown: 'form', purpose });
      },
    }),

    send_brochure: tool({
      description: 'Give the visitor the project brochure (PDF download).',
      inputSchema: z.object({}),
      execute: async () => {
        show('brochure', { url: s.brochure_url || 'assets/brochure/Aurelle-Residence-Brochure.pdf', title: project.name + ' brochure' });
        return done('send_brochure', { shown: 'brochure' });
      },
    }),

    handoff_to_human: tool({
      description: 'Connect the visitor with the sales team (WhatsApp, call, or callback). Use when they ask for a person, want to negotiate, are frustrated, or need answers you cannot give.',
      inputSchema: z.object({ reason: z.string().max(160), urgency: z.enum(['normal', 'high']).nullish() }),
      execute: async ({ reason, urgency }) => {
        urgency = urgency || 'normal';
        show('human', humanCard(project, ctx.session));
        await createAlert({ projectId: project.id, leadId: ctx.session.lead_id, kind: 'human_requested', payload: { reason, urgency, ref: ctx.session.ref_code }, dedupeHours: 1 }).catch(() => {});
        await db()`update chat_sessions set flagged = true where id = ${ctx.session.id}`;
        return done('handoff_to_human', { shown: 'human', note: 'Options to reach the sales team are visible to the visitor.' });
      },
    }),
  };
}

export function humanCard(project, session) {
  const c = project.settings?.contact || {};
  return { whatsapp: c.whatsapp || null, phone: c.phone || null, ref: session.ref_code, prefill: `Hello, I was chatting with the ${project.name} assistant (ref ${session.ref_code}).` };
}
