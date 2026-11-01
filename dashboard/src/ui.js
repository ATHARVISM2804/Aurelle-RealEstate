/* Shared UI: htm binding, icons, badges, score ring, sparklines, formatters, toasts, menus. */
import { h, render } from '../vendor/preact.mjs';
import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import htm from '../vendor/htm.mjs';

export const html = htm.bind(h);
export { h, render };

/* ---------- formatting ---------- */
export const STAGES = [
  ['new', 'New', '#8f8a80'], ['contacted', 'Contacted', '#3a6ea5'], ['qualified', 'Qualified', '#6b5fb5'], ['visit_booked', 'Visit booked', '#b98a2e'],
  ['visited', 'Visited', '#2f8f83'], ['negotiation', 'Negotiation', '#b5523b'], ['booked', 'Booked', '#3f8a4c'], ['lost', 'Lost', '#a39d92'],
];
export const stageLabel = (s) => (STAGES.find((x) => x[0] === s) || [s, s])[1];
export const stageColor = (s) => (STAGES.find((x) => x[0] === s) || [0, 0, '#8f8a80'])[2];

export function ago(d) {
  if (!d) return '—';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 0) return inFuture(-s);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
const inFuture = (s) => (s < 3600 ? 'in ' + Math.ceil(s / 60) + 'm' : s < 86400 ? 'in ' + Math.round(s / 3600) + 'h' : 'in ' + Math.round(s / 86400) + 'd');
export const daysSince = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
export function when(d, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
}
export function timeOnly(d, tz) { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d)); }
export function money(v, cur = 'AED') {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n >= 1e6 ? `${cur} ${(n / 1e6).toFixed(n % 1e6 ? 2 : 0).replace(/\.?0+$/, '')}M` : `${cur} ${Math.round(n / 1e3)}k`;
}
export function budgetText(b, cur) {
  if (!b) return '—';
  if (b.min && b.max) return `${money(b.min, cur)}–${money(b.max, cur).replace(/^\w+ /, '')}`;
  if (b.max || b.min) return money(b.max || b.min, cur);
  return b.value || '—';
}
export const fieldVal = (f) => (f == null ? null : typeof f === 'object' && 'value' in f ? f.value : f);
export const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
export function duration(sec) {
  if (sec == null) return '—';
  if (sec < 60) return Math.round(sec) + 's';
  if (sec < 3600) return Math.round(sec / 60) + 'm';
  if (sec < 86400) return (sec / 3600).toFixed(1).replace(/\.0$/, '') + 'h';
  return (sec / 86400).toFixed(1).replace(/\.0$/, '') + 'd';
}
export const SOURCE_LABEL = { facebook: 'Meta · Facebook', instagram: 'Meta · Instagram', google: 'Google Ads', direct: 'Direct', 'propertyfinder.ae': 'Property Finder', 'bayut.com': 'Bayut' };
export const sourceLabel = (s) => SOURCE_LABEL[s] || s || 'Direct';

/* ---------- icons (1.6px strokes) ---------- */
const P = {
  inbox: 'M3 13h4l2 3h6l2-3h4M5 5h14l2 8v6H3v-6z', pipeline: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v5h-4z', calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  insights: 'M4 20V10M10 20V4M16 20v-7M22 20H2', units: 'M4 3h16v18H4zM4 9h16M4 15h16M10 3v18', settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1V4h-4v3l-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1v3h4v-3l2-1 2 1 2-4z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z', logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11', back: 'M15 18l-6-6 6-6', chat: 'M4 5h16v11H8l-4 4z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10', pin: 'M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', note: 'M5 3h10l4 4v14H5zM14 3v5h5M8 13h8M8 17h5',
  phone: 'M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z', mail: 'M3 5h18v14H3zM3 6l9 7 9-7', flame: 'M12 22c4 0 7-3 7-7 0-5-5-7-4-12-3 2-6 5-6 9-1-1-2-3-2-3-1 2-2 4-2 6 0 4 3 7 7 7z',
  doc: 'M6 2h9l5 5v15H6zM14 2v6h6', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4', arrow: 'M5 12h14M13 6l6 6-6 6', whatsapp: 'M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z',
};
export const Icon = ({ name, size }) => html`<svg viewBox="0 0 24 24" width=${size} height=${size} aria-hidden="true" stroke-linecap="round" stroke-linejoin="round"><path d=${P[name] || ''} /></svg>`;

/* ---------- badges ---------- */
export const Band = ({ band, score }) => html`<span class=${'band band--' + band}><i></i>${band}${score != null ? html` <b class="num">${score}</b>` : ''}</span>`;
export const Stage = ({ stage }) => html`<span class="stage" style=${{ '--s': stageColor(stage) }}>${stageLabel(stage)}</span>`;
export const Avatar = ({ name, lg }) => html`<span class=${'avatar' + (lg ? ' avatar--lg' : '')} title=${name || 'Unassigned'}>${name ? initials(name) : '–'}</span>`;
export const Tag = ({ source }) => source ? html`<span class=${'tag tag--' + source} title=${source === 'ai' ? 'Extracted by AI from the conversation' : source === 'rep' ? 'Set by your team' : 'From the form'}>${source === 'ai' ? 'AI' : source === 'rep' ? 'Team' : 'Form'}</span>` : null;

export function ScoreRing({ score, band, size = 26 }) {
  const r = (size - 4) / 2, c = 2 * Math.PI * r;
  const color = band === 'hot' ? 'var(--hot)' : band === 'warm' ? 'var(--warm)' : 'var(--cold)';
  return html`<span class="score"><svg class="ring" width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} aria-hidden="true">
    <circle class="track" cx=${size / 2} cy=${size / 2} r=${r} />
    <circle cx=${size / 2} cy=${size / 2} r=${r} stroke=${color} stroke-dasharray=${`${(c * Math.min(score, 100)) / 100} ${c}`} stroke-linecap="round" />
  </svg><span class="n num">${score}</span></span>`;
}

/* ---------- charts (hand-drawn SVG) ---------- */
export function Sparkline({ values, color = 'var(--text)', height = 30, fill = true }) {
  const v = values?.length ? values : [0];
  const max = Math.max(...v, 1), w = 100, step = v.length > 1 ? w / (v.length - 1) : w;
  const pts = v.map((x, i) => [i * step, height - 2 - (x / max) * (height - 6)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return html`<svg viewBox=${`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    ${fill ? html`<path d=${d + ` L${w} ${height} L0 ${height} Z`} fill=${color} opacity=".07" />` : ''}
    <path d=${d} fill="none" stroke=${color} stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
  </svg>`;
}

export function Bars({ series, height = 200 }) {
  // series: [{label, a, b}] — a = bars, b = line overlay
  const W = 600, H = height, pad = 24, n = series.length || 1;
  const max = Math.max(1, ...series.map((s) => Math.max(s.a, s.b || 0)));
  const bw = (W - pad) / n;
  const y = (v) => H - 20 - (v / max) * (H - 36);
  const line = series.map((s, i) => (i ? 'L' : 'M') + (pad + i * bw + bw / 2).toFixed(1) + ' ' + y(s.b || 0).toFixed(1)).join(' ');
  const ticks = [0, Math.ceil(max / 2), max];
  return html`<svg class="chart" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Leads and visits per day">
    ${ticks.map((t) => html`<g><line x1=${pad} x2=${W} y1=${y(t)} y2=${y(t)} stroke="var(--border)" /><text x="0" y=${y(t) + 4} font-size="10" fill="var(--muted)">${t}</text></g>`)}
    ${series.map((s, i) => html`<rect x=${pad + i * bw + bw * 0.18} width=${bw * 0.64} y=${y(s.a)} height=${Math.max(0, H - 20 - y(s.a))} rx="2" fill="var(--muted)" opacity=".32"><title>${s.label}: ${s.a} leads, ${s.b} visits</title></rect>`)}
    <path d=${line} fill="none" stroke="var(--hot)" stroke-width="2" vector-effect="non-scaling-stroke" />
    ${series.map((s, i) => (i % Math.ceil(n / 6) === 0 ? html`<text x=${pad + i * bw + bw / 2} y=${H - 4} font-size="10" text-anchor="middle" fill="var(--muted)">${s.label}</text>` : ''))}
  </svg>`;
}

/* ---------- toasts ---------- */
let pushToast = () => {};
export function Toasts() {
  const [items, set] = useState([]);
  useEffect(() => {
    pushToast = (t) => { const id = Math.random(); set((x) => [...x.slice(-3), { ...t, id }]); setTimeout(() => set((x) => x.filter((y) => y.id !== id)), t.ms || 6000); };
  }, []);
  return html`<div class="toasts" role="status" aria-live="polite">${items.map((t) => html`<div class="toast" onClick=${() => { t.onClick?.(); set((x) => x.filter((y) => y.id !== t.id)); }}>
    ${t.dot !== false ? html`<span class="dot"></span>` : ''}<div><b>${t.title}</b>${t.text ? html`<small>${t.text}</small>` : ''}</div></div>`)}</div>`;
}
export const toast = (t) => pushToast(typeof t === 'string' ? { title: t, dot: false, ms: 3000 } : t);

/* ---------- popover menu ---------- */
export function Menu({ anchor, items, onClose }) {
  const ref = useRef();
  const r = anchor.getBoundingClientRect();
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const off = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchor.focus(); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key, true); };
  }, []);
  const top = Math.min(r.bottom + 4, innerHeight - items.length * 34 - 20);
  return html`<div class="menu" ref=${ref} role="menu" style=${{ top: top + 'px', left: Math.min(r.left, innerWidth - 220) + 'px' }}>
    ${items.map((it) => html`<button role="menuitem" onClick=${() => { onClose(); it.onClick(); }}>${it.icon ? html`<${Icon} name=${it.icon} size="14" />` : ''}${it.label}</button>`)}
  </div>`;
}

export function useInterval(fn, ms, deps = []) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => { if (!ms) return; const id = setInterval(() => saved.current(), ms); return () => clearInterval(id); }, [ms, ...deps]);
}

/* Page header with the serif title, a subtitle and actions on the right. */
export function Top({ title, sub, children }) {
  const ref = useRef();
  useEffect(() => {
    const on = () => ref.current?.classList.toggle('scrolled', scrollY > 4);
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  useEffect(() => { document.title = (typeof title === 'string' ? title : 'Lead') + ' · Aurelle sales'; }, [title]);
  return html`<header class="top" ref=${ref}><div><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ''}</div><div class="top__right">${children}</div></header>`;
}

export function LiveDot() {
  const [on, set] = useState(true);
  useEffect(() => { window.__live = set; }, []);
  return html`<span class=${'live' + (on ? '' : ' paused')} title=${on ? 'Updates every 20 seconds while this tab is open' : 'Paused while idle — move the mouse to resume'}><i></i>${on ? 'Live' : 'Paused'}</span>`;
}

/* In-app text prompt (instead of window.prompt): const v = await ask({ title, label, value }) */
let openAsk = () => Promise.resolve(null);
export const ask = (opts) => openAsk(opts);
export function AskHost() {
  const [req, set] = useState(null);
  const input = useRef();
  useEffect(() => { openAsk = (opts) => new Promise((resolve) => set({ ...opts, resolve })); }, []);
  useEffect(() => { if (req) setTimeout(() => input.current?.select(), 20); }, [req]);
  if (!req) return null;
  const done = (v) => { req.resolve(v); set(null); };
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && done(null)} onKeyDown=${(e) => e.key === 'Escape' && done(null)}>
    <form class="modal" role="dialog" aria-label=${req.title} onSubmit=${(e) => { e.preventDefault(); done(input.current.value.trim() || null); }}>
      <h3>${req.title}</h3>
      <label class="muted" style=${{ display: 'grid', gap: '6px', fontSize: '12px' }}>${req.label}
        <input class="input" ref=${input} value=${req.value || ''} placeholder=${req.placeholder || ''} style=${{ height: '38px' }} /></label>
      <div class="row"><button type="button" class="btn" onClick=${() => done(null)}>Cancel</button><button class="btn btn--primary">${req.ok || 'Save'}</button></div>
    </form></div>`;
}
