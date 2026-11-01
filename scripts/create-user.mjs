/* Create (or reset) a dashboard user and give them access to a project.
   Usage: npm run create-user -- <email> "<name>" <project-slug> [role]
   The password is read from DASHBOARD_PASSWORD, or a strong one is generated and printed once. */
import { randomBytes } from 'node:crypto';
import { db } from '../api/_lib/db.mjs';
import { hashPassword, ROLES } from '../api/_lib/auth.mjs';

const [email, name, slug = 'aurelle', role = 'owner'] = process.argv.slice(2);
if (!email || !name) { console.error('Usage: npm run create-user -- <email> "<name>" <project-slug> [role]'); process.exit(1); }
if (!ROLES.includes(role)) { console.error('role must be one of ' + ROLES.join(', ')); process.exit(1); }

const sql = db();
const password = process.env.DASHBOARD_PASSWORD || randomBytes(12).toString('base64url');
const [project] = await sql`select id, name from projects where slug = ${slug}`;
if (!project) { console.error(`project ${slug} not found — run the seed first`); process.exit(1); }
const [user] = await sql`insert into users(email, name, password_hash) values (${email.toLowerCase()}, ${name}, ${await hashPassword(password)})
  on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash, disabled_at = null returning id`;
await sql`insert into memberships(user_id, project_id, role) values (${user.id}, ${project.id}, ${role})
  on conflict (user_id, project_id) do update set role = excluded.role`;
console.log(`${email} is ${role} of ${project.name}.`);
if (!process.env.DASHBOARD_PASSWORD) console.log(`Password (shown once, change it by re-running with DASHBOARD_PASSWORD): ${password}`);
await sql.end?.();
