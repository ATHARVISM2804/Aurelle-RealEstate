/* Fixed-window counters in Postgres. Cheap enough at this volume; every check is one upsert. */
import { db } from './db.mjs';
import { HttpError } from './http.mjs';

/* Returns the count after incrementing. Throws 429 when over `limit`. */
export async function hit(key, limit, windowSeconds) {
  const sql = db();
  const start = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  const [{ count }] = await sql`insert into rate_limits(key, window_start, count) values (${key}, ${start}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count`;
  if (Number(count) > limit) throw new HttpError(429, 'rate_limited', 'Too many requests. Please try again shortly.');
  return Number(count);
}

export async function cleanup() {
  const sql = db();
  await sql`delete from rate_limits where window_start < now() - interval '2 days'`;
}

/* Current count for a key without incrementing it. */
export async function peek(key, windowSeconds) {
  const start = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  const [row] = await db()`select count from rate_limits where key = ${key} and window_start = ${start}`;
  return Number(row?.count || 0);
}
