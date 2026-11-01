/* Realistic demo data for sales demos and dashboard design: ~45 leads over 30 days with chats,
   3D browsing, visits, no-shows, summaries and scores. Every row is tagged (fields.demo) so
   `npm run demo -- --clear` removes it. Never run against a client's live database.
   Usage: npm run demo [-- <project-slug>] [-- --clear] */
import { randomUUID } from 'node:crypto';
import { db } from '../api/_lib/db.mjs';
import { hashPassword } from '../api/_lib/auth.mjs';
import { rescoreLead } from '../api/_lib/scoring-run.mjs';
import { applyToLead } from '../api/_lib/summarize.mjs';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--')) || 'aurelle';
if (process.env.DATABASE_DRIVER !== 'pg' && !args.includes('--force')) {
  console.error('Refusing: demo data (and demo logins with a known password) is for a local database only. Pass --force to override.');
  process.exit(1);
}
const sql = db();
const [project] = await sql`select * from projects where slug = ${slug}`;
if (!project) { console.error('project not found'); process.exit(1); }

if (args.includes('--clear')) {
  const ids = (await sql`select id from leads where project_id = ${project.id} and fields ? 'demo'`).map((r) => r.id);
  await sql.transaction([
    sql`delete from bookings where lead_id = any(${ids})`,
    sql`delete from notes where lead_id = any(${ids})`,
    sql`delete from lead_scores where lead_id = any(${ids})`,
    sql`delete from lead_reads where lead_id = any(${ids})`,
    sql`delete from alerts where lead_id = any(${ids})`,
    sql`delete from consents where lead_id = any(${ids})`,
    sql`delete from summaries where lead_id = any(${ids})`,
    sql`delete from chat_sessions where lead_id = any(${ids})`,
    sql`delete from visitors where lead_id = any(${ids})`,
    sql`delete from leads where id = any(${ids})`,
  ]);
  const agents = (await sql`select id from users where email in ('maya@aurelle.test', 'zaid@aurelle.test')`).map((r) => r.id);
  await sql.transaction([
    sql`update leads set owner_id = null where owner_id = any(${agents})`,
    sql`update bookings set assigned_to = null where assigned_to = any(${agents})`,
    sql`delete from notes where author_id = any(${agents})`,
    sql`delete from saved_views where user_id = any(${agents})`,
    sql`delete from lead_reads where user_id = any(${agents})`,
    sql`delete from auth_sessions where user_id = any(${agents})`,
    sql`delete from memberships where user_id = any(${agents})`,
    sql`delete from users where id = any(${agents})`,
  ]);
  console.log(`removed ${ids.length} demo leads and ${agents.length} demo agents`);
  process.exit(0);
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const ago = (days, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 36e5);

const PEOPLE = [
  ['Arjun Malhotra', '+91', 'hi-Latn'], ['Priya Nair', '+91', 'en'], ['Rohan Kapoor', '+91', 'en'], ['Neha Sharma', '+91', 'hi'], ['Vikram Rao', '+91', 'en'],
  ['Ananya Iyer', '+91', 'en'], ['Karan Mehta', '+91', 'hi-Latn'], ['Sanjay Gupta', '+91', 'en'], ['Meera Joshi', '+91', 'en'], ['Aditya Verma', '+91', 'en'],
  ['Omar Al Mansoori', '+971', 'ar'], ['Fatima Al Hashimi', '+971', 'ar'], ['Khalid Al Suwaidi', '+971', 'ar'], ['Layla Haddad', '+971', 'en'], ['Yousef Nasser', '+966', 'ar'],
  ['Hessa Al Marri', '+974', 'ar'], ['James Whitaker', '+44', 'en'], ['Charlotte Evans', '+44', 'en'], ['Oliver Bennett', '+44', 'en'], ['Sophie Laurent', '+33', 'en'],
  ['Dmitri Volkov', '+7', 'en'], ['Elena Sokolova', '+7', 'en'], ['Andrei Petrov', '+7', 'en'], ['Lukas Becker', '+49', 'en'], ['Marco Rossi', '+39', 'en'],
  ['Wei Zhang', '+86', 'en'], ['Mei Lin', '+86', 'en'], ['Daniel Cohen', '+1', 'en'], ['Ahmed Raza', '+92', 'en'], ['Sara Mirza', '+971', 'en'],
  ['Rahul Desai', '+971', 'en'], ['Pooja Reddy', '+971', 'en'], ['Imran Sheikh', '+971', 'hi-Latn'], ['Nadia Karim', '+971', 'en'], ['Tariq Aziz', '+965', 'ar'],
  ['Anjali Menon', '+91', 'en'], ['Siddharth Jain', '+91', 'en'], ['Ritu Agarwal', '+91', 'en'], ['Faisal Qureshi', '+973', 'ar'], ['Grace Liu', '+65', 'en'],
  ['Hamza Ali', '+971', 'en'], ['Isabella Martin', '+44', 'en'], ['Noah Fischer', '+41', 'en'], ['Zara Hussain', '+971', 'en'], ['Vivek Bhatia', '+91', 'en'],
];
const SOURCES = [
  ['facebook', 'paid_social', 'aurelle-launch-nri'], ['facebook', 'paid_social', 'aurelle-launch-uae'], ['instagram', 'paid_social', 'aurelle-reels-penthouse'],
  ['google', 'cpc', 'aurelle-brand'], ['google', 'cpc', 'al-furjan-apartments'], ['propertyfinder.ae', 'referral', ''], ['bayut.com', 'referral', ''], ['direct', '', ''],
];
const CONFIGS = [['1 BHK', 1.2e6, 1.6e6], ['1 BHK + Study', 1.4e6, 1.8e6], ['2 BHK', 2.2e6, 3e6], ['2 BHK', 2.4e6, 3.2e6], ['3 BHK penthouse', 6.5e6, 8.5e6], ['4 BHK penthouse', 8.5e6, 1.1e7]];
const TIMELINES = ['0-3 months', '0-3 months', '3-6 months', '6-12 months', '12+ months', 'unknown'];
const QUESTIONS = ['What is the payment plan?', 'When is handover?', 'Is there a sea view from higher floors?', 'How far is the Metro?', 'Do penthouses have a private pool?', 'Can I visit on Saturday?', 'Is parking included?', 'What are the service charges?'];
const OBJECTIONS = ['Comparing with JVC projects', 'Wants a higher floor', 'Price above budget', 'Needs spouse to see it first', ''];

const units = await sql`select code, plan, level, status from units where project_id = ${project.id}`;
const unitFor = (cfg) => {
  const plan = cfg.startsWith('1 BHK +') ? 'oneBhkStudy' : cfg.startsWith('1') ? 'oneBhk' : cfg.startsWith('2') ? 'twoBhk' : cfg.startsWith('3') ? 'threeBhk' : 'fourBhk';
  return units.filter((u) => u.plan === plan).sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3));
};

// two agents to own leads
const agents = [];
for (const [email, name] of [['maya@aurelle.test', 'Maya Fernandes'], ['zaid@aurelle.test', 'Zaid Haddad']]) {
  const [u] = await sql`insert into users(email, name, password_hash) values (${email}, ${name}, ${await hashPassword('aurelle-demo-2026')})
    on conflict (email) do update set name = excluded.name returning id, name`;
  await sql`insert into memberships(user_id, project_id, role) values (${u.id}, ${project.id}, 'agent') on conflict do nothing`;
  agents.push(u);
}

let made = 0;
for (let i = 0; i < PEOPLE.length; i++) {
  const [name, cc, lang] = PEOPLE[i];
  const createdDaysAgo = Math.floor(rnd() * 29) + (i < 6 ? 0 : 0.3);
  const created = ago(createdDaysAgo, rnd() * 12);
  const [source, medium, campaign] = cc === '+91' && chance(0.6) ? SOURCES[0] : pick(SOURCES);
  const [cfg, bmin, bmax] = pick(CONFIGS);
  const timeline = pick(TIMELINES);
  const phone = cc + String(500000000 + Math.floor(rnd() * 89999999));
  const email = chance(0.75) ? name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com' : null;
  const opened = unitFor(cfg);
  const intent = rnd();
  const booked = intent > 0.45;
  const visitPast = booked && createdDaysAgo > 4 && chance(0.6);
  const broker = i === 33 || i === 40;

  const attribution = { first: { utm_source: source, utm_medium: medium, utm_campaign: campaign, ...(source === 'facebook' || source === 'instagram' ? { fbclid: 'IwAR' + randomUUID().slice(0, 12), fbc: 'fb.1.' + created.getTime() + '.IwAR' } : {}), landing: '/', at: created.toISOString() } };
  const fields = {
    demo: { value: true },
    budget: { value: `AED ${(bmin / 1e6).toFixed(1)}–${(bmax / 1e6).toFixed(1)}M`, min: bmin, max: bmax, currency: 'AED', source: 'ai' },
    configuration: { value: cfg, source: 'ai' },
    unit_interest: { value: opened.map((u) => u.code), source: 'ai' },
    timeline: { value: timeline, source: 'ai' },
    purpose: { value: pick(['end_use', 'investor', 'end_use', 'both']), source: 'ai' },
    financing: { value: pick(['cash', 'mortgage_preapproved', 'needs_mortgage', 'unknown']), source: 'ai' },
    questions_asked: { value: [pick(QUESTIONS), pick(QUESTIONS)].filter((v, k, a) => a.indexOf(v) === k), source: 'ai' },
  };
  const objection = pick(OBJECTIONS);
  if (objection) fields.objections = { value: [objection], source: 'ai' };
  const stage = broker ? 'new' : visitPast ? pick(['visited', 'visited', 'negotiation', 'booked', 'lost']) : booked ? 'visit_booked' : pick(['new', 'new', 'contacted', 'qualified', 'contacted']);
  const owner = stage === 'new' && chance(0.6) ? null : pick(agents).id;
  const responded = stage !== 'new' ? new Date(created.getTime() + (2 + rnd() * 240) * 60e3) : null;

  const [lead] = await sql`insert into leads(project_id, name, phone_e164, email, lang, source, medium, campaign, attribution, fields, is_broker, stage, stage_changed_at, lost_reason, owner_id, first_response_at, last_activity_at, created_at)
    values (${project.id}, ${name}, ${phone}, ${email}, ${lang}, ${source}, ${medium || null}, ${campaign || null}, ${JSON.stringify(attribution)}, ${JSON.stringify(fields)}, ${broker},
      ${stage}, ${new Date(created.getTime() + 36e5)}, ${stage === 'lost' ? pick(['Bought elsewhere', 'Budget changed', 'Not reachable']) : null}, ${owner}, ${responded},
      ${ago(Math.max(0, createdDaysAgo - rnd() * 3), rnd() * 10)}, ${created})
    on conflict do nothing returning id`;
  if (!lead) continue;

  const [visitor] = await sql`insert into visitors(project_id, anon_id, first_touch, last_touch, sessions_7d, lead_id, first_seen, last_seen)
    values (${project.id}, ${'demo-' + randomUUID()}, ${JSON.stringify(attribution.first)}, ${JSON.stringify(attribution.first)}, ${1 + Math.floor(rnd() * 4)}, ${lead.id}, ${created}, ${created}) returning id`;
  const evts = [['section_reached', { section: 'residences' }], ['explorer_opened', { level: opened[0]?.level || 4 }]];
  for (const u of opened) { evts.push(['unit_opened', { code: u.code, plan: u.plan }]); if (chance(0.5)) evts.push(['toggle_3d', { code: u.code, on: true }]); }
  if (chance(0.4)) evts.push(['brochure_downloaded', { via: 'chat' }]);
  if (chance(0.5)) evts.push(['price_shown', { units: opened.map((u) => u.code).join(',') }]);
  if (chance(0.3) && opened[0]) evts.push(['unit_opened', { code: opened[0].code, plan: opened[0].plan }]);
  for (let k = 0; k < evts.length; k++) {
    const at = new Date(created.getTime() - (evts.length - k) * 90e3 + (k > evts.length - 2 && chance(0.3) ? 864e5 : 0));
    await sql`insert into events(project_id, visitor_id, type, props, url, at) values (${project.id}, ${visitor.id}, ${evts[k][0]}, ${JSON.stringify(evts[k][1])}, '/', ${at})`;
  }

  const [session] = await sql`insert into chat_sessions(project_id, visitor_id, lead_id, token_hash, ref_code, lang, facts_version, started_at, last_message_at, user_msgs, tokens_in, tokens_out, cost_micros, summarized_at)
    values (${project.id}, ${visitor.id}, ${lead.id}, ${Buffer.from(randomUUID())}, ${'AUR-' + randomUUID().slice(0, 5).toUpperCase()}, ${lang}, 1, ${created}, ${created}, 4, 28000, 900, 4740, ${created}) returning id`;
  const convo = [
    ['user', lang === 'ar' ? 'أبحث عن شقة بغرفتين في طابق مرتفع' : lang === 'hi-Latn' ? `Mujhe ${cfg} chahiye, budget around ${(bmax / 1e6).toFixed(1)}M` : `Hi, I'm looking for a ${cfg}, budget up to AED ${(bmax / 1e6).toFixed(1)}M.`],
    ['assistant', `Here are a few ${cfg} homes that are available now — the cards show plans, sizes and availability. Would you like to see one in person?`, [{ kind: 'units', data: { units: opened.map((u) => ({ code: u.code, level: u.level, name: cfg, status: u.status })) } }]],
    ['user', fields.questions_asked.value[0]],
    ['assistant', 'A consultant will confirm that for you directly; I can arrange a call or a private visit to the sales gallery.'],
  ];
  if (booked) convo.push(['user', 'Yes, I would like to visit.'], ['assistant', 'Here are the next available times; the earliest is already selected.', [{ kind: 'booking', data: { kind: 'site_visit', days: [] } }]]);
  for (const [k, m] of convo.entries()) {
    await sql`insert into messages(session_id, project_id, role, content, cards, created_at) values (${session.id}, ${project.id}, ${m[0]}, ${m[1]}, ${m[2] ? JSON.stringify(m[2]) : null}, ${new Date(created.getTime() + k * 40e3)})`;
  }
  for (const purpose of ['call', 'whatsapp', 'email']) {
    await sql`insert into consents(project_id, lead_id, visitor_id, purpose, granted, text_version, text_snapshot, source, created_at)
      values (${project.id}, ${lead.id}, ${visitor.id}, ${purpose}, ${purpose !== 'email' || chance(0.5)}, 'chat-v1', 'demo', 'chat', ${created})`;
  }

  if (booked) {
    const start = visitPast ? ago(Math.floor(rnd() * Math.min(createdDaysAgo - 1, 10)) + 1) : new Date(Date.now() + (1 + Math.floor(rnd() * 6)) * 864e5);
    start.setUTCHours(6 + Math.floor(rnd() * 8), pick([0, 45]), 0, 0);
    const status = visitPast ? (stage === 'lost' && chance(0.5) ? 'no_show' : chance(0.2) ? 'no_show' : 'done') : 'confirmed';
    await sql`insert into bookings(project_id, lead_id, session_id, kind, unit_code, starts_at, ends_at, seat, status, assigned_to, manage_token_hash, created_via, created_at)
      values (${project.id}, ${lead.id}, ${session.id}, ${chance(0.2) ? 'video_call' : 'site_visit'}, ${opened[0]?.code || null}, ${start}, ${new Date(start.getTime() + 45 * 60e3)},
        ${1 + (made % 2)}, ${status}, ${owner}, ${Buffer.from(randomUUID())}, 'chat', ${new Date(created.getTime() + 5 * 60e3)})
      on conflict do nothing`;
  }

  const summary = {
    summary: [`${name.split(' ')[0]} is looking for a ${cfg} with a budget up to AED ${(bmax / 1e6).toFixed(1)}M.`, `Asked: ${fields.questions_asked.value[0]}`, booked ? (visitPast ? 'Has visited the sales gallery.' : 'Visit booked.') : 'Still comparing options.'],
    one_liner: `${cfg} · AED ${(bmax / 1e6).toFixed(1)}M · ${timeline === 'unknown' ? 'timeline open' : timeline}${booked && !visitPast ? ' · visit booked' : ''}`,
    budget: { value: { text: fields.budget.value, min: bmin, max: bmax, currency: 'AED' }, evidence: [] },
    configuration: { value: cfg, evidence: [] }, unit_interest: { value: opened.map((u) => u.code), evidence: [] },
    timeline: { value: timeline, evidence: [] }, purpose: fields.purpose, financing: fields.financing,
    decision_makers: { value: chance(0.4) ? 'With spouse' : null, evidence: [] }, objections: { value: objection ? [objection] : [], evidence: [] },
    questions_asked: { value: fields.questions_asked.value, evidence: [] }, is_broker: { value: broker, evidence: [] },
    sentiment: pick(['positive', 'positive', 'neutral']), language: lang,
    next_best_action: booked && !visitPast ? 'Confirm the visit on WhatsApp the day before and share the floor plan.' : visitPast ? 'Send the reserved-unit price sheet and follow up on the decision.' : 'Send the floor plans on WhatsApp and offer a weekend visit.',
  };
  await sql`insert into summaries(lead_id, session_id, model, data, created_at) values (${lead.id}, ${session.id}, 'demo', ${JSON.stringify(summary)}, ${created})`;
  await applyToLead(lead.id, summary);
  await sql`update leads set fields = fields || ${JSON.stringify({ demo: { value: true } })}::jsonb where id = ${lead.id}`;
  if (chance(0.35) && owner) await sql`insert into notes(lead_id, author_id, body, created_at) values (${lead.id}, ${owner}, ${pick(['Spoke on WhatsApp — prefers evenings.', 'Wants east-facing. Sent the 3D link.', 'Brother also interested, may buy two units.', 'Asked for a call after Friday prayers.'])}, ${responded || created})`;
  await rescoreLead(lead.id);
  made++;
}
await sql`delete from alerts where project_id = ${project.id} and created_at > now() - interval '1 minute' and kind = 'hot_lead'`;
console.log(`created ${made} demo leads for ${project.name} (agents: maya@aurelle.test, zaid@aurelle.test / aurelle-demo-2026)`);
await sql.end?.();
