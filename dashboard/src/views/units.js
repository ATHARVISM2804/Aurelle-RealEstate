/* Inventory: every residence by floor, its status (what the website shows) and how many visitors explored it. */
import { html, Top, Menu, toast, money } from '../ui.js';
import { useState, useEffect } from '../../vendor/hooks.mjs';
import { api, qs } from '../api.js';

export function Units({ ctx }) {
  const [units, setUnits] = useState(null);
  const [menu, setMenu] = useState(null);
  const load = () => api('units?' + qs({ project: ctx.projectId })).then((r) => setUnits(r.units));
  useEffect(() => { load(); }, [ctx.projectId]);
  const canEdit = ['manager', 'owner'].includes(ctx.role);
  const set = async (u, status) => {
    try { await api('units/' + u.code, { method: 'PATCH', body: { project: ctx.projectId, status } }); toast(`${u.code} is now ${status}`); load(); } catch (e) { toast(e.message); }
  };
  const levels = units ? [...new Set(units.map((u) => u.level))].sort((a, b) => b - a) : [];
  const maxViews = Math.max(1, ...(units || []).map((u) => u.viewers));
  const count = (s) => (units || []).filter((u) => u.status === s).length;
  return html`
    <${Top} title="Inventory" sub=${units ? `${count('available')} available · ${count('reserved')} reserved · ${count('sold')} sold — the website and the assistant use these statuses` : 'Loading…'} />
    <section class="page">
      <div class="card"><div class="card__b unit-grid">
        ${levels.map((lv) => html`<div class="unit-row"><span class="num">L${String(lv).padStart(2, '0')}</span>
          ${units.filter((u) => u.level === lv).sort((a, b) => a.code.localeCompare(b.code)).map((u) => html`<button class="ucell" data-status=${u.status} disabled=${!canEdit}
              title=${`${u.code} · ${u.name} · ${u.status}${u.viewers ? ' · ' + u.viewers + ' explored' : ''}`}
              onClick=${(e) => setMenu({ anchor: e.currentTarget, items: ['available', 'reserved', 'sold'].filter((s) => s !== u.status).map((s) => ({ label: 'Mark ' + s, onClick: () => set(u, s) })) })}>
            <b>${u.code}</b><small>${u.name}</small><small>${u.status === 'sold' ? 'Sold' : money(u.price_from, ctx.currency)}</small>
            ${u.viewers ? html`<span class="heat" style=${{ width: Math.max(8, (u.viewers / maxViews) * 100) + '%' }} title=${u.viewers + ' visitors explored this'}></span>` : ''}
          </button>`)}</div>`)}
        ${!units ? html`<div class="skeleton" style=${{ height: '200px' }}></div>` : ''}
      </div></div>
      <p class="muted" style=${{ marginTop: '10px', fontSize: '11.5px' }}>The red line shows how many visitors explored a residence in 3D. Prices shown here are internal; the website shows them only once pricing is published.</p>
    </section>
    ${menu ? html`<${Menu} ...${menu} onClose=${() => setMenu(null)} />` : ''}`;
}
