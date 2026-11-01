/* Pipeline: one column per stage, drag (or keyboard "Move to…") to advance, rotting badges for idle leads. */
import { html, Top, Band, Avatar, Menu, toast, ask, daysSince, STAGES, LiveDot } from '../ui.js';
import { useState, useEffect } from '../../vendor/hooks.mjs';
import { api, qs } from '../api.js';
import { navigate } from '../main.js';

const ROT = { new: 1, contacted: 3, qualified: 5, visit_booked: 7, visited: 5, negotiation: 10 };

export function Pipeline({ ctx }) {
  const [leads, setLeads] = useState(null);
  const [over, setOver] = useState(null);
  const [menu, setMenu] = useState(null);
  const [showLost, setShowLost] = useState(false);
  const load = () => api('leads?' + qs({ project: ctx.projectId, view: 'all', limit: 200, sort: 'activity' })).then((r) => setLeads(r.leads));
  useEffect(() => { load(); const on = () => load(); addEventListener('data-changed', on); return () => removeEventListener('data-changed', on); }, [ctx.projectId]);

  const move = async (lead, stage) => {
    if (lead.stage === stage) return;
    let lost_reason;
    if (stage === 'lost') { lost_reason = await ask({ title: 'Mark as lost', label: 'What happened?', ok: 'Mark lost' }); if (!lost_reason) return; }
    const before = leads;
    setLeads((x) => x.map((l) => (l.id === lead.id ? { ...l, stage, stage_changed_at: new Date().toISOString() } : l)));   // optimistic
    try { await api('leads/' + lead.id, { method: 'PATCH', body: { stage, lost_reason } }); toast(`${lead.name || 'Lead'} → ${STAGES.find((s) => s[0] === stage)[1]}`); }
    catch (e) { setLeads(before); toast(e.message); }
  };

  const cols = STAGES.filter(([k]) => showLost || k !== 'lost');
  const total = (k) => (leads || []).filter((l) => l.stage === k).length;
  return html`
    <${Top} title="Pipeline" sub="Drag a card to move it — or focus a card and press Enter for “Move to…”"><${LiveDot} />
      <button class="btn" aria-pressed=${showLost} onClick=${() => setShowLost(!showLost)}>${showLost ? 'Hide lost' : 'Show lost'}</button></${Top}>
    <section class="page"><div class="board">
      ${cols.map(([k, label, color]) => html`<div class=${'col' + (over === k ? ' over' : '')}
          onDragOver=${(e) => { e.preventDefault(); setOver(k); }} onDragLeave=${() => setOver(null)}
          onDrop=${(e) => { e.preventDefault(); setOver(null); const l = leads.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (l) move(l, k); }}>
        <div class="col__h"><span class="stage" style=${{ '--s': color }}><b>${label}</b></span><small class="num">${total(k)}</small></div>
        ${leads === null ? html`<div class="skeleton" style=${{ height: '70px' }}></div>` : ''}
        ${(leads || []).filter((l) => l.stage === k).map((l) => {
          const idle = daysSince(l.last_activity_at), late = ROT[k] && idle >= ROT[k];
          return html`<button class="kcard" draggable="true" key=${l.id}
            onDragStart=${(e) => { e.dataTransfer.setData('text/plain', l.id); e.currentTarget.classList.add('dragging'); }}
            onDragEnd=${(e) => e.currentTarget.classList.remove('dragging')}
            onClick=${() => navigate('/leads/' + l.id)}
            onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMenu({ anchor: e.currentTarget, items: [{ label: 'Open lead', onClick: () => navigate('/leads/' + l.id) }, ...STAGES.filter(([s]) => s !== l.stage).map(([s, lab]) => ({ label: 'Move to ' + lab, onClick: () => move(l, s) }))] }); } }}>
            <div class="kcard__top"><b>${l.name || l.phone_e164}</b><${Band} band=${l.band} score=${l.score} /></div>
            <p>${l.one_liner || ''}</p>
            <div class="kcard__foot"><${Avatar} name=${l.owner_name} />${l.is_broker ? html`<span class="pill">Broker</span>` : ''}
              <span class=${'rot' + (late ? ' late' : '')} title=${late ? 'No activity for a while' : 'Days since last activity'}>${idle ? idle + 'd idle' : 'today'}</span></div>
          </button>`;
        })}
      </div>`)}
    </div></section>
    ${menu ? html`<${Menu} ...${menu} onClose=${() => setMenu(null)} />` : ''}`;
}
