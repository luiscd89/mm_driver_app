import { currentUser, logout as authLogout } from "./auth.js";
import { state, activateRoute, confirmRoute, dispatchRoute } from "./state.js";
import { toast } from "./toast.js";

export function renderDriverApp() {
  if (!currentUser) return;
  const routes = state.routes;

  const nameEl = document.getElementById('driverNameHeader');
  const dateEl = document.getElementById('driverDateHeader');
  if (nameEl) nameEl.textContent = currentUser.displayName || currentUser.email;
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US',
    { weekday:'long', month:'short', day:'numeric' });

  const dispatched = routes.filter(r => r.dispatched).length;
  document.getElementById('statTotal').textContent = routes.length;
  document.getElementById('statDone').textContent  = dispatched;

  const now = new Date();
  let nextTime = null;
  routes.forEach(r => {
    if (r.dispatched) return;
    if (!r.stops?.length) return;
    const dt = new Date(r.date + 'T' + r.stops[0].time + ':00');
    if (dt > now && (!nextTime || dt < nextTime)) nextTime = dt;
  });
  document.getElementById('statNext').textContent = nextTime
    ? nextTime.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})
    : '—';

  renderRoutesTab();
  renderGasHistory();
}

function renderRoutesTab() {
  const routes = state.routes;
  const container = document.getElementById('driverRoutesTab');
  if (!container) return;

  if (!routes.length) {
    container.innerHTML = '<div style="text-align:center;padding:48px;color:var(--muted)"><div style="font-size:36px;margin-bottom:10px">📭</div><p>No routes assigned</p></div>';
    return;
  }

  const byDate = {};
  routes.forEach(r => { (byDate[r.date] ||= []).push(r); });

  const now = new Date();
  container.innerHTML = Object.entries(byDate).sort().map(([date, dayRoutes]) => {
    const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US',
      { weekday:'long', month:'short', day:'numeric' });
    return `<div class="date-section">
      <div class="date-label">${label}</div>
      ${dayRoutes.map(r => renderRouteCard(r, now)).join('')}
    </div>`;
  }).join('');
}

function renderRouteCard(r, now) {
  const firstStop = r.stops?.[0];
  const active = !!r.active;
  const confirmed = !!r.confirmed;
  const dispatched = !!r.dispatched;
  const typeClass = (r.shipper || '').toLowerCase().includes('amzl') ? 'amzl'
                  : (r.shipper || '').toLowerCase().includes('ddu')  ? 'ddu' : '';

  let countdownHtml = '';
  if (firstStop?.time && !dispatched) {
    const dt = new Date(r.date + 'T' + firstStop.time + ':00');
    const diffMin = (dt - now) / 60000;
    let cls = '', txt = '';
    if (diffMin < -30)     { cls='past';  txt='past'; }
    else if (diffMin < 0)  { cls='alert'; txt='late'; }
    else if (diffMin < 15) { cls='now';   txt='NOW';  }
    else if (diffMin < 60) { cls='soon';  txt=`${Math.round(diffMin)}m`; }
    else                   { cls='';      txt=`${Math.round(diffMin/60)}h`; }
    countdownHtml = `<div class="rc-countdown ${cls}">${txt}</div>`;
  }

  const facs = (r.stops || []).map(s => s.facility || '—');
  const cardClass = dispatched ? 'done' : (confirmed ? 'active-route' : 'upcoming');

  return `<div class="route-card ${cardClass}">
    <div class="route-card-header">
      <div class="rc-left">
        <div class="rc-load">${r.load_id}</div>
        <div class="rc-route">${r.route || facs.join(' → ')}</div>
        <div class="rc-meta">
          <span class="rc-pill ${typeClass}">${(r.shipper||'').replace('Outbound','')}</span>
          <span class="rc-pill">${r.distance || 0} mi</span>
          <span class="rc-pill">${r.stops?.length || 0} stops</span>
        </div>
      </div>
      <div class="rc-time">
        <div class="rc-start">${firstStop?.time || '—'}</div>
        ${countdownHtml}
      </div>
    </div>
    <div class="route-stops">
      ${facs.map((f,i) => {
        const s = r.stops?.[i];
        const isFirst = i === 0, isLast = i === facs.length-1;
        return `<div class="stop-row">
          <div class="stop-num ${isFirst?'first':isLast?'last':''}">${i+1}</div>
          <div class="stop-fac">${f}</div>
          <div class="stop-time">${s?.time || ''}</div>
        </div>`;
      }).join('')}
    </div>
    ${!dispatched ? `<div class="route-actions">
      <button class="action-btn active-btn ${active?'done':''}" data-action="activate" data-id="${r.load_id}" ${active?'disabled':''}>
        ${active ? '✅ On My Way' : '📍 Active — On My Way'}
      </button>
      <button class="action-btn confirm ${confirmed?'done':''}" data-action="confirm" data-id="${r.load_id}" ${!active?'disabled':''}>
        ${confirmed ? '✅ In Truck' : '🚛 Confirm In Truck'}
      </button>
      <button class="action-btn dispatch ${dispatched?'done':''}" data-action="dispatch" data-id="${r.load_id}" ${!confirmed?'disabled':''}>
        ${dispatched ? '✅ Dispatched' : '🚦 Dispatch'}
      </button>
    </div>` : ''}
  </div>`;
}

function renderGasHistory() {
  const list = document.getElementById('gasHistoryList');
  if (!list) return;
  const rows = state.gasReceipts;
  if (!rows.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:16px">No receipts yet</div>';
    return;
  }
  list.innerHTML = rows.slice(0, 5).map(r => `
    <div class="gas-entry">
      <img src="${r.imageUrl}" alt="Receipt">
      <div class="gas-entry-info">
        <div class="ge-amount">$${r.amount}</div>
        <div class="ge-load">${r.load_id}</div>
        <div class="ge-date">${r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : ''}</div>
        ${r.notes ? `<div style="font-size:10px;color:var(--muted)">${r.notes}</div>` : ''}
      </div>
    </div>`).join('');
}

export function wireDriverEvents() {
  document.getElementById('driverRoutesTab').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    try {
      if (btn.dataset.action === 'activate') {
        await activateRoute(id, currentUser.uid);
        toast('📍 Active! GPS tracking started.', 'success');
      } else if (btn.dataset.action === 'confirm') {
        const r = state.routes.find(x => x.load_id === id);
        if (!r?.active) { toast('Hit Active first!', 'warn'); return; }
        await confirmRoute(id);
        toast('✅ Confirmed in truck!', 'success');
      } else if (btn.dataset.action === 'dispatch') {
        const r = state.routes.find(x => x.load_id === id);
        if (!r?.confirmed) { toast('Confirm in truck first!', 'warn'); return; }
        await dispatchRoute(id);
        toast('🚦 Dispatched! Safe travels!', 'success');
      }
    } catch (err) {
      toast(err.message, 'alert');
    }
  });

  document.querySelectorAll('.dtab').forEach((t, i) => {
    t.addEventListener('click', () => switchDriverTab(['routes','gas'][i]));
  });

  document.getElementById('logoutBtn').addEventListener('click', authLogout);
}

function switchDriverTab(tab) {
  document.querySelectorAll('.dtab').forEach((t, i) =>
    t.classList.toggle('active', ['routes','gas'][i] === tab));
  document.getElementById('driverRoutesTab').style.display = tab === 'routes' ? 'block' : 'none';
  document.getElementById('driverGasTab').style.display    = tab === 'gas'    ? 'block' : 'none';
}
