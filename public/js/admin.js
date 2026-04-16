import { state } from "./state.js";
import { functions, db } from "./firebase-config.js";
import { toast } from "./toast.js";
import { httpsCallable }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

const sendAdminAlert = httpsCallable(functions, 'sendAdminAlert');
const syncFromSheet  = httpsCallable(functions, 'syncFromSheet');

let currentTab = 'overview';
let previousActiveDrivers = new Set();

export function renderAdmin(tab = currentTab) {
  currentTab = tab;
  document.querySelectorAll('.atab').forEach((t, i) =>
    t.classList.toggle('active', ['overview','drivers','gas'][i] === tab));

  const c = document.getElementById('adminContent');
  document.getElementById('gasCount').textContent = state.gasReceipts.length;

  const drivers = state.allDrivers;
  const routes  = state.allRoutes;
  const gas     = state.gasReceipts;

  const routesByUid = {};
  routes.forEach(r => { (routesByUid[r.driver_uid] ||= []).push(r); });

  // Detect newly active drivers and alert admin
  const currentActiveDrivers = new Set();
  routes.forEach(r => { if (r.active && !r.dispatched) currentActiveDrivers.add(r.driver_uid); });
  currentActiveDrivers.forEach(uid => {
    if (!previousActiveDrivers.has(uid)) {
      const d = drivers.find(x => x.uid === uid);
      if (d) toast(`📍 ${d.name || d.email} is now ACTIVE and on the way!`, 'alert');
    }
  });
  previousActiveDrivers = currentActiveDrivers;

  // Sort drivers: active first, then confirmed, then dispatched, then idle
  function driverSortKey(d) {
    const myRoutes = routesByUid[d.uid] || [];
    const hasActive = myRoutes.some(r => r.active && !r.confirmed && !r.dispatched);
    const hasConfirmed = myRoutes.some(r => r.confirmed && !r.dispatched);
    const hasDispatched = myRoutes.some(r => r.dispatched);
    if (hasActive) return 0;
    if (hasConfirmed) return 1;
    if (hasDispatched) return 2;
    return 3;
  }
  const sortedDrivers = [...drivers].sort((a, b) => driverSortKey(a) - driverSortKey(b));

  if (tab === 'overview') {
    const dispatchedCount = routes.filter(r => r.dispatched).length;
    const confirmedCount  = routes.filter(r => r.confirmed && !r.dispatched).length;
    const activeCount     = routes.filter(r => r.active && !r.confirmed && !r.dispatched).length;
    const gasTotal        = gas.reduce((s, r) => s + parseFloat(r.amount || 0), 0);

    c.innerHTML = `
      <div style="padding:16px;border-bottom:1px solid var(--border);">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:10px;">Google Sheet Sync</div>
        <input type="text" id="sheetUrlInput" class="gas-input" placeholder="Paste published Google Sheet CSV URL or sharing link" style="margin-bottom:10px;font-size:12px;">
        <button id="syncSheetBtn" style="width:100%;padding:12px;border-radius:10px;border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">🔄 Sync Routes from Sheet</button>
        <div id="syncStatus" style="display:none;margin-top:10px;padding:12px;border-radius:8px;font-size:12px;"></div>
      </div>
      <div class="admin-stats">
        <div class="astat"><span class="anum">${drivers.length}</span><div class="albl">Total Drivers</div></div>
        <div class="astat"><span class="anum" style="color:var(--accent2)">${activeCount}</span><div class="albl">Active</div></div>
        <div class="astat"><span class="anum" style="color:var(--blue)">${confirmedCount}</span><div class="albl">In Truck</div></div>
        <div class="astat"><span class="anum" style="color:var(--ok)">${dispatchedCount}</span><div class="albl">Dispatched</div></div>
      </div>
      <div style="padding:0 16px 16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:10px;">Driver Quick Status</div>
        ${sortedDrivers.map(d => {
          const myRoutes = routesByUid[d.uid] || [];
          const myDispatched = myRoutes.filter(r => r.dispatched).length;
          const myConfirmed  = myRoutes.filter(r => r.confirmed && !r.dispatched).length;
          const myActive     = myRoutes.filter(r => r.active && !r.confirmed && !r.dispatched).length;
          const badge = myActive > 0 ? 'on-way' : myDispatched > 0 ? 'dispatched' : myConfirmed > 0 ? 'active' : 'idle';
          const badgeLabel = myActive > 0 ? '📍 On The Way' : myDispatched > 0 ? '🚦 Dispatched' : myConfirmed > 0 ? '🚛 In Truck' : '⚪ Idle';
          const loc = d.location;
          const locHtml = loc ? `<a href="https://www.google.com/maps?q=${loc.lat},${loc.lng}" target="_blank" style="font-size:10px;color:var(--accent);text-decoration:none;">📍 View on Map</a>` : '';
          const locTime = loc?.updatedAt ? `<span style="font-size:9px;color:var(--muted);margin-left:6px;">${new Date(loc.updatedAt).toLocaleTimeString()}</span>` : '';
          const highlight = myActive > 0 ? 'border-color:var(--accent2);background:rgba(245,158,11,.05);' : '';
          return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;${highlight}">
            <div>
              <div style="font-size:13px;font-weight:600">${d.name || d.email}</div>
              <div style="font-size:10px;color:var(--muted)">${myRoutes.length} routes · ${myDispatched} dispatched</div>
              ${locHtml ? `<div style="margin-top:4px;">${locHtml}${locTime}</div>` : ''}
            </div>
            <span class="ds-badge ${badge}">${badgeLabel}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  else if (tab === 'drivers') {
    c.innerHTML = `<div class="driver-status-list">${sortedDrivers.map(d => {
      const myRoutes = routesByUid[d.uid] || [];
      const myDispatched = myRoutes.filter(r => r.dispatched).length;
      const myConfirmed  = myRoutes.filter(r => r.confirmed && !r.dispatched).length;
      const myActive     = myRoutes.filter(r => r.active && !r.confirmed && !r.dispatched).length;
      const activeRoute  = myRoutes.find(r => (r.active || r.confirmed) && !r.dispatched);
      const myGas = gas.filter(g => g.driver_uid === d.uid).length;
      const badge = myActive > 0 ? 'on-way' : myDispatched > 0 ? 'dispatched' : myConfirmed > 0 ? 'active' : 'idle';
      const badgeLabel = myActive > 0 ? '📍 On The Way' : myDispatched > 0 ? '🚦 On Route' : myConfirmed > 0 ? '🚛 In Truck' : '⚪ Idle';
      const loc = d.location;
      const locHtml = loc ? `<div style="margin-top:8px;background:rgba(0,212,170,.05);border:1px solid rgba(0,212,170,.2);border-radius:8px;padding:8px 10px;font-size:11px;">
        <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Live Location</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <a href="https://www.google.com/maps?q=${loc.lat},${loc.lng}" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:600;">📍 Open in Google Maps</a>
          <span style="font-size:9px;color:var(--muted);">${loc.updatedAt ? new Date(loc.updatedAt).toLocaleTimeString() : ''}</span>
        </div>
      </div>` : '';

      return `<div class="ds-card" ${myActive > 0 ? 'style="border-color:var(--accent2);box-shadow:0 0 12px rgba(245,158,11,.15);"' : ''}>
        <div class="ds-header">
          <div class="ds-name">${d.name || d.email}</div>
          <span class="ds-badge ${badge}">${badgeLabel}</span>
        </div>
        <div class="ds-grid">
          <div class="ds-cell"><label>Total Routes</label><value>${myRoutes.length}</value></div>
          <div class="ds-cell"><label>Dispatched</label><value class="${myDispatched>0?'ok':''}">${myDispatched}</value></div>
          <div class="ds-cell"><label>In Truck</label><value class="${myConfirmed>0?'warn':''}">${myConfirmed}</value></div>
          <div class="ds-cell"><label>Gas Receipts</label><value>${myGas}</value></div>
        </div>
        ${activeRoute ? `<div style="margin-top:10px;background:var(--surface2);border-radius:8px;padding:8px 10px;font-size:11px;">
          <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Current Load</div>
          <div style="font-family:'Space Mono',monospace;color:var(--accent)">${activeRoute.load_id}</div>
          <div style="color:var(--text2)">${activeRoute.route}</div>
        </div>` : ''}
        ${locHtml}
        <button class="ds-alert-btn" data-alert-uid="${d.uid}" data-alert-name="${d.name || d.email}">🔔 Send Alert to ${(d.name || d.email).split(' ')[0]}</button>
      </div>`;
    }).join('')}</div>`;
  }

  else if (tab === 'gas') {
    if (!gas.length) {
      c.innerHTML = '<div class="empty-admin"><div class="icon">⛽</div><p>No gas receipts submitted yet</p></div>';
      return;
    }
    const total = gas.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    c.innerHTML = `
      <div style="padding:14px 16px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:12px;color:var(--muted)">${gas.length} receipts total</div>
        <div style="font-size:16px;font-weight:700;color:var(--accent2)">Total: $${total.toFixed(2)}</div>
      </div>
      <div class="gas-admin-list">
        ${gas.map(r => `
          <div class="gas-admin-entry">
            <div class="gae-header">
              <div class="gae-driver">${r.driver_name || ''}</div>
              <div class="gae-amount">$${r.amount}</div>
            </div>
            <img class="gae-img" src="${r.imageUrl}" alt="Receipt">
            <div class="gae-meta">
              <span>Load: <span>${r.load_id}</span></span>
              <span>${r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : ''}</span>
            </div>
            ${r.notes ? `<div style="font-size:10px;color:var(--text2);margin-top:4px">${r.notes}</div>` : ''}
          </div>`).join('')}
      </div>`;
  }
}

export function wireAdminEvents() {
  document.querySelectorAll('.atab').forEach((t, i) => {
    t.addEventListener('click', () => renderAdmin(['overview','drivers','gas'][i]));
  });

  document.getElementById('adminContent').addEventListener('click', async (e) => {
    // Sync button
    if (e.target.id === 'syncSheetBtn') {
      const urlInput = document.getElementById('sheetUrlInput');
      const status   = document.getElementById('syncStatus');
      const rawUrl   = (urlInput?.value || '').trim();
      if (!rawUrl) { toast('Paste a Google Sheet URL first', 'warn'); return; }

      // Convert sharing/edit links to published CSV export URL
      let sheetUrl = rawUrl;
      const idMatch = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (idMatch && !rawUrl.includes('/pub?')) {
        sheetUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/gviz/tq?tqx=out:csv&sheet=MTN`;
      }

      e.target.disabled = true;
      e.target.textContent = '⏳ Syncing...';
      status.style.display = 'block';
      status.style.background = 'var(--surface2)';
      status.style.color = 'var(--text2)';
      status.textContent = 'Fetching and syncing routes, please wait...';

      try {
        const res = await syncFromSheet({ sheetUrl });
        const d = res.data;
        status.style.background = 'rgba(16,185,129,0.1)';
        status.style.color = 'var(--ok)';
        let msg = `Synced ${d.total} routes: ${d.created} created, ${d.updated} updated, ${d.skipped} skipped.`;
        if (d.unmatchedDrivers?.length) {
          msg += ` Unmatched drivers: ${d.unmatchedDrivers.join(', ')}`;
        }
        status.textContent = msg;
        toast('Routes synced!', 'success');
      } catch (err) {
        status.style.background = 'rgba(239,68,68,0.1)';
        status.style.color = 'var(--danger)';
        status.textContent = 'Sync failed: ' + (err.message || err);
        toast('Sync failed', 'alert');
      } finally {
        e.target.disabled = false;
        e.target.textContent = '🔄 Sync Routes from Sheet';
      }
      return;
    }

    // Alert button
    const btn = e.target.closest('[data-alert-uid]');
    if (!btn) return;
    try {
      await sendAdminAlert({ driverUid: btn.dataset.alertUid });
      toast(`Alert sent to ${btn.dataset.alertName.split(' ')[0]}`, 'success');
    } catch (err) {
      toast('Alert failed: ' + err.message, 'alert');
    }
  });
}
