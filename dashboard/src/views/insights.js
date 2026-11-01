/* Insights: KPIs vs the previous period, daily leads/visits, funnel by source & campaign, most-explored units. */
import { html, Top, Sparkline, Bars, duration, sourceLabel } from '../ui.js';
import { useState, useEffect } from '../../vendor/hooks.mjs';
import { api, qs } from '../api.js';
import { navigate } from '../main.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

export function Insights({ ctx }) {
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); api('kpis?' + qs({ project: ctx.projectId, days })).then(setD).catch(() => setD(false)); }, [days, ctx.projectId]);

  const c = d?.current || {}, p = d?.previous || {};
  const s = d?.series || [];
  const show = pct(c.shows, c.due), showPrev = pct(p.shows, p.due);
  const conv = pct(c.bookings_won, c.visited), convPrev = pct(p.bookings_won, p.visited);
  const cards = [
    ['New leads', c.new_leads, p.new_leads, s.map((x) => x.leads), 'up'],
    ['Hot leads', c.hot_leads, p.hot_leads, s.map((x) => x.hot), 'up', 'var(--hot)'],
    ['Visits booked', c.visits_booked, p.visits_booked, s.map((x) => x.visits), 'up'],
    ['Show rate', show == null ? '—' : show + '%', showPrev, null, 'up'],
    ['Visit → booking', conv == null ? '—' : conv + '%', convPrev, null, 'up'],
    ['Median first reply', duration(c.median_response_s), p.median_response_s, null, 'down', null, true],
  ];
  return html`
    <${Top} title="Insights" sub="Is the website turning ad clicks into visits?">
      <div class="tabs">${[7, 30, 90].map((n) => html`<button aria-pressed=${days === n} onClick=${() => setDays(n)}>${n} days</button>`)}</div></${Top}>
    <section class="page">
      ${d === false ? html`<div class="empty"><b>Couldn’t load insights</b>Try again in a moment.</div>` : ''}
      <div class="kpis">${cards.map(([label, value, prev, spark, good, color, isTime]) => {
        let delta = '', dir = '';
        const cur = typeof value === 'number' ? value : isTime ? c.median_response_s : parseFloat(value);
        if (d && prev != null && Number.isFinite(cur) && Number(prev) !== 0) {
          const ch = Math.round(((cur - prev) / prev) * 100);
          if (ch) { delta = `${ch > 0 ? '▲' : '▼'} ${Math.abs(ch)}% vs previous ${days}d`; dir = (ch > 0) === (good === 'up') ? 'up' : 'down'; }
        }
        return html`<div class="card kpi"><span class="eyebrow">${label}</span><div class="v">${d ? value ?? 0 : html`<div class="skeleton" style=${{ height: '30px', width: '60%' }}></div>`}</div>
          <div class=${'d ' + dir}>${delta || (d ? 'No change' : '')}</div>${spark ? html`<${Sparkline} values=${spark} color=${color || 'var(--text)'} />` : ''}</div>`;
      })}</div>

      <div class="grid2">
        <div class="card"><div class="card__h"><span class="eyebrow">Leads & visits per day</span><span class="legend"><span><i style=${{ background: 'var(--muted)', opacity: .5 }}></i>Leads</span><span><i style=${{ background: 'var(--hot)' }}></i>Visits booked</span></span></div>
          <div class="card__b">${d ? html`<${Bars} series=${s.map((x) => ({ label: x.day.slice(8) + '/' + x.day.slice(5, 7), a: x.leads, b: x.visits }))} />` : html`<div class="skeleton" style=${{ height: '200px' }}></div>`}</div></div>
        <div class="card"><div class="card__h"><span class="eyebrow">Lead quality now</span></div><div class="card__b">
          ${d ? ['hot', 'warm', 'cold'].map((b) => { const n = d.bands.find((x) => x.band === b)?.n || 0, tot = d.bands.reduce((a, x) => a + x.n, 0) || 1;
            return html`<div class="grp" style=${{ gridTemplateColumns: '70px 1fr 40px', margin: '10px 0' }}><span class=${'band band--' + b}><i></i>${b}</span><span class="bar"><i style=${{ width: (n / tot) * 100 + '%', background: `var(--${b})` }}></i></span><span class="num">${n}</span></div>`; }) : ''}
          <p class="eyebrow" style=${{ marginTop: '18px' }}>Most explored in 3D</p>
          ${d?.top_units?.length ? d.top_units.map((u) => html`<div class="grp" style=${{ gridTemplateColumns: '70px 1fr 40px', margin: '8px 0' }}><b>${u.code}</b><span class="bar"><i style=${{ width: (u.visitors / d.top_units[0].visitors) * 100 + '%' }}></i></span><span class="num">${u.visitors}</span></div>`) : html`<p class="muted" style=${{ marginTop: '6px' }}>No 3D activity yet.</p>`}
        </div></div>
      </div>

      <div class="card"><div class="card__h"><span class="eyebrow">Funnel by source and campaign</span><span class="muted">Where your best leads come from — compare against ad spend</span></div><div class="card__b">
        ${d?.funnel?.length ? html`<table class="funnel"><thead><tr><th>Source · campaign</th><th>Leads</th><th>Hot</th><th>Contacted</th><th>Visit booked</th><th>Visited</th><th>Booked</th></tr></thead><tbody>
          ${d.funnel.map((r) => html`<tr><td><div class="src"><b>${sourceLabel(r.source)}</b>${r.campaign ? html`<small>${r.campaign}</small>` : ''}</div><div class="mini-bar"><i style=${{ width: (r.leads / d.funnel[0].leads) * 100 + '%' }}></i></div></td>
            <td class="num">${r.leads}</td>
            ${['hot', 'contacted', 'visit_booked', 'visited', 'booked'].map((k) => html`<td class="num">${r[k]}<span class="rate">${pct(r[k], r.leads) ?? 0}%</span></td>`)}</tr>`)}
        </tbody></table>` : html`<p class="muted">${d ? 'No leads in this period.' : 'Loading…'}</p>`}
      </div></div>
      ${d ? html`<p class="muted" style=${{ marginTop: '12px', fontSize: '11.5px' }}>${c.chats} assistant conversations · AI cost this period ≈ $${(Number(c.ai_cost_micros || 0) / 1e6).toFixed(2)}</p>` : ''}
    </section>`;
}
