/* Project fact base: validation, allowed-number extraction, and prompt rendering. */
import { z } from 'zod';

const Fact = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  text: z.string().min(1),
  numbers: z.array(z.number()).optional(),
  status: z.enum(['confirmed', 'pending']).default('confirmed'),
  source: z.string().optional(),
});
const Pending = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  policy: z.string().min(1),
});
export const FactsFile = z.object({
  project: z.string().min(1),
  facts: z.array(Fact).min(1),
  pending: z.array(Pending).default([]),
  amenities: z.array(z.object({ id: z.string(), name: z.string(), desc: z.string(), img: z.string(), cat: z.string().optional() })).default([]),
  travel: z.array(z.object({ label: z.string(), minutes: z.number() })).default([]),
  forbidden_claims: z.array(z.string()).default([]),
});

export function validateFacts(raw) {
  const facts = FactsFile.parse(raw);
  const ids = new Set();
  for (const f of [...facts.facts, ...facts.pending]) {
    if (ids.has(f.id)) throw new Error('duplicate fact id ' + f.id);
    ids.add(f.id);
  }
  return facts;
}

/* Every number a confirmed fact states, plus travel minutes. The guardrail lets these through. */
export function allowedNumbers(facts) {
  const set = new Set();
  for (const f of facts.facts) {
    if (f.status !== 'confirmed') continue;
    for (const n of f.numbers || []) set.add(n);
    for (const m of f.text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) set.add(Number(m[0].replace(/,/g, '')));
  }
  for (const t of facts.travel) set.add(t.minutes);
  return [...set].sort((a, b) => a - b);
}

export function renderFactsForPrompt(facts, version) {
  const lines = facts.facts.filter((f) => f.status === 'confirmed').map((f) => `[${f.id}] ${f.text}`);
  const pending = facts.pending.map((p) => `[${p.id}] ${p.topic}: ${p.policy}`);
  return `<facts version="${version}">\n${lines.join('\n')}\n</facts>\n<not_yet_confirmed>\n${pending.join('\n')}\n</not_yet_confirmed>`;
}
