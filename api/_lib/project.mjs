/* Project + active fact version, memoised per function instance for 60s. */
import { db } from './db.mjs';
import { HttpError } from './http.mjs';

const cache = new Map();
const TTL = 60_000;

export async function loadProject(slugOrId) {
  const key = String(slugOrId || '');
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - TTL) return hit.value;
  const sql = db();
  const isId = /^[0-9a-f-]{36}$/i.test(key);
  const [p] = isId
    ? await sql`select p.*, f.version as facts_version, f.facts, f.allowed_numbers
        from projects p left join project_facts f on f.id = p.active_facts_id where p.id = ${key}`
    : await sql`select p.*, f.version as facts_version, f.facts, f.allowed_numbers
        from projects p left join project_facts f on f.id = p.active_facts_id where p.slug = ${key}`;
  if (!p) throw new HttpError(404, 'unknown_project');
  cache.set(key, { at: Date.now(), value: p });
  return p;
}

export function clearProjectCache() { cache.clear(); }
