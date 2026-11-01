import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, sessionCookie, readCookie, projectScope, cookieName } from '../api/_lib/auth.mjs';
import { originOk } from '../api/_lib/http.mjs';

test('scrypt round trip and format', async () => {
  const h = await hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('correct horse batterY', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.notEqual(await hashPassword('correct horse battery'), h, 'salted');
});

test('short passwords are rejected', async () => {
  await assert.rejects(hashPassword('short'), /10 characters/);
});

test('session cookie attributes', () => {
  const c = sessionCookie('abc');
  assert.match(c, /^__Host-session=abc; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
  const req = new Request('https://x.test/', { headers: { cookie: `other=1; ${cookieName()}=tok123; z=2` } });
  assert.equal(readCookie(req), 'tok123');
});

test('origin check: configured origin or same host only', () => {
  process.env.APP_ORIGIN = 'https://aurelle.example';
  const r = (origin, url = 'https://aurelle.example/api/a/leads') => new Request(url, { method: 'POST', headers: origin ? { origin } : {} });
  assert.equal(originOk(r('https://aurelle.example')), true);
  assert.equal(originOk(r('https://preview-123.vercel.app', 'https://preview-123.vercel.app/api/a/x')), true);
  assert.equal(originOk(r('https://evil.example')), false);
  assert.equal(originOk(r(null)), false);
});

test('projectScope enforces membership and minimum role', () => {
  const ctx = { memberships: [{ project_id: 'p1', slug: 'aurelle', role: 'agent' }, { project_id: 'p2', slug: 'b', role: 'owner' }] };
  assert.equal(projectScope(ctx, 'p1').project_id, 'p1');
  assert.equal(projectScope(ctx, 'aurelle').project_id, 'p1');
  assert.equal(projectScope(ctx).project_id, 'p1');
  assert.throws(() => projectScope(ctx, 'p3'), /no_access/);
  assert.throws(() => projectScope(ctx, 'p1', 'manager'), /manager/);
  assert.equal(projectScope(ctx, 'p2', 'manager').role, 'owner');
});
