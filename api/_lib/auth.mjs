/* Dashboard auth: invite-only email + password (Node scrypt), hashed session tokens in Postgres,
   a __Host- cookie, Origin checks on writes, and per-project roles enforced on every query. */
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.mjs';
import { HttpError, sha256, originOk, ipHash } from './http.mjs';
import { hit, peek } from './ratelimit.mjs';

const scrypt = promisify(scryptCb);
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
export const ROLES = ['viewer', 'agent', 'manager', 'owner'];

export const cookieName = () => process.env.COOKIE_NAME || '__Host-session';

export async function hashPassword(password) {
  if (String(password).length < 10) throw new HttpError(400, 'weak_password', 'Use at least 10 characters.');
  const salt = randomBytes(16);
  const key = await scrypt(String(password).normalize('NFKC'), salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 128 * PARAMS.N * PARAMS.r * 2 });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, { N: +N, r: +r, p: +p, maxmem: 128 * +N * +r * 2 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/* Same work whether or not the email exists, so timing doesn't reveal accounts. */
let dummy;
const dummyHash = async () => (dummy ||= await hashPassword('not-a-real-password-' + randomBytes(8).toString('hex')));

export function sessionCookie(token, maxAgeSeconds = SESSION_DAYS * 86400) {
  return `${cookieName()}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
export const clearCookie = () => `${cookieName()}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function readCookie(request) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === cookieName()) return part.slice(i + 1);
  }
  return null;
}

export async function login(request, email, password) {
  const sql = db();
  const ip = ipHash(request);
  const em = String(email || '').trim().toLowerCase().slice(0, 160);
  await hit('login-ip:' + ip, 20, 900);
  // only failed attempts count against an email, so strangers can't lock a colleague out by guessing
  if ((await peek('login-em:' + em, 900)) >= 10) throw new HttpError(429, 'rate_limited', 'Too many failed attempts. Try again in 15 minutes.');
  const [user] = await sql`select * from users where email = ${em}`;
  const ok = await verifyPassword(password, user?.password_hash || await dummyHash());
  if (!user || !ok || user.disabled_at) {
    await hit('login-em:' + em, 1e9, 900);
    throw new HttpError(401, 'bad_login', 'That email and password don’t match.');
  }
  const token = randomBytes(32).toString('base64url');
  await sql`insert into auth_sessions(user_id, token_hash, ip_hash, user_agent, expires_at)
    values (${user.id}, ${sha256(token)}, ${ip}, ${(request.headers.get('user-agent') || '').slice(0, 200)}, now() + make_interval(days => ${SESSION_DAYS}))`;
  await sql`update users set last_login_at = now() where id = ${user.id}`;
  return { user, token };
}

export async function logout(request) {
  const token = readCookie(request);
  if (token) await db()`delete from auth_sessions where token_hash = ${sha256(token)}`;
}

/* The signed-in user with their projects and roles. Throws 401. Writes also need a same-site Origin. */
export async function requireUser(request) {
  if (!['GET', 'HEAD'].includes(request.method) && !originOk(request)) throw new HttpError(403, 'bad_origin');
  const token = readCookie(request);
  if (!token) throw new HttpError(401, 'signed_out');
  const sql = db();
  const [s] = await sql`select s.id as session_id, s.last_seen_at, s.expires_at, u.id, u.email, u.name, u.disabled_at
    from auth_sessions s join users u on u.id = s.user_id where s.token_hash = ${sha256(token)}`;
  if (!s || new Date(s.expires_at) < new Date() || s.disabled_at) throw new HttpError(401, 'signed_out');
  if (Date.now() - new Date(s.last_seen_at).getTime() > 3600e3) {
    await sql`update auth_sessions set last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_DAYS}) where id = ${s.session_id}`;
  }
  const memberships = await sql`select m.project_id, m.role, p.name, p.slug, p.timezone, p.currency, p.org_id
    from memberships m join projects p on p.id = m.project_id where m.user_id = ${s.id} order by p.name`;
  return { user: { id: s.id, email: s.email, name: s.name }, memberships, projectIds: memberships.map((m) => m.project_id) };
}

/* The one project a request is about, checked against the user's memberships and minimum role. */
export function projectScope(ctx, projectId, minRole = 'viewer') {
  const m = projectId ? ctx.memberships.find((x) => x.project_id === projectId || x.slug === projectId) : ctx.memberships[0];
  if (!m) throw new HttpError(403, 'no_access');
  if (ROLES.indexOf(m.role) < ROLES.indexOf(minRole)) throw new HttpError(403, 'role', 'You need ' + minRole + ' access for this.');
  return m;
}

export async function createInvite(ctx, { projectId, email, role }) {
  const m = projectScope(ctx, projectId, 'manager');
  if (!ROLES.includes(role) || (role === 'owner' && m.role !== 'owner')) throw new HttpError(400, 'bad_role');
  const token = randomBytes(24).toString('base64url');
  await db()`insert into invites(project_id, email, role, token_hash, invited_by, expires_at)
    values (${m.project_id}, ${String(email).trim().toLowerCase()}, ${role}, ${sha256(token)}, ${ctx.user.id}, now() + interval '7 days')`;
  return token;
}

/* Accepting an invite: the invite is claimed atomically (one use), an existing account must prove its
   password before anything changes, and an invite can raise a role but never lower one. */
export async function acceptInvite(token, { name, password }) {
  const sql = db();
  const hash = await hashPassword(password);                       // validates length before claiming
  const [inv] = await sql`update invites set accepted_at = now()
    where token_hash = ${sha256(String(token || ''))} and accepted_at is null and expires_at > now() returning *`;
  if (!inv) throw new HttpError(404, 'invite_invalid', 'This invite link has expired or was already used.');
  const release = () => sql`update invites set accepted_at = null where id = ${inv.id}`;
  let [user] = await sql`select * from users where email = ${inv.email}`;
  if (user?.password_hash && !(await verifyPassword(password, user.password_hash))) {
    await release();
    throw new HttpError(401, 'bad_login', 'This email already has an account — enter its current password to accept.');
  }
  if (user?.disabled_at) { await release(); throw new HttpError(403, 'disabled'); }
  if (!user) {
    [user] = await sql`insert into users(email, name, password_hash) values (${inv.email}, ${String(name || '').trim().slice(0, 120) || inv.email}, ${hash}) returning *`;
  } else if (!user.password_hash) {
    [user] = await sql`update users set password_hash = ${hash} where id = ${user.id} returning *`;
  }
  await sql`insert into memberships(user_id, project_id, role) values (${user.id}, ${inv.project_id}, ${inv.role})
    on conflict (user_id, project_id) do update set role = case
      when array_position(array['viewer','agent','manager','owner'], excluded.role) > array_position(array['viewer','agent','manager','owner'], memberships.role)
      then excluded.role else memberships.role end`;
  return user;
}
