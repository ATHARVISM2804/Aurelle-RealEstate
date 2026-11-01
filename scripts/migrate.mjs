/* Apply db/migrations/*.sql in order, each inside a transaction.
   Uses DATABASE_URL_UNPOOLED (direct connection) when set, else DATABASE_URL.
   DATABASE_DRIVER=pg uses node-postgres (local Docker); otherwise Neon's WebSocket Pool. */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL (or DATABASE_URL_UNPOOLED).'); process.exit(1); }

const { Pool } = process.env.DATABASE_DRIVER === 'pg'
  ? (await import('pg')).default
  : await import('@neondatabase/serverless');
const pool = new Pool({ connectionString: url });

// one migrator at a time: everything runs on one connection holding an advisory lock
const client = await pool.connect();
try {
  await client.query('select pg_advisory_lock(727274)');
  await client.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await client.query('select version from schema_migrations')).rows.map((r) => r.version));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sqlText = await readFile(path.join(dir, f), 'utf8');
    try {
      await client.query('begin');
      await client.query(sqlText);
      await client.query('insert into schema_migrations(version) values ($1)', [f]);
      await client.query('commit');
      console.log('applied', f);
      applied++;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      console.error('failed', f, '\n', e.message);
      process.exitCode = 1;
      break;
    }
  }
  if (!applied && !process.exitCode) console.log('up to date');
} finally {
  await client.query('select pg_advisory_unlock(727274)').catch(() => {});
  client.release();
  await pool.end();
}
