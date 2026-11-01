/* Inventory: units, prices and availability.
   priceFrom() is the same formula the explorer uses (js/explorer.js unitPrice), so the
   assistant, the dashboard and the 3D explorer always show the same figure. */
import { db } from './db.mjs';

export const pad = (n) => String(n).padStart(2, '0');

export function priceFrom(plan, level, pricing) {
  const base = pricing?.from?.[plan];
  if (!base) return null;
  return Math.round(base * (1 + (pricing.perLevel || 0) * (level - 1)));
}

/* "AED 1.25M" — identical to the explorer's label. */
export function formatPriceM(value, currency = 'AED') {
  return `${currency} ${(value / 1e6).toFixed(2)}M`;
}

export const parseArea = (s) => Number(String(s).replace(/,/g, '')) || null;

/* Build the 76 unit rows from the site's own data (window.INVENTORY + window.FLOOR_PLATES). */
export function buildUnits({ inventory, plates, unitPlans, levels = 16, penthouseFrom = 15 }) {
  const units = [];
  for (let level = 1; level <= levels; level++) {
    const plate = level >= penthouseFrom ? plates.penthouse : plates.typical;
    for (const u of plate.units) {
      const code = pad(level) + '-' + u.id;
      const status = inventory.sold.includes(code) ? 'sold' : inventory.reserved.includes(code) ? 'reserved' : 'available';
      units.push({
        code, level, plan: u.plan, name: u.name, type: u.type, position: u.pos,
        areas: { apartment: parseArea(u.areas[0]), balcony: parseArea(u.areas[1]), total: parseArea(u.areas[2]) },
        price_from: priceFrom(u.plan, level, inventory),
        status,
        plan_img: unitPlans[u.plan] ? `assets/img/${unitPlans[u.plan].d2}.webp` : null,
      });
    }
  }
  return units;
}

/* Bedrooms per plan, for "2 BHK" style searches. */
export const PLAN_BEDROOMS = { oneBhk: 1, oneBhkStudy: 1, twoBhk: 2, threeBhk: 3, fourBhk: 4 };

/* What a visitor may see about price: the number only once sales has published prices. */
export function priceView(unit, project) {
  const pricing = project.settings?.pricing || {};
  if (!pricing.published || unit.price_from == null) return { price_from: null, price_display: 'Price on request' };
  const v = Number(unit.price_from);
  return { price_from: v, price_display: 'From ' + formatPriceM(v, project.currency) };
}

export function publicUnit(u, project) {
  return {
    code: u.code, level: u.level, plan: u.plan, name: u.name, type: u.type, position: u.position,
    bedrooms: PLAN_BEDROOMS[u.plan] ?? null,
    areas_sqft: u.areas, status: u.status, plan_img: u.plan_img,
    ...priceView(u, project),
  };
}

export async function searchUnits(project, f = {}) {
  const sql = db();
  const rows = await sql`select * from units where project_id = ${project.id} order by level, code`;
  const pricing = project.settings?.pricing || {};
  let list = rows.filter((u) => (f.include_unavailable ? true : u.status === 'available'));
  if (f.bedrooms) list = list.filter((u) => PLAN_BEDROOMS[u.plan] === f.bedrooms);
  if (f.plan) list = list.filter((u) => u.plan === f.plan);
  if (f.min_level) list = list.filter((u) => u.level >= f.min_level);
  if (f.max_level) list = list.filter((u) => u.level <= f.max_level);
  // a budget filter only applies when prices are published; otherwise we would leak them by omission
  if (f.max_budget && pricing.published) list = list.filter((u) => Number(u.price_from) <= f.max_budget);
  if (f.sort === 'highest_floor') list.sort((a, b) => b.level - a.level);
  else if (f.sort === 'largest') list.sort((a, b) => (b.areas.total || 0) - (a.areas.total || 0));
  else if (pricing.published) list.sort((a, b) => Number(a.price_from) - Number(b.price_from));
  const limit = Math.min(Math.max(f.limit || 3, 1), 3);
  return { units: list.slice(0, limit).map((u) => publicUnit(u, project)), total_matches: list.length, cheapest_available_by_plan: cheapestByPlan(rows, project) };
}

export function cheapestByPlan(rows, project) {
  const out = {};
  for (const u of rows) {
    if (u.status !== 'available') continue;
    if (!out[u.plan] || Number(u.price_from) < Number(out[u.plan].price_from)) out[u.plan] = u;
  }
  return Object.fromEntries(Object.entries(out).map(([plan, u]) => [plan, { code: u.code, ...priceView(u, project) }]));
}

export async function getUnit(project, code) {
  const sql = db();
  const [u] = await sql`select * from units where project_id = ${project.id} and code = ${String(code).toUpperCase()}`;
  if (!u) return null;
  const out = publicUnit(u, project);
  if (u.status !== 'available') {
    const alts = await sql`select * from units where project_id = ${project.id} and plan = ${u.plan} and status = 'available'
      order by abs(level - ${u.level}), level limit 2`;
    out.alternatives = alts.map((a) => publicUnit(a, project));
  }
  return out;
}

/* Raw rows (internal use: scoring needs real prices even when they aren't published). */
export async function cheapestAvailableRaw(projectId) {
  const sql = db();
  return sql`select plan, min(price_from)::float as price from units where project_id = ${projectId} and status = 'available' group by plan`;
}
