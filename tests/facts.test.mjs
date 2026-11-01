import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { validateFacts, allowedNumbers, renderFactsForPrompt } from '../api/_lib/facts.mjs';

const projectsDir = new URL('../data/projects/', import.meta.url);

test('every project facts.json validates and every pending topic has a policy', async () => {
  for (const slug of await readdir(projectsDir)) {
    const raw = JSON.parse(await readFile(new URL(`${slug}/facts.json`, projectsDir), 'utf8'));
    const facts = validateFacts(raw);
    assert.equal(facts.project, slug);
    for (const p of facts.pending) assert.ok(p.policy.length > 10, p.id);
    for (const a of facts.amenities) assert.match(a.img, /^assets\/img\/.+\.webp$/);
  }
});

test('allowed numbers include stated figures and travel minutes', async () => {
  const facts = validateFacts(JSON.parse(await readFile(new URL('aurelle/facts.json', projectsDir), 'utf8')));
  const nums = allowedNumbers(facts);
  for (const n of [3.65, 16, 76, 5, 12, 25, 10, 19, 3356]) assert.ok(nums.includes(n), String(n));
});

test('duplicate ids are rejected', () => {
  assert.throws(() => validateFacts({ project: 'x', facts: [{ id: 'a', topic: 't', text: 'x' }, { id: 'a', topic: 't', text: 'y' }] }), /duplicate/);
});

test('prompt rendering lists confirmed facts and pending policies', async () => {
  const facts = validateFacts(JSON.parse(await readFile(new URL('aurelle/facts.json', projectsDir), 'utf8')));
  const out = renderFactsForPrompt(facts, 3);
  assert.match(out, /<facts version="3">/);
  assert.match(out, /\[spec\.ceiling\] Ceiling heights of 3\.65 m\./);
  assert.match(out, /\[pay\.plan\] payment_plan:/);
});
