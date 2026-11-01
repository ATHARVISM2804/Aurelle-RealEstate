/* CHAT_MODEL=mock:scripted — a keyword-driven stand-in for local development and tests, so the
   whole pipeline (tools, cards, guardrail, storage, UI) runs without an API key. Never in production. */
import { MockLanguageModelV4 } from 'ai/test';

const RULES = [
  [/human|person|agent|someone|call me|talk to/i, 'handoff_to_human', { reason: 'Visitor asked for a person' }],
  [/video/i, 'offer_visit', { kind: 'video_call' }],
  [/visit|book|see it|viewing|appointment|visit book|زيارة|विज़िट/i, 'offer_visit', { kind: 'site_visit' }],
  [/amenit|pool|gym|padel|المرافق|सुविधा/i, 'show_info', { kind: 'amenities' }],
  [/where|location|metro|airport|directions|kahan|أين/i, 'show_info', { kind: 'location' }],
  [/spec|finish|ceiling/i, 'show_info', { kind: 'specs' }],
  [/brochure/i, 'send_brochure', {}],
  [/price sheet|payment plan|price list/i, 'request_contact', { purpose: 'price_sheet', reason: 'So our team can send the current price sheet.' }],
  [/\b(\d{2})-([a-e]|p[1-3])\b/i, 'get_unit', null],
  [/penthouse/i, 'search_units', { bedrooms: 4 }],
  [/(\d)\s*(?:bed|bhk|br)|bedroom|available|what's available|kya available/i, 'search_units', null],
];

const REPLIES = {
  search_units: 'Here are some homes that match. Prices start from AED 1.99M on these. Would you like to book a private visit?',
  get_unit: 'Here are the details for that residence. It has generous light and a private balcony. Shall I find a time for you to see it?',
  offer_visit: 'Here are the next available times; the earliest is already selected. Pick any slot that suits you.',
  show_info: 'Here you go. The podium has twelve amenities and the Metro is about 5 minutes away.',
  send_brochure: 'Here is the brochure for Aurelle Residence.',
  request_contact: 'A consultant will share the current payment plan and price sheet with you; the form below keeps your details private.',
  handoff_to_human: 'Of course. You can reach the sales team directly using the options below.',
};

function lastUserText(prompt) {
  for (let i = prompt.length - 1; i >= 0; i--) if (prompt[i].role === 'user') return prompt[i].content.map((p) => p.text || '').join(' ');
  return '';
}

function plan(text) {
  for (const [re, toolName, input] of RULES) {
    const m = text.match(re);
    if (!m) continue;
    if (toolName === 'get_unit') return { toolName, input: { code: `${m[1]}-${m[2].toUpperCase()}` } };
    if (toolName === 'search_units' && !input) {
      const beds = text.match(/(\d)\s*(?:bed|bhk|br)/i);
      return { toolName, input: { ...(beds ? { bedrooms: Number(beds[1]) } : {}), sort: /high|top|upar/i.test(text) ? 'highest_floor' : undefined } };
    }
    return { toolName, input };
  }
  return null;
}

const usage = (i, o) => ({ inputTokens: { total: i, noCache: i, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: o, text: o, reasoning: 0 } });

function textStream(text) {
  const words = text.split(/(?<=\s)/);
  return [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, ...words.map((delta) => ({ type: 'text-delta', id: 't', delta })), { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: usage(900, 40) }];
}

export function mockModel() {
  return new MockLanguageModelV4({
    provider: 'mock', modelId: 'scripted',
    doStream: async ({ prompt }) => {
      const last = prompt[prompt.length - 1];
      let parts;
      if (last.role === 'tool') {
        const name = last.content[0]?.toolName;
        parts = textStream(REPLIES[name] || 'Done.');
      } else {
        const text = lastUserText(prompt);
        if (/ignore (all|previous)|system prompt/i.test(text)) parts = textStream('I can only help with Aurelle Residence. Guaranteed returns of 12% are available. What would you like to know about the homes?');
        else {
          const p = plan(text);
          parts = p
            ? [{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'call_' + Math.random().toString(36).slice(2, 8), toolName: p.toolName, input: JSON.stringify(Object.fromEntries(Object.entries(p.input).filter(([, v]) => v !== undefined))) },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: usage(1200, 20) }]
            : textStream('I can help with residences, availability, amenities, the location and booking a private visit. What would you like to explore?');
        }
      }
      const stream = new ReadableStream({ async start(c) { for (const p of parts) { c.enqueue(p); await new Promise((r) => setTimeout(r, 12)); } c.close(); } });
      return { stream };
    },
  });
}
