/* Validate data/projects/<slug>/facts.json and publish it as the next fact version.
   Every chat session records the version it answered from.
   Usage: npm run publish-facts -- aurelle */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db } from '../api/_lib/db.mjs';
import { validateFacts, allowedNumbers } from '../api/_lib/facts.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function publishFacts(slug, { onlyIfNone = false } = {}) {
  const sql = db();
  const facts = validateFacts(JSON.parse(await readFile(path.join(root, 'data', 'projects', slug, 'facts.json'), 'utf8')));
  const [project] = await sql`select id, active_facts_id from projects where slug = ${slug}`;
  if (!project) throw new Error(`project ${slug} not found — run the seed first`);
  if (onlyIfNone && project.active_facts_id) {
    const [cur] = await sql`select version from project_facts where id = ${project.active_facts_id}`;
    return cur;
  }
  const [{ v }] = await sql`select coalesce(max(version), 0) + 1 as v from project_facts where project_id = ${project.id}`;
  const [row] = await sql`insert into project_facts(project_id, version, facts, allowed_numbers)
    values (${project.id}, ${v}, ${JSON.stringify(facts)}, ${JSON.stringify(allowedNumbers(facts))}) returning id, version`;
  await sql`update projects set active_facts_id = ${row.id} where id = ${project.id}`;
  return row;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const slug = process.argv[2] || 'aurelle';
  publishFacts(slug)
    .then((r) => { console.log(`published ${slug} facts v${r.version}`); return db().end?.(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
