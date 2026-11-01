/* One `sql` for every function.
   Production: Neon's HTTP driver (`neon()`), stateless and right for serverless.
   Local / tests: set DATABASE_DRIVER=pg to talk to a plain Postgres (e.g. the Docker one) through `pg`.
   Both expose the same surface:
     await sql`select ... ${value}`        -> rows
     await sql.query('select $1', [value]) -> rows
     await sql.transaction([sql`...`, sql`...`]) -> array of row arrays (non-interactive) */

let instance;

export function db() {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  instance = process.env.DATABASE_DRIVER === 'pg' ? pgAdapter(url) : neonAdapter(url);
  return instance;
}

/* For tests: swap in a fake. */
export function setDb(fake) { instance = fake; }

function neonAdapter(url) {
  let neonSql;
  const ready = import('@neondatabase/serverless').then(({ neon }) => { neonSql = neon(url); });
  const tag = (strings, ...raw) => { const values = raw.map(param); return lazy(async () => { await ready; return neonSql(strings, ...values); }, () => neonSql(strings, ...values)); };
  tag.query = async (text, params = []) => { await ready; return neonSql.query(text, params.map(param)); };
  tag.transaction = async (queries) => { await ready; return neonSql.transaction(queries.map((q) => q.build())); };
  return tag;
}

function pgAdapter(url) {
  let pool;
  const getPool = async () => {
    if (!pool) {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({ connectionString: url, max: 5 });
    }
    return pool;
  };
  const tag = (strings, ...values) => {
    const q = toText(strings, values.map(param));
    return lazy(async () => (await (await getPool()).query(q.text, q.values)).rows, () => q);
  };
  tag.query = async (text, params = []) => (await (await getPool()).query(text, params.map(param))).rows;
  tag.transaction = async (queries) => {
    const client = await (await getPool()).connect();
    try {
      await client.query('begin');
      const out = [];
      for (const q of queries) { const { text, values } = q.build(); out.push((await client.query(text, values)).rows); }
      await client.query('commit');
      return out;
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  };
  tag.end = async () => { if (pool) await pool.end(); pool = null; instance = undefined; };
  return tag;
}

/* Binary values (token hashes) go as Postgres hex text, which both drivers send unchanged;
   Neon's HTTP driver JSON-encodes parameters and would otherwise mangle a Buffer. */
export const param = (v) => (Buffer.isBuffer(v) || v instanceof Uint8Array ? '\\x' + Buffer.from(v).toString('hex') : v);

/* A query that only runs when awaited, and can also be handed to transaction(). */
function lazy(run, build) {
  let p;
  return { build, then: (ok, err) => (p ||= run()).then(ok, err), catch: (err) => (p ||= run()).catch(err) };
}

function toText(strings, values) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1];
  return { text, values };
}

/* Build `where` fragments safely: q.add('band = any(?)', bands) -> '$3' placeholders. */
export function builder(start = []) {
  const params = [...start];
  return {
    params,
    p(v) { params.push(v); return '$' + params.length; },
  };
}
