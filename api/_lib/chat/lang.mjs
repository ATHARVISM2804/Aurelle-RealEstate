/* Language detection (en / ar / hi / hi-Latn) and personal-data redaction before text reaches the model. */

const HINGLISH = /\b(hai|hain|kya|kyaa|nahi|nahin|mujhe|chahiye|kitna|kitne|kitni|kaise|kab|kahan|aur|bhi|wala|wali|ghar|flat|dikhao|batao|bataiye|accha|acha|theek|haan|ji|aap|apka|aapka|mera|meri|hum|humko|lena|dekhna|kya hai|ho sakta)\b/gi;

export function detectLang(text, fallback = 'en') {
  const s = String(text || '');
  const letters = s.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters.length) return fallback;
  const arabic = (s.match(/[؀-ۿ]/g) || []).length;
  const deva = (s.match(/[ऀ-ॿ]/g) || []).length;
  if (arabic / letters.length > 0.3) return 'ar';
  if (deva / letters.length > 0.3) return 'hi';
  const words = s.split(/\s+/).filter(Boolean).length;
  const hits = (s.match(HINGLISH) || []).length;
  if (hits >= 2 || (hits === 1 && words <= 4)) return 'hi-Latn';
  if (/^[\x00-\x7f]*$/.test(s) && words >= 2) return 'en';
  return fallback;
}

const PATTERNS = [
  ['email', /[\w.+-]+@[\w-]+\.[\w.]{2,}/g],
  ['id', /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g],          // Emirates ID
  ['id', /\b[A-Z]{5}\d{4}[A-Z]\b/g],                          // PAN
  ['id', /\b\d{4}\s?\d{4}\s?\d{4}\b/g],                       // Aadhaar-like 12 digits
  ['id', /\b[A-Z]\d{7,8}\b/g],                                // passport-like
  ['phone', /(?:\+|00)?\d[\d\s().-]{7,16}\d/g],
];

/* Returns { text, found: { email, phone, id } }. The original is stored; only `text` goes to the model. */
export function redact(input) {
  let text = String(input || '');
  const found = { email: false, phone: false, id: false };
  for (const [kind, re] of PATTERNS) {
    text = text.replace(re, (m) => {
      if (kind === 'phone' && m.replace(/\D/g, '').length < 8) return m;   // prices like 2,350,000 have separators but no +; keep short ones
      if (kind === 'phone' && /^\d{1,3}(,\d{3})+$/.test(m.trim())) return m;
      found[kind] = true;
      return `[${kind} removed]`;
    });
  }
  return { text, found };
}
