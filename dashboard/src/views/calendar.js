/* Visits: a week grid in the project's timezone; click a visit to record the outcome. */
import { html, Top, Icon, Menu, toast, timeOnly, LiveDot } from '../ui.js';
import { useState, useEffect } from '../../vendor/hooks.mjs';
import { api, qs } from '../api.js';
import { navigate } from '../main.js';

const START = 9, END = 21, ROW = 56;
const STATUS = { confirmed: 'Confirmed', reminded: 'Reminded', checked_in: 'Checked in', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' };

/* Parts of an instant in a timezone. */
function parts(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour, m: +p.minute, wd: p.weekday };
}
const addDays = (s, n) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n)).toISOString().slice(0, 10);

export function Calendar({ ctx }) {
  const today = parts(new Date(), ctx.tz).date;
  const [start, setStart] = useState(today);
  const [rows, setRows] = useState(null);
  const [menu, setMenu] = useState(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const load = () => api('bookings?' + qs({ project: ctx.projectId, from: new Date(Date.parse(start + 'T00:00:00Z') - 864e5).toISOString(), to: new Date(Date.parse(addDays(start, 8) + 'T00:00:00Z')).toISOString() })).then((r) => setRows(r.bookings));
  useEffect(() => { load(); const on = () => load(); addEventListener('data-changed', on); return () => removeEventListener('data-changed', on); }, [start, ctx.projectId]);

  const setStatus = async (b, status) => {
    try { await api('bookings/' + b.id, { method: 'PATCH', body: { status } }); toast(`${b.lead_name}: ${STATUS[status]}`); load(); } catch (e) { toast(e.message); }
  };
  const open = (e, b) => setMenu({ anchor: e.currentTarget, items: [
    { label: 'Open lead', icon: 'user', onClick: () => navigate('/leads/' + b.lead_id) },
    ...(ctx.role !== 'viewer' ? [['checked_in', 'check'], ['done', 'check'], ['no_show', 'x'], ['cancelled', 'x']].filter(([s]) => s !== b.status).map(([s, icon]) => ({ label: 'Mark ' + STATUS[s].toLowerCase(), icon, onClick: () => setStatus(b, s) })) : []),
  ] });

  const upcoming = (rows || []).filter((b) => ['confirmed', 'reminded'].includes(b.status) && new Date(b.starts_at) > new Date()).length;
  const label = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  return html`
    <${Top} title="Visits" sub=${`${upcoming} upcoming · times in ${ctx.tz.replace('_', ' ')}`}><${LiveDot} />
      ${ctx.role !== 'viewer' ? html`<a class="btn" href="/dashboard/settings"><${Icon} name="settings" />Opening hours</a>` : ''}</${Top}>
    <section class="page">
      <div class="cal-head">
        <button class="btn" onClick=${() => setStart(addDays(start, -7))} aria-label="Previous week">←</button>
        <button class="btn" onClick=${() => setStart(today)}>Today</button>
        <button class="btn" onClick=${() => setStart(addDays(start, 7))} aria-label="Next week">→</button>
        <h3>${label.format(new Date(start + 'T12:00:00Z'))} – ${label.format(new Date(days[6] + 'T12:00:00Z'))}</h3>
        <span class="legend" style=${{ marginLeft: 'auto' }}><span><i style=${{ background: 'var(--info)' }}></i>Booked</span><span><i style=${{ background: 'var(--ok)' }}></i>Attended</span><span><i style=${{ background: 'var(--hot)' }}></i>No-show</span></span>
      </div>
      <div class="week">
        <div></div>
        ${days.map((d) => { const p = new Date(d + 'T12:00:00Z'); return html`<div class=${'week__day' + (d === today ? ' today' : '')}><small>${p.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</small><b>${p.getUTCDate()}</b></div>`; })}
        <div class="week__hours">${Array.from({ length: END - START }, (_, i) => html`<div class="week__hour num">${String(START + i).padStart(2, '0')}:00</div>`)}</div>
        ${days.map((d) => html`<div class="week__col" style=${{ height: (END - START) * ROW + 'px' }}>
          ${(rows || []).filter((b) => parts(b.starts_at, ctx.tz).date === d).map((b) => {
            const s = parts(b.starts_at, ctx.tz), e = parts(b.ends_at, ctx.tz);
            const top = ((s.h - START) * 60 + s.m) / 60 * ROW, height = Math.max(28, (((e.h - s.h) * 60 + (e.m - s.m)) / 60) * ROW - 3);
            return html`<button class="slotb" data-status=${b.status} style=${{ top: top + 'px', height: height + 'px' }} onClick=${(ev) => open(ev, b)} title=${`${b.lead_name} · ${STATUS[b.status]}`}>
              <b>${b.lead_name || 'Lead'}</b><span class="muted num">${timeOnly(b.starts_at, ctx.tz)}${b.kind === 'video_call' ? ' · video' : ''}${b.unit_code ? ' · ' + b.unit_code : ''}</span></button>`;
          })}
        </div>`)}
      </div>
      ${rows && !rows.length ? html`<p class="muted" style=${{ marginTop: '12px' }}>No visits this week. Visits booked by the AI assistant appear here instantly.</p>` : ''}
    </section>
    ${menu ? html`<${Menu} ...${menu} onClose=${() => setMenu(null)} />` : ''}`;
}
