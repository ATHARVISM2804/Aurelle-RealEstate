/* Number + claims guardrail for assistant replies. Pure: no I/O.
   Every money / percent / area / length / year figure in a reply must come from a tool result or a
   confirmed fact; counts must be known or small. Forbidden claims (ROI, guaranteed...) and
   commitments about not-yet-confirmed topics (payment plan, handover...) are blocked.
   A blocked sentence is replaced with a safe line in the reply's language. */

const DIGIT_MAPS = [['٠', 0x0660], ['۰', 0x06f0], ['०', 0x0966]];

export function normalizeDigits(s) {
  let out = String(s);
  for (const [, base] of DIGIT_MAPS) out = out.replace(new RegExp(`[${String.fromCharCode(base)}-${String.fromCharCode(base + 9)}]`, 'g'), (c) => String(c.charCodeAt(0) - base));
  return out.replace(/٬/g, ',').replace(/٫/g, '.')
    // models write "3 356" / "3 356" (thin / no-break spaces) as thousands separators, and "15‑P1" with a no-break hyphen
    .replace(/(\d)[   ](?=\d{3}(?!\d))/g, '$1,')
    .replace(/[‐‑‒–−]/g, '-');
}

const CURRENCY = /(?:\bAED\b|\bDhs?\b|\bdirhams?\b|درهم|\bUSD\b|US\$|\$|₹|\bINR\b|\bRs\.?|\brupees?\b|रुपये|रुपए|\bSAR\b|€|\bEUR\b|£|\bGBP\b)/i;
const MAGNITUDES = [
  [/^(?:k|K|thousand|ألف|هزار|हज़ार|हजार)\b/, 1e3],
  [/^(?:lakhs?|lacs?|लाख)/i, 1e5],
  [/^(?:crores?|cr\b|करोड़|करोड)/i, 1e7],
  [/^(?:M\b|mn\b|mio\b|million|millions|مليون|ملايين|मिलियन)/, 1e6],
  [/^(?:bn\b|billion|مليار|बिलियन)/i, 1e9],
];
const AREA = /^(?:sq\.?\s?ft|sqft|square\s+f(?:ee|oo)t|sq\.?\s?m\b|sqm|m²|m2\b|square\s+met(?:er|re)s?|قدم\s?مربع|متر\s?مربع|वर्ग\s?फ़ुट|वर्ग\s?फुट)/i;
const PERCENT = /^(?:%|٪|percent|per\s?cent|प्रतिशत|بالمائة|في\s?المائة)/i;
const LENGTH = /^(?:m\b|metres?|meters?|متر|मीटर)/i;
const MONTHS = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|year|yr|يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر|जनवरी|दिसंबर|साल)/i;

/* Mask things that look numeric but are fine: unit codes, URLs, emails, times (checked separately). */
function mask(text, ctx) {
  const masks = [];
  let t = text;
  const put = (re, kind) => { t = t.replace(re, (m) => { masks.push({ kind, value: m }); return ` §${masks.length - 1}§ `; }); };
  put(/https?:\/\/\S+/g, 'url');
  put(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'email');
  if (ctx.unitCodeRe) put(new RegExp(ctx.unitCodeRe.source, 'gi'), 'unit');
  put(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b(?:\s?(?:am|pm))?/gi, 'time');
  put(/\b(?:1[0-2]|0?[1-9])\s?(?:am|pm)\b/gi, 'time');
  for (const p of ctx.phones || []) if (p) put(new RegExp(p.replace(/\D/g, '').split('').join('[\\s-]?'), 'g'), 'phone');
  return { text: t, masks };
}

/* Extract numbers with their class from a sentence. */
export function extractNumbers(sentence, ctx = {}) {
  const norm = normalizeDigits(sentence);
  const { text, masks } = mask(norm, ctx);
  const found = [];
  // letters may touch a number ("AED900k", "3M", "Q4"); digits, separators and mask markers may not
  const re = /(?<![\d§.,])(\d{1,3}(?:,\d{2,3})+(?!\d)|\d+)(\.\d+)?(?![\d§])|(?<![\d§])(\.\d+)(?![\d§])/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    let value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const after = text.slice(m.index + raw.length).replace(/^\s+/, '');
    const before = text.slice(Math.max(0, m.index - 14), m.index);
    const near = before + ' ' + after.slice(0, 14);
    let cls = 'count';
    let mag = 1;
    for (const [mre, mult] of MAGNITUDES) if (mre.test(after)) { mag = mult; break; }
    const currencyNear = CURRENCY.test(near);
    if (PERCENT.test(after)) cls = 'percent';
    else if (AREA.test(after)) cls = 'area';
    else if (mag > 1 && (mag !== 1e6 || /^(?:M\b|mn\b|mio\b|million|millions|مليون|ملايين|मिलियन)/.test(after))) cls = 'money';
    else if (currencyNear) cls = 'money';
    else if (LENGTH.test(after)) cls = 'length';
    else if (value >= 1900 && value <= 2100 && !raw.includes(',') && (MONTHS.test(near) || /\b(in|by|from|until|till)\s*$/i.test(before))) cls = 'year';
    else if (value >= 10000) cls = 'money';
    if (cls === 'money' && /^m\b/.test(after) && currencyNear) mag = 1e6;
    if (cls === 'money') value *= mag;
    found.push({ raw: raw + (mag > 1 ? ' ×' + mag : ''), value, cls });
  }
  const times = masks.filter((x) => x.kind === 'time').map((x) => x.value);
  return { numbers: found, times };
}

/* Collect allowed numbers from tool outputs. Keys tell us the class. */
export function allowedFromTool(output, into = emptyAllowed()) {
  const walk = (v, key = '') => {
    if (v == null) return;
    if (typeof v === 'number') return addAllowed(into, v, classForKey(key));
    if (typeof v === 'string') {
      for (const { value, cls } of extractNumbers(v).numbers) addAllowed(into, value, cls === 'count' ? classForKey(key) : cls);
      for (const t of extractNumbers(v).times) into.times.add(normTime(t));
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(output);
  return into;
}

function classForKey(key) {
  const k = key.toLowerCase();
  if (/price|budget|amount|aed|cost/.test(k)) return 'money';
  if (/area|sqft|apartment|balcony|total/.test(k)) return 'area';
  if (/percent|pct/.test(k)) return 'percent';
  return 'count';
}

export function emptyAllowed() {
  return { money: [], area: [], percent: [], length: [], year: new Set(), any: new Set(), times: new Set(), counts: new Set() };
}

export function addAllowed(a, value, cls = 'count') {
  if (!Number.isFinite(value)) return a;
  a.any.add(value);
  if (cls === 'money') a.money.push(value);
  else if (cls === 'area') a.area.push(value);
  else if (cls === 'percent') a.percent.push(value);
  else if (cls === 'length') a.length.push(value);
  else if (cls === 'year') a.year.add(value);
  return a;
}

const normTime = (t) => {
  const m = String(t).toLowerCase().match(/(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)?/);
  if (!m) return t;
  let h = Number(m[1]);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + (m[2] || '00');
};

const near = (list, v, tol) => list.some((x) => Math.abs(x - v) <= Math.max(tol * Math.abs(x), 0.0001));

export function checkNumber(n, allowed) {
  switch (n.cls) {
    case 'money': return near(allowed.money, n.value, 0.005);
    case 'percent': return near(allowed.percent, n.value, 0);
    // sizes and lengths must come from facts or tools; the visitor's own numbers never vouch for them
    case 'area': return near(allowed.area, n.value, 0.005) || [...allowed.any].some((x) => Math.abs(x - n.value) <= 1 && x >= 100);
    case 'length': return near(allowed.length, n.value, 0) || allowed.any.has(n.value);
    case 'year': return allowed.year.has(n.value);
    default: return allowed.any.has(n.value) || Boolean(allowed.counts?.has(n.value)) || n.value <= 20;
  }
}

const NEGATION = /\b(can't|cannot|can not|won't|unable|not able|don't|do not|isn't|is not|no|never|not in a position|wouldn't)\b|لا أستطيع|لا يمكن|لا|नहीं|nahi|nahin/i;
const COMMIT = /\b(will be|expected|scheduled|planned|by q[1-4]|in q[1-4]|completion in|handover in|ready by|ready in|guarantee|is \d|are \d|starts at|from \d)/i;
/* Amounts written in words ("two point five million", "eight percent") can't be checked, so they don't pass. */
const WORD_AMOUNT = /\b(percent|per\s?cent|millions?|billions?|lakhs?|lacs?|crores?|thousand)\b|٪|مليون|مليار|ألف|بالمائة|लाख|करोड़|प्रतिशत|मिलियन/i;

/* A claim is negated only when the negation sits shortly before it in the same clause
   ("I can't comment on ROI" — yes; "Don't miss our guaranteed discount" — no, the negation governs "miss"). */
function negatedBefore(lower, index) {
  const clause = lower.slice(0, index).split(/[,;:.!?]|\b(?:but|however|and|so)\b/).pop();
  const words = clause.trim().split(/\s+/).slice(-6).join(' ');
  return NEGATION.test(words) && !/\b(miss|forget|wait|hesitate|delay)\b/.test(words);
}

/* Check one sentence. Returns { ok, reasons[] }. */
export function checkSentence(sentence, ctx) {
  const reasons = [];
  const lower = sentence.toLowerCase();
  const { numbers, times } = extractNumbers(sentence, ctx);
  for (const n of numbers) if (!checkNumber(n, ctx.allowed)) reasons.push(`${n.cls}:${n.raw}`);
  for (const t of times) if (!ctx.allowed.times.has(normTime(t))) reasons.push('time:' + t);
  if (WORD_AMOUNT.test(sentence) && !numbers.some((n) => n.cls === 'money' || n.cls === 'percent')) reasons.push('words:amount');
  const negated = NEGATION.test(sentence);
  for (const phrase of ctx.forbidden || []) {
    const m = new RegExp(`(^|[^\\p{L}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu').exec(lower);
    if (m && !negatedBefore(lower, m.index)) reasons.push('claim:' + phrase);
  }
  for (const p of ctx.pending || []) {
    if (!p.keywords?.some((k) => lower.includes(k.toLowerCase()))) continue;
    if (numbers.length || (COMMIT.test(sentence) && !negated)) reasons.push('pending:' + p.topic);
  }
  return { ok: reasons.length === 0, reasons };
}

export const SAFE_LINES = {
  en: "I can't confirm that detail here, but a consultant can — I can send you the latest price sheet or arrange a call.",
  ar: 'لا أستطيع تأكيد هذه التفاصيل هنا، لكن يمكن لأحد مستشارينا ذلك. يمكنني إرسال أحدث قائمة أسعار أو ترتيب مكالمة.',
  hi: 'मैं यहाँ यह जानकारी पक्की नहीं कर सकता, लेकिन हमारे सलाहकार कर सकते हैं — मैं नवीनतम प्राइस शीट भेज सकता हूँ या कॉल तय कर सकता हूँ।',
  'hi-Latn': 'Yeh detail main yahan confirm nahi kar sakta, lekin hamare consultant kar sakte hain — main latest price sheet bhej sakta hoon ya call arrange kar sakta hoon.',
};

/* Splits a stream of text deltas into sentences, checking each before release. */
export class SentenceGuard {
  constructor(ctx, lang = 'en') {
    this.ctx = ctx; this.lang = lang; this.buf = ''; this.violations = []; this.released = '';
  }
  /* Feed a delta; returns text safe to send now (possibly ''). */
  push(delta) {
    this.buf += delta;
    let out = '';
    for (;;) {
      const cut = this.findCut();
      if (cut < 0) break;
      out += this.release(this.buf.slice(0, cut));
      this.buf = this.buf.slice(cut);
    }
    return out;
  }
  findCut() {
    const m = /[.!?؟।\n]+["')\]]*(\s+)/.exec(this.buf);
    if (m) {
      // don't cut inside a decimal like "1.25" or right after a single capital initial
      return m.index + m[0].length;
    }
    if (this.buf.length > 280) {
      const ws = this.buf.lastIndexOf(' ', 280);
      return ws > 40 ? ws + 1 : 280;
    }
    return -1;
  }
  release(sentence) {
    if (!sentence.trim()) return sentence;
    const r = checkSentence(sentence, this.ctx);
    if (r.ok) { this.released += sentence; return sentence; }
    this.violations.push({ original: sentence.trim(), reasons: r.reasons });
    const trail = sentence.match(/\s*$/)[0] || ' ';
    // one safe line per reply is enough
    if (this.violations.length > 1 && this.released.includes(SAFE_LINES[this.lang] || SAFE_LINES.en)) return '';
    const safe = (SAFE_LINES[this.lang] || SAFE_LINES.en) + trail;
    this.released += safe;
    return safe;
  }
  /* Flush the remainder at the end of the stream. */
  end() {
    const rest = this.buf; this.buf = '';
    return rest ? this.release(rest) : '';
  }
}

/* Build the allowed set for a turn. */
export function buildAllowed({ factNumbers = [], factTexts = [], toolOutputs = [], extra = [], now = new Date() } = {}) {
  const a = emptyAllowed();
  for (const n of factNumbers) {
    addAllowed(a, n, 'count');
    if (n >= 100) a.area.push(n);
    if (n % 1 !== 0 && n < 20) a.length.push(n);
  }
  for (const t of factTexts) for (const time of extractNumbers(t).times) a.times.add(normTime(time));
  for (const o of toolOutputs) allowedFromTool(o, a);
  a.counts = new Set(extra);              // visitor-typed counts: only ever accepted as plain counts
  a.year.add(now.getUTCFullYear());
  a.any.add(now.getUTCFullYear());
  return a;
}
