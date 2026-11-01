/* Settings: visit opening hours (with a live preview of the slots buyers will see) and the team. */
import { html, Top, Icon, toast, ago } from '../ui.js';
import { useState, useEffect } from '../../vendor/hooks.mjs';
import { api, qs } from '../api.js';

const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function Settings({ ctx }) {
  const manager = ['manager', 'owner'].includes(ctx.role);
  return html`<${Top} title="Settings" sub=${ctx.project.name} />
    <section class="page" style=${{ display: 'grid', gap: '16px' }}>
      <${Availability} ctx=${ctx} kind="site_visit" title="Site visits at the sales gallery" editable=${manager} />
      <${Availability} ctx=${ctx} kind="video_call" title="Video calls" editable=${manager} />
      <${Team} ctx=${ctx} manager=${manager} />
    </section>`;
}

function Availability({ ctx, kind, title, editable }) {
  const [rows, setRows] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    api('availability?' + qs({ project: ctx.projectId })).then((r) => {
      const mine = r.rules.filter((x) => x.kind === kind);
      setRows(WD.map((_, i) => { const x = mine.find((m) => m.weekday === i); return x ? { on: true, ...x } : { on: false, weekday: i, start: '10:00', end: '18:00', slot_minutes: mine[0]?.slot_minutes || 45, capacity: mine[0]?.capacity || 1, location: mine[0]?.location }; }));
    });
  }, [ctx.projectId]);
  const upd = (i, k, v) => { setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setDirty(true); };
  const save = async () => {
    try {
      const r = await api('availability', { method: 'PUT', body: { project: ctx.projectId, kind, rules: rows.filter((x) => x.on).map(({ weekday, start, end, slot_minutes, capacity, location }) => ({ weekday, start, end, slot_minutes: +slot_minutes, capacity: +capacity, location })) } });
      setPreview(r.preview); setDirty(false); toast('Opening hours saved — the assistant offers the new times right away');
    } catch (e) { toast(e.message); }
  };
  if (!rows) return html`<div class="card"><div class="card__b"><div class="skeleton"></div></div></div>`;
  return html`<div class="card"><div class="card__h"><span class="eyebrow">${title}</span>${editable ? html`<button class="btn btn--primary btn--sm" disabled=${!dirty} onClick=${save}>Save hours</button>` : ''}</div>
    <div class="card__b"><div class="avail">
      <div class="avail__row muted" style=${{ fontSize: '11px' }}><span>Day</span><span>Open</span><span>From</span><span>Until</span><span>Slot length</span><span>Visitors per slot</span></div>
      ${rows.map((r, i) => html`<div class="avail__row">
        <b style=${{ fontWeight: 500 }}>${WD[r.weekday]}</b>
        <button class="switch" role="switch" aria-checked=${r.on} aria-label=${'Open on ' + WD[r.weekday]} disabled=${!editable} onClick=${() => upd(i, 'on', !r.on)}></button>
        <input class="input" type="time" step="900" value=${r.start} disabled=${!editable || !r.on} onInput=${(e) => upd(i, 'start', e.target.value)} />
        <input class="input" type="time" step="900" value=${r.end} disabled=${!editable || !r.on} onInput=${(e) => upd(i, 'end', e.target.value)} />
        <select class="select" value=${r.slot_minutes} disabled=${!editable || !r.on} onChange=${(e) => upd(i, 'slot_minutes', +e.target.value)}>${[15, 30, 45, 60, 90].map((m) => html`<option value=${m}>${m} min</option>`)}</select>
        <input class="input" type="number" min="1" max="20" value=${r.capacity} disabled=${!editable || !r.on} onInput=${(e) => upd(i, 'capacity', +e.target.value)} />
      </div>`)}
    </div>
    ${preview ? html`<p class="eyebrow" style=${{ margin: '16px 0 8px' }}>What buyers will see this week</p><div class="preview">${preview.map((d) => html`<div><b>${d.label}</b>${d.slots.length ? `${d.slots.length} slots · ${d.slots[0].label}–${d.slots.at(-1).label}` : 'Closed'}</div>`)}</div>` : ''}
    </div></div>`;
}

function Team({ ctx, manager }) {
  const [t, setT] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('agent');
  const [link, setLink] = useState('');
  const load = () => api('team?' + qs({ project: ctx.projectId })).then(setT);
  useEffect(() => { load(); }, [ctx.projectId]);
  const invite = async (e) => {
    e.preventDefault();
    try { const r = await api('invites', { method: 'POST', body: { project: ctx.projectId, email, role } }); setLink(r.link); setEmail(''); toast(r.emailed ? 'Invite emailed' : 'Invite created — copy the link below'); load(); }
    catch (x) { toast(x.message); }
  };
  return html`<div class="card"><div class="card__h"><span class="eyebrow">Team</span></div><div class="card__b">
    ${(t?.members || []).map((m) => html`<div class="field-row" style=${{ gridTemplateColumns: '1fr 90px 120px 110px' }}>
      <dt style=${{ color: 'var(--text)' }}><b style=${{ fontWeight: 500 }}>${m.name}</b> <span class="muted">${m.email}</span></dt>
      <dd><span class="pill">${m.role}</span></dd><dd class="muted">${m.open_leads} open leads</dd><dd class="muted">${m.last_login_at ? 'seen ' + ago(m.last_login_at) : 'never signed in'}</dd></div>`)}
    ${(t?.invites || []).map((i) => html`<div class="field-row"><dt>${i.email}</dt><dd class="muted">Invited as ${i.role} · pending</dd></div>`)}
    ${manager ? html`<form onSubmit=${invite} style=${{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
      <input class="input" type="email" required placeholder="colleague@company.com" value=${email} onInput=${(e) => setEmail(e.target.value)} style=${{ flex: 1, minWidth: '220px' }} />
      <select class="select" value=${role} onChange=${(e) => setRole(e.target.value)}><option value="agent">Agent</option><option value="manager">Manager</option><option value="viewer">Viewer</option>${ctx.role === 'owner' ? html`<option value="owner">Owner</option>` : ''}</select>
      <button class="btn btn--primary"><${Icon} name="plus" />Invite</button></form>` : ''}
    ${link ? html`<p class="muted" style=${{ marginTop: '10px', fontSize: '12px', wordBreak: 'break-all' }}>Invite link (valid 7 days): <code>${link}</code></p>` : ''}
    <p class="muted" style=${{ marginTop: '12px', fontSize: '11.5px' }}>Agents see their own and unassigned leads. Managers can edit hours, inventory and invite people. Owners can do everything.</p>
  </div></div>`;
}
