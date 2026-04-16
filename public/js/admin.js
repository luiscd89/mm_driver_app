import { state } from "./state.js";
import { functions } from "./firebase-config.js";
import { toast } from "./toast.js";
import { httpsCallable }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

const sendAdminAlert = httpsCallable(functions, 'sendAdminAlert');

let currentTab = 'overview';

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

  if (tab === 'overview') {
    const dispatchedCount = routes.filter(r => r.dispatched).length;
    const confirmedCount  = routes.filter(r => r.confirmed && !r.dispatched).length;
    const gasTotal        = gas.reduce((s, r) => s + parseFloat(r.amount || 0), 0);

    c.innerHTML = `
      <div class="admin-stats">
        <div class="astat"><span class="anum">${drivers.length}</span><div class="albl">Total Drivers</div></div>
        <div class="astat"><span class="anum" style="color:var(--ok)">${dispatchedCount}</span><div class="albl">Dispatched</div></div>
        <div class="astat"><span class="anum" style="color:var(--blue)">${confirmedCount}</span><div class="albl">In Truck</div></div>
        <div class="astat"><span class="anum" style="color:var(--accent2)">$${gasTotal.toFixed(0)}</span><div class="albl">Gas Spent</div></div>
      </div>
      <div style="padding:0 16px 16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:10px;">Driver Quick Status</div>
        ${drivers.map(d => {
          const myRoutes = routesByUid[d.uid] || [];
          const myDispatched = myRoutes.filter(r => r.dispatched).length;
          const myConfirmed  = myRoutes.filter(r => r.confirmed && !r.dispatched).length;
          const badge = myDispatched > 0 ? 'dispatched' : myConfirmed > 0 ? 'active' : 'idle';
          const badgeLabel = myDispatched > 0 ? '🚦 Dispatched' : myConfirmed > 0 ? '🚛 In Truck' : '⚪ Idle';
          return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="font-size:13px;font-weight:600">${d.name || d.email}</div>
              <div style="font-size:10px;color:var(--muted)">${myRoutes.length} routes · ${myDispatched} dispatched</div>
            </div>
            <span class="ds-badge ${badge}">${badgeLabel}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  else if (tab === 'drivers') {
    c.innerHTML = `<div class="driver-status-list">${drivers.map(d => {
      const myRoutes = routesByUid[d.uid] || [];
      const myDispatched = myRoutes.filter(r => r.dispatched).length;
      const myConfirmed  = myRoutes.filter(r => r.confirmed && !r.dispatched).length;
      const activeRoute  = myRoutes.find(r => r.confirmed && !r.dispatched);
      const myGas = gas.filter(g => g.driver_uid === d.uid).length;
      const badge = myDispatched > 0 ? 'dispatched' : myConfirmed > 0 ? 'active' : 'idle';
      const badgeLabel = myDispatched > 0 ? '🚦 On Route' : myConfirmed > 0 ? '🚛 In Truck' : '⚪ Idle';

      return `<div class="ds-card">
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
