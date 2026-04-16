import { currentUser, logout as authLogout } from "./auth.js";
import { state, activateRoute, confirmRoute, dispatchRoute, updateDriverStatus } from "./state.js";
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

  // Cache routes offline
  try {
    localStorage.setItem('cachedRoutes', JSON.stringify(routes));
  } catch {}
}

function renderRoutesTab() {
  const routes = state.routes;
  const container = document.getElementById('driverRoutesTab');
  if (!container) return;

  if (!routes.length) {
    // Try offline cache
    let cached = [];
    try { cached = JSON.parse(localStorage.getItem('cachedRoutes') || '[]'); } catch {}
    if (cached.length) {
      container.innerHTML = '<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:11px;color:var(--warn);">Showing cached routes — you may be offline</div>'
        + renderRouteCards(cached);
      return;
    }
    container.innerHTML = '<div style="text-align:center;padding:48px;color:var(--muted)"><div style="font-size:36px;margin-bottom:10px">📭</div><p>No routes assigned</p></div>';
    return;
  }

  // Availability toggle + route cards + logs
  container.innerHTML = renderAvailabilityToggle() + renderRouteCards(routes) + renderLogsSection();
}

function renderAvailabilityToggle() {
  const driver = state.allDrivers?.find(d => d.uid === currentUser?.uid);
  const status = driver?.availability || 'on-duty';
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;">Status</div>
    <select id="availabilitySelect" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font-size:12px;font-weight:600;">
      <option value="on-duty" ${status==='on-duty'?'selected':''}>On Duty</option>
      <option value="on-break" ${status==='on-break'?'selected':''}>On Break</option>
      <option value="off-duty" ${status==='off-duty'?'selected':''}>Off Duty</option>
    </select>
  </div>`;
}

function renderRouteCards(routes) {
  const byDate = {};
  routes.forEach(r => { (byDate[r.date] ||= []).push(r); });

  const now = new Date();
  return Object.entries(byDate).sort().map(([date, dayRoutes]) => {
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

  // Progress step
  const step = dispatched ? 3 : confirmed ? 2 : active ? 1 : 0;
  const stepLabels = ['Not Started', 'Step 1/3: On My Way', 'Step 2/3: In Truck', 'Complete'];

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

  // Delivery notes from admin
  const notesHtml = r.notes ? `<div style="background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3);border-radius:8px;padding:8px 12px;margin:0 16px 10px;font-size:11px;color:var(--blue);">
    <span style="font-weight:700;">Note:</span> ${r.notes}
  </div>` : '';

  // Progress bar
  const progressHtml = !dispatched ? `<div style="padding:0 16px 8px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
      <div style="flex:1;height:3px;border-radius:2px;background:var(--border);overflow:hidden;">
        <div style="width:${Math.round(step/3*100)}%;height:100%;background:var(--accent);border-radius:2px;transition:width .3s;"></div>
      </div>
      <span style="font-size:9px;color:var(--muted);white-space:nowrap;">${stepLabels[step]}</span>
    </div>
  </div>` : '';

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
    ${notesHtml}
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
    ${progressHtml}
    ${!dispatched ? `<div class="route-actions">
      <button class="action-btn active-btn ${active?'done':''}" data-action="activate" data-id="${r.load_id}" ${active?'disabled':''}>
        ${active ? '✅ On My Way' : '📍 Active'}
      </button>
      <button class="action-btn confirm ${confirmed?'done':''}" data-action="confirm" data-id="${r.load_id}" ${!active?'disabled':''}>
        ${confirmed ? '✅ In Truck' : '🚛 Confirm'}
      </button>
      <button class="action-btn dispatch ${dispatched?'done':''}" data-action="dispatch" data-id="${r.load_id}" ${!confirmed?'disabled':''}>
        ${dispatched ? '✅ Done' : '🚦 Dispatch'}
      </button>
    </div>` : ''}
  </div>`;
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const sun = new Date(now); sun.setDate(now.getDate() - day);
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(sun)} – ${fmt(sat)}`;
}

function renderLogsSection() {
  const logs = state.tripLogs;
  if (!logs.length) return '';

  const logsByDate = {};
  logs.forEach(l => {
    const date = l.activeTime ? l.activeTime.slice(0, 10) : 'Unknown';
    (logsByDate[date] ||= []).push(l);
  });

  const totalMiles = logs.reduce((s, l) => s + (l.distanceMiles || 0), 0);
  const totalMinutes = logs.reduce((s, l) => s + (l.transitMinutes || 0), 0);
  const totalTrips = logs.length;
  const completedTrips = logs.filter(l => l.status === 'dispatched').length;

  return `
    <div style="margin-top:20px;">
      <div class="date-label">📊 Weekly Log (${getWeekRange()})</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px;">
        <div class="log-stats-grid">
          <div class="log-stat-cell">
            <div class="log-stat-val" style="color:var(--accent);">${totalMiles.toFixed(1)}</div>
            <div class="log-stat-lbl">Miles</div>
          </div>
          <div class="log-stat-cell">
            <div class="log-stat-val" style="color:var(--accent2);">${formatDuration(totalMinutes)}</div>
            <div class="log-stat-lbl">Transit</div>
          </div>
          <div class="log-stat-cell">
            <div class="log-stat-val" style="color:var(--blue);">${totalTrips}</div>
            <div class="log-stat-lbl">Trips</div>
          </div>
          <div class="log-stat-cell">
            <div class="log-stat-val" style="color:var(--ok);">${completedTrips}</div>
            <div class="log-stat-lbl">Done</div>
          </div>
        </div>
        <button id="exportLogsBtn" style="width:100%;margin-top:10px;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:12px;font-weight:600;cursor:pointer;">📥 Export Weekly Log (CSV)</button>
      </div>
      ${Object.entries(logsByDate).sort().reverse().map(([date, dayLogs]) => {
        const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US',
          { weekday: 'long', month: 'short', day: 'numeric' });
        return `<div class="date-section">
          <div class="date-label">${label}</div>
          ${dayLogs.map(l => renderLogCard(l)).join('')}
        </div>`;
      }).join('')}
    </div>`;
}

function renderLogCard(log) {
  const statusColors = { active: 'var(--accent2)', confirmed: 'var(--blue)', dispatched: 'var(--ok)' };
  const statusLabels = { active: '📍 Active', confirmed: '🚛 In Truck', dispatched: '✅ Complete' };
  const color = statusColors[log.status] || 'var(--muted)';

  return `<div class="route-card" style="border-color:${color}33;">
    <div style="padding:12px 16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-family:'Space Mono',monospace;font-size:11px;color:${color};">${log.load_id}</div>
        <span style="font-size:9px;font-weight:700;padding:3px 9px;border-radius:20px;background:${color}22;color:${color};">${statusLabels[log.status] || log.status}</span>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px;">${log.route || ''}</div>
      <div class="log-card-stats">
        <div class="log-card-stat">
          <div style="font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:var(--accent);">${(log.distanceMiles || 0).toFixed(1)}</div>
          <div style="font-size:8px;color:var(--muted);text-transform:uppercase;">Miles</div>
        </div>
        <div class="log-card-stat">
          <div style="font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:var(--accent2);">${formatDuration(log.transitMinutes || 0)}</div>
          <div style="font-size:8px;color:var(--muted);text-transform:uppercase;">Transit</div>
        </div>
        <div class="log-card-stat">
          <div style="font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:var(--blue);">${(log.events || []).length}</div>
          <div style="font-size:8px;color:var(--muted);text-transform:uppercase;">Events</div>
        </div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:8px;">
        ${(log.events || []).map(e => {
          const icons = { active: '📍', confirm: '🚛', dispatch: '🚦' };
          const time = new Date(e.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:11px;">
            <span>${icons[e.type] || '📌'}</span>
            <span style="color:var(--muted);font-family:'Space Mono',monospace;font-size:10px;">${time}</span>
            <span style="color:var(--text2);">${e.description}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function formatDuration(minutes) {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function exportLogsCSV() {
  const logs = state.tripLogs;
  if (!logs.length) { toast('No logs to export', 'warn'); return; }

  const header = 'Date,Load ID,Route,Status,Miles,Transit (min),Active Time,Confirm Time,Dispatch Time';
  const rows = logs.map(l => {
    const date = l.activeTime ? l.activeTime.slice(0, 10) : '';
    return [
      date, l.load_id, `"${(l.route || '').replace(/"/g, '""')}"`, l.status,
      (l.distanceMiles || 0).toFixed(1), l.transitMinutes || 0,
      l.activeTime || '', l.confirmTime || '', l.dispatchTime || ''
    ].join(',');
  });

  const csv = header + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trip-log-${getWeekRange().replace(/\s/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV downloaded!', 'success');
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
      <img src="${r.imageUrl}" alt="Receipt" class="gas-thumb" data-full="${r.imageUrl}">
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
    // CSV export
    if (e.target.id === 'exportLogsBtn' || e.target.closest('#exportLogsBtn')) {
      exportLogsCSV();
      return;
    }

    // Availability toggle
    if (e.target.id === 'availabilitySelect') return; // handled by change event

    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;
    const origText = btn.innerHTML;

    // Loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>';

    try {
      if (btn.dataset.action === 'activate') {
        await activateRoute(id, currentUser.uid);
        toast('📍 Active! GPS tracking started.', 'success');
      } else if (btn.dataset.action === 'confirm') {
        const r = state.routes.find(x => x.load_id === id);
        if (!r?.active) { toast('Hit Active first!', 'warn'); btn.disabled = false; btn.innerHTML = origText; return; }
        await confirmRoute(id);
        toast('✅ Confirmed in truck!', 'success');
      } else if (btn.dataset.action === 'dispatch') {
        const r = state.routes.find(x => x.load_id === id);
        if (!r?.confirmed) { toast('Confirm in truck first!', 'warn'); btn.disabled = false; btn.innerHTML = origText; return; }
        await dispatchRoute(id);
        toast('🚦 Dispatched! Safe travels!', 'success');
      }
    } catch (err) {
      toast(err.message, 'alert');
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  });

  // Availability change
  document.getElementById('driverRoutesTab').addEventListener('change', async (e) => {
    if (e.target.id === 'availabilitySelect') {
      await updateDriverStatus(currentUser.uid, e.target.value);
      toast(`Status: ${e.target.value.replace('-', ' ')}`, 'info');
    }
  });

  // Gas receipt lightbox
  document.getElementById('driverGasTab').addEventListener('click', (e) => {
    const thumb = e.target.closest('.gas-thumb');
    if (!thumb) return;
    showLightbox(thumb.dataset.full);
  });

  document.querySelectorAll('.dtab').forEach((t, i) => {
    t.addEventListener('click', () => switchDriverTab(['routes','gas'][i]));
  });

  document.getElementById('logoutBtn').addEventListener('click', authLogout);
}

function showLightbox(src) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `<img src="${src}" class="lightbox-img"><div class="lightbox-close">✕</div>`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

function switchDriverTab(tab) {
  document.querySelectorAll('.dtab').forEach((t, i) =>
    t.classList.toggle('active', ['routes','gas'][i] === tab));
  document.getElementById('driverRoutesTab').style.display = tab === 'routes' ? 'block' : 'none';
  document.getElementById('driverGasTab').style.display    = tab === 'gas'    ? 'block' : 'none';
}
