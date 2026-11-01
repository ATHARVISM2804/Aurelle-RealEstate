/* Provider registry. CHAT_MODEL = "provider:model-id"; only the selected provider is imported.
   groq:openai/gpt-oss-120b | anthropic:claude-haiku-5-5 | google:gemini-3.5-flash-lite */

const cache = new Map();

export async function getModel(spec) {
  const s = spec || process.env.CHAT_MODEL || 'groq:openai/gpt-oss-120b';
  if (cache.has(s)) return cache.get(s);
  const i = s.indexOf(':');
  const provider = s.slice(0, i), id = s.slice(i + 1);
  let model;
  if (provider === 'groq') {
    const { createGroq } = await import('@ai-sdk/groq');
    model = createGroq({ apiKey: process.env.GROQ_API_KEY })(id);
  } else if (provider === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(id);
  } else if (provider === 'google') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    model = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })(id);
  } else if (provider === 'mock' && !process.env.VERCEL) {   // local development only
    const { mockModel } = await import('./mock-model.mjs');
    model = mockModel();
  } else {
    throw new Error('Unknown model provider in ' + s);
  }
  const entry = { model, spec: s, provider };
  cache.set(s, entry);
  return entry;
}

/* Per-language override (CHAT_MODEL_AR / CHAT_MODEL_HI) when evals show the default is weak. */
export function modelSpecFor(lang) {
  if (lang === 'ar' && process.env.CHAT_MODEL_AR) return process.env.CHAT_MODEL_AR;
  if ((lang === 'hi' || lang === 'hi-Latn') && process.env.CHAT_MODEL_HI) return process.env.CHAT_MODEL_HI;
  return process.env.CHAT_MODEL || 'groq:openai/gpt-oss-120b';
}

export function providerOptions(provider) {
  if (provider === 'groq') return { groq: { reasoningEffort: 'low', parallelToolCalls: false } };
  return undefined;
}
