/* Seed (idempotent): org, project, the 76 units, default availability, and fact version 1.
   Units come from the site's own js/config.js + js/plates.js, evaluated in a sandbox, so the
   database starts identical to what the 3D explorer shows.
   Usage: npm run seed [-- <project-slug>]   (default: aurelle) */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { db } from '../api/_lib/db.mjs';
import { buildUnits } from '../api/_lib/inventory.mjs';
import { publishFacts } from './publish-facts.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2] || 'aurelle';

export async function loadSiteData() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  for (const f of ['js/config.js', 'js/plates.js']) vm.runInContext(await readFile(path.join(root, f), 'utf8'), ctx, { filename: f });
  return { inventory: ctx.window.INVENTORY, plates: ctx.window.FLOOR_PLATES, unitPlans: ctx.window.UNIT_PLANS };
}

async function main() {
  const sql = db();
  const cfg = JSON.parse(await readFile(path.join(root, 'data', 'projects', slug, 'project.json'), 'utf8'));
  const site = await loadSiteData();

  const [org] = await sql`insert into orgs(name, slug) values (${cfg.org.name}, ${cfg.org.slug})
    on conflict (slug) do update set name = excluded.name returning id`;
  const [project] = await sql`insert into projects(org_id, slug, name, timezone, currency, settings)
    values (${org.id}, ${cfg.slug}, ${cfg.name}, ${cfg.timezone}, ${cfg.currency}, ${JSON.stringify(cfg.settings)})
    on conflict (org_id, slug) do update set name = excluded.name, timezone = excluded.timezone,
      currency = excluded.currency, settings = excluded.settings
    returning id`;

  const pricing = { ...site.inventory, ...cfg.settings.pricing };
  const units = buildUnits({ inventory: { ...site.inventory, from: pricing.from, perLevel: pricing.perLevel }, plates: site.plates, unitPlans: site.unitPlans, levels: cfg.settings.levels, penthouseFrom: cfg.settings.penthouse_from });
  for (const u of units) {
    await sql`insert into units(project_id, code, level, plan, name, type, position, areas, price_from, status, plan_img)
      values (${project.id}, ${u.code}, ${u.level}, ${u.plan}, ${u.name}, ${u.type}, ${u.position}, ${JSON.stringify(u.areas)}, ${u.price_from}, ${u.status}, ${u.plan_img})
      on conflict (project_id, code) do update set level = excluded.level, plan = excluded.plan, name = excluded.name,
        type = excluded.type, position = excluded.position, areas = excluded.areas, price_from = excluded.price_from,
        status = excluded.status, plan_img = excluded.plan_img, updated_at = now()`;
  }

  const [{ n }] = await sql`select count(*)::int as n from availability_rules where project_id = ${project.id}`;
  if (!n) {
    for (const a of cfg.availability) for (const wd of a.weekdays) {
      await sql`insert into availability_rules(project_id, kind, weekday, start_local, end_local, slot_minutes, capacity, location)
        values (${project.id}, ${a.kind}, ${wd}, ${a.start}, ${a.end}, ${a.slot_minutes}, ${a.capacity}, ${a.location})`;
    }
  }

  const facts = await publishFacts(slug, { onlyIfNone: true });
  console.log(`seeded ${cfg.name}: ${units.length} units, availability ${n ? 'kept' : 'created'}, facts v${facts.version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(() => db().end?.()).catch((e) => { console.error(e); process.exit(1); });
}
