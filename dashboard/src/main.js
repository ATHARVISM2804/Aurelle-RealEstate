/* Aurelle sales dashboard — shell, routing, session, live pulse, command palette, shortcuts. */
import { html, render, Icon, Toasts, AskHost, toast, useInterval, Avatar } from './ui.js';
import { useState, useEffect, useRef, useMemo } from '../vendor/hooks.mjs';
import { api, qs } from './api.js';
import { Inbox } from './views/inbox.js';
import { LeadView } from './views/lead.js';
import { Pipeline } from './views/pipeline.js';
import { Calendar } from './views/calendar.js';
import { Insights } from './views/insights.js';
import { Units } from './views/units.js';
import { Settings } from './views/settings.js';
import { Login, AcceptInvite } from './views/login.js';

/* ---------- theme ---------- */
const savedTheme = localStorage.getItem('dash.theme');
const applyTheme = (t) => document.documentElement.setAttribute('data-theme', t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
applyTheme(savedTheme);

/* ---------- router (History API under /dashboard) ---------- */
const base = '/dashboard';
export function navigate(to, replace) {
  const url = to.startsWith('/') ? base + (to === '/' ? '' : to) : to;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  dispatchEvent(new Event('route'));
}
function useRoute() {
  const [path, set] = useState(location.pathname.replace(base, '') || '/');
  useEffect(() => {
    const on = () => set(location.pathname.replace(base, '') || '/');
    addEventListener('popstate', on); addEventListener('route', on);
    return () => { removeEventListener('popstate', on); removeEventListener('route', on); };
  }, []);
  return path;
}
/* <a> clicks inside the app stay in the app */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/dashboard"]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  e.preventDefault();
  navigate(a.getAttribute('href').replace(base, '') || '/');
});

const NAV = [
  ['/', 'Inbox', 'inbox', 'g i'], ['/pipeline', 'Pipeline', 'pipeline', 'g p'], ['/calendar', 'Visits', 'calendar', 'g c'],
  ['/insights', 'Insights', 'insights', 'g s'], ['/units', 'Inventory', 'units', 'g u'], ['/settings', 'Settings', 'settings', 'g ,'],
];

function App() {
  const path = useRoute();
  const [me, setMe] = useState(undefined);
  const [projectId, setProjectId] = useState(localStorage.getItem('dash.project'));
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.getAttribute('data-theme'));

  const loadMe = () => api('me').then(setMe).catch(() => setMe(null));
  useEffect(() => { loadMe(); const off = () => setMe(null); addEventListener('signed-out', off); return () => removeEventListener('signed-out', off); }, []);

  const project = useMemo(() => me?.projects?.find((p) => p.id === projectId) || me?.projects?.[0], [me, projectId]);
  useEffect(() => { if (project) localStorage.setItem('dash.project', project.id); }, [project]);

  if (path.startsWith('/invite')) return html`<${AcceptInvite} onDone=${() => { loadMe(); navigate('/', true); }} />`;
  if (me === undefined) return html`<div class="empty" style=${{ paddingTop: '30vh' }}><div class="skeleton" style=${{ width: '160px', margin: '0 auto' }}></div></div>`;
  if (!me) return html`<${Login} onDone=${loadMe} />`;
  if (!project) return html`<div class="empty"><b>No projects yet</b>Ask an owner to invite you to a project.</div>`;

  const toggleTheme = () => { const t = theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('dash.theme', t); applyTheme(t); setTheme(t); };
  const logout = async () => { await api('logout', { method: 'POST' }); setMe(null); navigate('/', true); };
  const ctx = { me, project, projectId: project.id, role: project.role, tz: project.timezone, currency: project.currency };

  let view;
  const leadMatch = path.match(/^\/leads\/([0-9a-f-]{36})/);
  if (leadMatch) view = html`<${LeadView} ctx=${ctx} id=${leadMatch[1]} key=${leadMatch[1]} />`;
  else if (path.startsWith('/pipeline')) view = html`<${Pipeline} ctx=${ctx} />`;
  else if (path.startsWith('/calendar')) view = html`<${Calendar} ctx=${ctx} />`;
  else if (path.startsWith('/insights')) view = html`<${Insights} ctx=${ctx} />`;
  else if (path.startsWith('/units')) view = html`<${Units} ctx=${ctx} />`;
  else if (path.startsWith('/settings')) view = html`<${Settings} ctx=${ctx} />`;
  else view = html`<${Inbox} ctx=${ctx} />`;

  return html`<div class="shell">
    <${Sidebar} ctx=${ctx} path=${path} theme=${theme} onTheme=${toggleTheme} onLogout=${logout} onProject=${setProjectId} onPalette=${() => setPalette(true)} />
    <main class="main" id="main">${view}</main>
    <${Pulse} ctx=${ctx} />
    <${Shortcuts} onPalette=${() => setPalette(true)} onHelp=${() => setHelp(true)} />
    ${palette ? html`<${Palette} ctx=${ctx} onClose=${() => setPalette(false)} onTheme=${toggleTheme} />` : ''}
    ${help ? html`<${Help} onClose=${() => setHelp(false)} />` : ''}
    <${Toasts} />
    <${AskHost} />
  </div>`;
}

function Sidebar({ ctx, path, theme, onTheme, onLogout, onProject, onPalette }) {
  const [counts, setCounts] = useState({});
  useEffect(() => { window.__setCounts = setCounts; }, []);
  const current = (p) => (p === '/' ? path === '/' || path.startsWith('/leads') : path.startsWith(p));
  return html`<aside class="side">
    <div class="brand"><svg viewBox="-2 6 104 128" aria-hidden="true"><path d="M10 130V50a40 40 0 0 1 80 0v80"/><path d="M12 130 50 10l38 120M26 130l24-82 24 82M12 130h14m48 0h14M24 92h52"/></svg>
      <div><b>Aurelle</b><small>Sales desk</small></div></div>
    ${ctx.me.projects.length > 1
      ? html`<select class="project select" aria-label="Project" value=${ctx.projectId} onChange=${(e) => { onProject(e.target.value); navigate('/'); }}>${ctx.me.projects.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select>`
      : html`<div class="project"><span>${ctx.project.name}</span><small>${ctx.role}</small></div>`}
    <nav class="nav" aria-label="Main">
      ${NAV.map(([href, label, icon]) => html`<a href=${'/dashboard' + (href === '/' ? '' : href)} aria-current=${current(href) ? 'page' : null}>
        <${Icon} name=${icon} />${label}
        ${href === '/' && counts.hot ? html`<span class="count hot num" title="Hot leads with no owner">${counts.hot}</span>` : href === '/' && counts.awaiting ? html`<span class="count num">${counts.awaiting}</span>` : ''}
      </a>`)}
    </nav>
    <div class="side__foot">
      <button class="btn btn--ghost" onClick=${onPalette} style=${{ justifyContent: 'flex-start' }}><${Icon} name="search" />Search<kbd style=${{ marginLeft: 'auto' }}>Ctrl K</kbd></button>
      <div class="me"><${Avatar} name=${ctx.me.user.name} /><div><b>${ctx.me.user.name}</b><small>${ctx.me.user.email}</small></div></div>
      <div class="side__tools">
        <button class="icon-btn" onClick=${onTheme} aria-label=${theme === 'dark' ? 'Light theme' : 'Dark theme'} title="Theme"><${Icon} name=${theme === 'dark' ? 'sun' : 'moon'} /></button>
        <button class="icon-btn" onClick=${onLogout} aria-label="Sign out" title="Sign out"><${Icon} name="logout" /></button>
      </div>
    </div>
  </aside>`;
}

/* Live updates: poll only while the tab is visible, pause after 10 idle minutes (keeps the database asleep). */
function Pulse({ ctx }) {
  const since = useRef(new Date().toISOString());
  const lastInput = useRef(Date.now());
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => {
    const v = () => setVisible(document.visibilityState === 'visible');
    const act = () => { lastInput.current = Date.now(); };
    document.addEventListener('visibilitychange', v);
    ['mousemove', 'keydown', 'scroll', 'touchstart'].forEach((e) => addEventListener(e, act, { passive: true }));
    return () => { document.removeEventListener('visibilitychange', v); ['mousemove', 'keydown', 'scroll', 'touchstart'].forEach((e) => removeEventListener(e, act)); };
  }, []);
  const tick = async () => {
    if (Date.now() - lastInput.current > 10 * 60e3) { window.__live?.(false); return; }
    window.__live?.(true);
    try {
      const r = await api('pulse?' + qs({ project: ctx.projectId, since: since.current }));
      since.current = r.now;
      window.__setCounts?.({ hot: r.hot_unassigned, awaiting: r.awaiting_reply });
      for (const a of r.alerts.reverse()) {
        const title = { hot_lead: 'Hot lead', human_requested: 'Wants to talk to sales', booking: 'Visit booked', booking_changed: 'Visit changed', no_show: 'No-show' }[a.kind] || 'Update';
        toast({ title: `${title}${a.lead_name ? ' · ' + a.lead_name : ''}`, text: a.payload?.why || a.payload?.when || a.payload?.request || '', onClick: () => a.lead_id && navigate('/leads/' + a.lead_id) });
      }
      if (r.alerts.length || r.new_leads) dispatchEvent(new Event('data-changed'));
    } catch (e) { /* offline: try again next tick */ }
  };
  useEffect(() => { if (visible) tick(); }, [visible, ctx.projectId]);
  useInterval(tick, visible ? 20000 : 0, [ctx.projectId]);
  return null;
}

/* ---------- keyboard ---------- */
function Shortcuts({ onPalette, onHelp }) {
  useEffect(() => {
    let g = 0;
    const on = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onPalette(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') { onHelp(); return; }
      if (e.key === '/') { const s = document.querySelector('[data-search]'); if (s) { e.preventDefault(); s.focus(); } return; }
      if (e.key === 'g') { g = Date.now(); return; }
      if (Date.now() - g < 900) {
        const to = { i: '/', p: '/pipeline', c: '/calendar', s: '/insights', u: '/units', ',': '/settings' }[e.key];
        if (to) { e.preventDefault(); navigate(to); }
        g = 0;
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);
  return null;
}

function Help({ onClose }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const rows = [['Ctrl K', 'Search & commands'], ['j / k', 'Next / previous lead'], ['Enter', 'Open lead'], ['/', 'Filter the list'], ['g i · g p · g c', 'Inbox · Pipeline · Visits'], ['g s · g u', 'Insights · Inventory'], ['e', 'Assign (on a lead)'], ['s', 'Change stage (on a lead)'], ['n', 'Add a note (on a lead)'], ['Esc', 'Back / close']];
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}><div class="modal" role="dialog" aria-label="Keyboard shortcuts">
    <h3>Keyboard shortcuts</h3>${rows.map(([k, v]) => html`<div class="field-row"><dt><kbd>${k}</kbd></dt><dd>${v}</dd></div>`)}
    <div class="row"><button class="btn" onClick=${onClose}>Close</button></div></div></div>`;
}

function Palette({ ctx, onClose, onTheme }) {
  const [q, setQ] = useState('');
  const [leads, setLeads] = useState([]);
  const [sel, setSel] = useState(0);
  const input = useRef();
  useEffect(() => { input.current.focus(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setLeads([]); return; }
    const t = setTimeout(() => api('search?' + qs({ q })).then((r) => setLeads(r.leads)).catch(() => {}), 160);
    return () => clearTimeout(t);
  }, [q]);
  const actions = [
    ...NAV.map(([href, label, icon]) => ({ label: 'Go to ' + label, icon, run: () => navigate(href) })),
    { label: 'Hot leads with no owner', icon: 'flame', run: () => navigate('/?view=hot_unassigned') },
    { label: 'Awaiting first reply', icon: 'chat', run: () => navigate('/?view=needs_reply') },
    { label: 'Toggle theme', icon: 'moon', run: onTheme },
    { label: 'Export leads (CSV)', icon: 'download', run: () => { location.href = '/api/a/export.csv?project=' + ctx.projectId; } },
  ].filter((a) => !q || a.label.toLowerCase().includes(q.toLowerCase()));
  const items = [...leads.map((l) => ({ label: l.name || l.phone_e164, hint: l.one_liner, icon: 'user', band: l.band, run: () => navigate('/leads/' + l.id) })), ...actions];
  useEffect(() => setSel(0), [q, leads.length]);
  const key = (e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && items[sel]) { items[sel].run(); onClose(); }
  };
  return html`<div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="palette" role="dialog" aria-label="Search and commands">
      <input ref=${input} value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${key} placeholder="Search leads by name, phone or email, or type a command…" aria-label="Search" />
      <ul role="listbox">
        ${leads.length ? html`<li class="group">Leads</li>` : ''}
        ${items.map((it, i) => html`${i === leads.length && leads.length ? html`<li class="group">Commands</li>` : ''}
          <li role="option" aria-selected=${i === sel} onMouseEnter=${() => setSel(i)} onClick=${() => { it.run(); onClose(); }}>
            <${Icon} name=${it.icon} size="15" /><span>${it.label}</span>${it.band ? html`<span class=${'band band--' + it.band}><i></i>${it.band}</span>` : ''}<small>${it.hint || ''}</small></li>`)}
        ${!items.length ? html`<li class="group">No matches</li>` : ''}
      </ul>
    </div></div>`;
}

render(html`<${App} />`, document.getElementById('app'));
