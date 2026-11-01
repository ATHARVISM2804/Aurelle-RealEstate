/* Inbox: every lead, hot ones pinned under "Needs action", keyboard-first. */
import { html, Top, Icon, Band, ScoreRing, Stage, Avatar, ago, when, budgetText, fieldVal, sourceLabel, LiveDot } from '../ui.js';
import { useState, useEffect, useRef } from '../../vendor/hooks.mjs';
import { api, qs } from '../api.js';
import { navigate } from '../main.js';

const TABS = [
  ['', 'Active'], ['hot_unassigned', 'Hot · no owner'], ['needs_reply', 'Awaiting reply'], ['visits_week', 'Visits this week'], ['mine', 'My leads'], ['brokers', 'Brokers'], ['all', 'All'],
];

export function Inbox({ ctx }) {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState(params.get('view') || '');
  const [band, setBand] = useState([]);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(false);
  const [sel, setSel] = useState(0);
  const tbody = useRef();

  const load = async (append = false) => {
    const query = { project: ctx.projectId, view: view === 'mine' ? '' : view, owner: view === 'mine' ? 'me' : '', band, q, offset: append ? rows.length : 0 };
    const r = await api('leads?' + qs(query));
    setRows(append ? [...rows, ...r.leads] : r.leads);
    setMore(r.more);
  };
  useEffect(() => { const t = setTimeout(() => load().catch(() => setRows([])), q ? 220 : 0); return () => clearTimeout(t); }, [view, band.join(), q, ctx.projectId]);
  useEffect(() => { const on = () => load().catch(() => {}); addEventListener('data-changed', on); return () => removeEventListener('data-changed', on); }, [view, band.join(), q]);
  useEffect(() => { history.replaceState({}, '', '/dashboard' + (view ? '?view=' + view : '')); }, [view]);

  // j / k / Enter
  useEffect(() => {
    const on = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || !rows?.length) return;
      if (e.key === 'j') setSel((s) => Math.min(s + 1, rows.length - 1));
      else if (e.key === 'k') setSel((s) => Math.max(s - 1, 0));
      else if (e.key === 'Enter' && rows[sel]) navigate('/leads/' + rows[sel].id);
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [rows, sel]);
  useEffect(() => { tbody.current?.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const pinned = rows?.filter((r) => r.pinned) || [];
  const rest = rows?.filter((r) => !r.pinned) || [];
  const toggleBand = (b) => setBand((x) => (x.includes(b) ? x.filter((y) => y !== b) : [...x, b]));
  let idx = -1;
  const row = (l) => {
    idx++;
    const i = idx;
    const units = fieldVal(l.unit_interest) || [];
    const config = fieldVal(l.configuration);
    return html`<tr key=${l.id} class=${(l.pinned ? 'pinned ' : '') + (i === sel ? 'sel' : '')} onClick=${() => navigate('/leads/' + l.id)} onMouseEnter=${() => setSel(i)}>
      <td><div class="lead-cell"><span class=${'unread-dot' + (l.unread ? '' : ' off')} title=${l.unread ? 'New activity' : ''}></span>
        <div><b>${l.name || l.phone_e164 || 'Unnamed'}${l.is_broker ? html` <span class="pill">Broker</span>` : ''}</b><small>${l.one_liner || l.phone_e164 || ''}</small></div></div></td>
      <td><${ScoreRing} score=${l.score} band=${l.band} /></td>
      <td class="hide-m"><div class="two"><span>${config || '—'}</span>${units.length ? html`<small>${units.slice(0, 3).join(' · ')}</small>` : ''}</div></td>
      <td class="hide-m num">${budgetText(l.budget, ctx.currency)}</td>
      <td class="hide-m"><div class="two"><span>${sourceLabel(l.source)}</span>${l.campaign ? html`<small>${l.campaign}</small>` : ''}</div></td>
      <td><${Stage} stage=${l.stage} /></td>
      <td class="hide-m">${l.next_visit ? html`<span class="pill pill--warm num">${when(l.next_visit, ctx.tz)}</span>` : html`<span class="muted">—</span>`}</td>
      <td class="hide-m"><${Avatar} name=${l.owner_name} /></td>
      <td class="muted hide-m">${ago(l.last_activity_at)}</td>
    </tr>`;
  };

  return html`
    <${Top} title="Inbox" sub=${rows ? `${rows.length}${more ? '+' : ''} leads` : 'Loading…'}><${LiveDot} />
      <a class="btn" href=${'/api/a/export.csv?project=' + ctx.projectId} download><${Icon} name="download" />Export</a></${Top}>
    <section class="page">
      <div class="toolbar">
        <div class="tabs" role="toolbar" aria-label="Views">${TABS.map(([k, label]) => html`<button aria-pressed=${view === k} onClick=${() => { setView(k); setSel(0); }}>${label}</button>`)}</div>
        <div style=${{ display: 'flex', gap: '6px', marginLeft: 'auto', alignItems: 'center' }}>
          ${['hot', 'warm', 'cold'].map((b) => html`<button class=${'band band--' + b} style=${{ border: 0, opacity: band.length && !band.includes(b) ? 0.4 : 1 }} aria-pressed=${band.includes(b)} onClick=${() => toggleBand(b)}><i></i>${b}</button>`)}
          <label class="search"><${Icon} name="search" /><span class="sr">Filter leads</span><input class="input" data-search placeholder="Name, phone, email…  /" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
        </div>
      </div>
      <div class="table-wrap">
        ${rows === null ? html`<div style=${{ padding: '20px', display: 'grid', gap: '14px' }}>${[1, 2, 3, 4, 5].map(() => html`<div class="skeleton"></div>`)}</div>`
          : !rows.length ? html`<div class="empty"><b>Nothing here yet</b>New enquiries from the website and the AI assistant appear here the moment they come in.</div>`
            : html`<table class="leads"><thead><tr><th>Lead</th><th>Score</th><th class="hide-m">Interest</th><th class="hide-m">Budget</th><th class="hide-m">Source</th><th>Stage</th><th class="hide-m">Visit</th><th class="hide-m">Owner</th><th class="hide-m">Activity</th></tr></thead>
              <tbody ref=${tbody}>
                ${pinned.length ? html`<tr class="group"><td colspan="9"><${Icon} name="flame" size="11" /> Needs action · hot, and no owner or no reply yet · ${pinned.length}</td></tr>` : ''}
                ${pinned.map(row)}
                ${pinned.length && rest.length ? html`<tr class="group"><td colspan="9">Everything else</td></tr>` : ''}
                ${rest.map(row)}
              </tbody></table>`}
      </div>
      ${more ? html`<div class="more"><button class="btn" onClick=${() => load(true)}>Load more</button></div>` : ''}
      <p class="muted" style=${{ marginTop: '12px', fontSize: '11.5px' }}><kbd>j</kbd> <kbd>k</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Ctrl K</kbd> to search · <kbd>?</kbd> for shortcuts</p>
    </section>`;
}
