import { state, updateRouteNotes } from "./state.js";
import { functions, db } from "./firebase-config.js";
import { toast } from "./toast.js";
import { httpsCallable }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const sendAdminAlert = httpsCallable(functions, 'sendAdminAlert');
const syncFromSheet  = httpsCallable(functions, 'syncFromSheet');

let currentTab = 'overview';
let previousActiveDrivers = new Set();

export function renderAdmin(tab = currentTab) {
  currentTab = tab;
  document.querySelectorAll('.atab').forEach((t, i) =>
    t.classList.toggle('active', ['overview','drivers','gas','logs','settings'][i] === tab));

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
          const avail = d.availability || 'on-duty';
          const availColors = { 'on-duty': 'var(--ok)', 'on-break': 'var(--accent2)', 'off-duty': 'var(--muted)' };
          const availLabel = avail.replace('-', ' ');
          return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;${highlight}">
            <div>
              <div style="font-size:13px;font-weight:600">${d.name || d.email} <span style="font-size:9px;padding:2px 6px;border-radius:10px;background:${availColors[avail]}22;color:${availColors[avail]};">${availLabel}</span></div>
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
          <div style="margin-top:6px;display:flex;gap:6px;">
            <input class="gas-input route-note-input" type="text" data-note-id="${activeRoute.load_id}" placeholder="Add delivery note..." value="${activeRoute.notes || ''}" style="margin:0;padding:6px 8px;font-size:11px;flex:1;">
            <button class="route-note-save" data-note-id="${activeRoute.load_id}" style="padding:6px 10px;border-radius:6px;border:none;background:var(--blue);color:#fff;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap;">Save Note</button>
          </div>
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

  else if (tab === 'logs') {
    const logs = state.tripLogs;
    if (!logs.length) {
      c.innerHTML = '<div class="empty-admin"><div class="icon">📋</div><p>No trip logs recorded yet</p></div>';
      return;
    }

    // Overall stats
    const totalMiles = logs.reduce((s, l) => s + (l.distanceMiles || 0), 0);
    const totalMinutes = logs.reduce((s, l) => s + (l.transitMinutes || 0), 0);
    const completedTrips = logs.filter(l => l.status === 'dispatched').length;

    // Group by driver
    const byDriver = {};
    logs.forEach(l => {
      const key = l.driver_name || l.driver_uid;
      (byDriver[key] ||= []).push(l);
    });

    const fmtDur = (m) => {
      if (!m) return '0m';
      const h = Math.floor(m / 60);
      const min = m % 60;
      return h > 0 ? `${h}h ${min}m` : `${min}m`;
    };

    c.innerHTML = `
      <div style="padding:16px;">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
          <div class="astat"><span class="anum">${logs.length}</span><div class="albl">Total Trips</div></div>
          <div class="astat"><span class="anum" style="color:var(--ok)">${completedTrips}</span><div class="albl">Completed</div></div>
          <div class="astat"><span class="anum" style="color:var(--accent)">${totalMiles.toFixed(1)}</span><div class="albl">Total Miles</div></div>
          <div class="astat"><span class="anum" style="color:var(--accent2)">${fmtDur(totalMinutes)}</span><div class="albl">Total Transit</div></div>
        </div>

        ${Object.entries(byDriver).sort((a, b) => b[1].length - a[1].length).map(([driverName, driverLogs]) => {
          const dMiles = driverLogs.reduce((s, l) => s + (l.distanceMiles || 0), 0);
          const dMinutes = driverLogs.reduce((s, l) => s + (l.transitMinutes || 0), 0);
          const dCompleted = driverLogs.filter(l => l.status === 'dispatched').length;

          return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:12px;overflow:hidden;">
            <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-size:14px;font-weight:700;">${driverName}</div>
                <div style="font-size:10px;color:var(--muted);">${driverLogs.length} trips · ${dMiles.toFixed(1)} mi · ${fmtDur(dMinutes)}</div>
              </div>
              <span style="font-size:11px;font-weight:600;color:var(--ok);">${dCompleted}/${driverLogs.length} done</span>
            </div>
            <div style="max-height:300px;overflow-y:auto;">
              ${driverLogs.map(l => {
                const statusColors = { active: 'var(--accent2)', confirmed: 'var(--blue)', dispatched: 'var(--ok)' };
                const statusLabels = { active: '📍 Active', confirmed: '🚛 In Truck', dispatched: '✅ Complete' };
                const color = statusColors[l.status] || 'var(--muted)';
                const activeDate = l.activeTime ? new Date(l.activeTime) : null;
                const dateStr = activeDate ? activeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                const timeStr = activeDate ? activeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';

                return `<div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
                  <div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span style="font-family:'Space Mono',monospace;font-size:11px;color:${color};">${l.load_id}</span>
                      <span style="font-size:9px;padding:2px 7px;border-radius:20px;background:${color}22;color:${color};font-weight:600;">${statusLabels[l.status] || l.status}</span>
                    </div>
                    <div style="font-size:10px;color:var(--muted);margin-top:2px;">${dateStr} ${timeStr} · ${l.route || ''}</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-family:'Space Mono',monospace;font-size:12px;font-weight:700;color:var(--accent);">${(l.distanceMiles || 0).toFixed(1)} mi</div>
                    <div style="font-size:10px;color:var(--accent2);">${fmtDur(l.transitMinutes || 0)}</div>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  else if (tab === 'settings') {
    // Load WhatsApp settings async
    c.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);">Loading settings...</div>';
    loadWhatsAppSettings(c);
  }
}

async function loadWhatsAppSettings(c) {
  let cfg = { enabled: false, provider: 'callmebot', phones: [], webhookUrl: '', phoneNumberId: '', accessToken: '', recipientNumbers: [] };
  try {
    const snap = await getDoc(doc(db, 'settings', 'whatsapp'));
    if (snap.exists()) cfg = { ...cfg, ...snap.data() };
  } catch {}

  const phonesJson = (cfg.phones || []).map(p => `${p.number}:${p.apikey}`).join('\n');
  const recipientsStr = (cfg.recipientNumbers || []).join(', ');

  c.innerHTML = `
    <div style="padding:16px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:12px;">WhatsApp Alerts</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <label style="font-size:13px;font-weight:600;">Enable WhatsApp Alerts</label>
          <label style="position:relative;display:inline-block;width:44px;height:24px;">
            <input type="checkbox" id="waEnabled" ${cfg.enabled ? 'checked' : ''} style="opacity:0;width:0;height:0;">
            <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:${cfg.enabled ? 'var(--accent)' : 'var(--border)'};border-radius:24px;transition:.3s;"></span>
            <span style="position:absolute;content:'';height:18px;width:18px;left:3px;bottom:3px;background:white;border-radius:50%;transition:.3s;${cfg.enabled ? 'transform:translateX(20px);' : ''}"></span>
          </label>
        </div>

        <label class="login-label">Provider</label>
        <select id="waProvider" class="login-input" style="margin-bottom:12px;padding:10px;">
          <option value="callmebot" ${cfg.provider==='callmebot'?'selected':''}>CallMeBot (Free — individual numbers)</option>
          <option value="webhook" ${cfg.provider==='webhook'?'selected':''}>Webhook (Make.com, Zapier, n8n)</option>
          <option value="meta" ${cfg.provider==='meta'?'selected':''}>Meta WhatsApp Business API</option>
        </select>

        <div id="waCallmebotFields" style="display:${cfg.provider==='callmebot'?'block':'none'};">
          <label class="login-label">Phone Numbers (one per line: number:apikey)</label>
          <textarea id="waPhones" class="login-input" rows="4" style="resize:vertical;font-size:11px;" placeholder="15551234567:123456\n15559876543:654321">${phonesJson}</textarea>
          <div style="font-size:10px;color:var(--muted);margin-bottom:12px;">Get your API key: send "I allow callmebot to send me messages" to +34 644 71 98 35 on WhatsApp</div>
        </div>

        <div id="waWebhookFields" style="display:${cfg.provider==='webhook'?'block':'none'};">
          <label class="login-label">Webhook URL</label>
          <input id="waWebhookUrl" class="login-input" type="text" placeholder="https://hook.us1.make.com/..." value="${cfg.webhookUrl || ''}">
        </div>

        <div id="waMetaFields" style="display:${cfg.provider==='meta'?'block':'none'};">
          <label class="login-label">Phone Number ID</label>
          <input id="waPhoneNumberId" class="login-input" type="text" placeholder="From Meta Business Dashboard" value="${cfg.phoneNumberId || ''}">
          <label class="login-label">Access Token</label>
          <input id="waAccessToken" class="login-input" type="password" placeholder="Meta API token" value="${cfg.accessToken || ''}">
          <label class="login-label">Recipient Numbers (comma-separated with country code)</label>
          <input id="waRecipients" class="login-input" type="text" placeholder="15551234567, 15559876543" value="${recipientsStr}">
        </div>

        <button id="waSaveBtn" style="width:100%;padding:12px;border-radius:10px;border:none;background:var(--accent);color:#000;font-size:14px;font-weight:600;cursor:pointer;margin-top:8px;">Save WhatsApp Settings</button>
        <button id="waTestBtn" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:12px;font-weight:600;cursor:pointer;margin-top:8px;">Send Test Message</button>
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:8px;">How It Works</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.6;">
          When a driver hits <b>Active</b>, <b>Confirm</b>, or <b>Dispatch</b>, a WhatsApp message is automatically sent with the driver name, load ID, route, and timestamp.<br><br>
          <b>CallMeBot</b> — Free, each admin adds their number. <a href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" style="color:var(--accent);">Setup guide</a><br>
          <b>Webhook</b> — Use Make.com or Zapier to forward to WhatsApp group.<br>
          <b>Meta API</b> — Official WhatsApp Business API for high volume.
        </div>
      </div>
    </div>`;
}

export function wireAdminEvents() {
  document.querySelectorAll('.atab').forEach((t, i) => {
    t.addEventListener('click', () => renderAdmin(['overview','drivers','gas','logs','settings'][i]));
  });

  document.getElementById('adminContent').addEventListener('change', (e) => {
    // WhatsApp provider toggle
    if (e.target.id === 'waProvider') {
      const v = e.target.value;
      const cb = document.getElementById('waCallmebotFields');
      const wh = document.getElementById('waWebhookFields');
      const mt = document.getElementById('waMetaFields');
      if (cb) cb.style.display = v === 'callmebot' ? 'block' : 'none';
      if (wh) wh.style.display = v === 'webhook' ? 'block' : 'none';
      if (mt) mt.style.display = v === 'meta' ? 'block' : 'none';
    }
  });

  document.getElementById('adminContent').addEventListener('click', async (e) => {
    // WhatsApp save
    if (e.target.id === 'waSaveBtn') {
      const provider = document.getElementById('waProvider')?.value || 'callmebot';
      const enabled = document.getElementById('waEnabled')?.checked || false;
      const cfg = { enabled, provider };

      if (provider === 'callmebot') {
        const raw = (document.getElementById('waPhones')?.value || '').trim();
        cfg.phones = raw.split('\n').filter(Boolean).map(line => {
          const [number, apikey] = line.split(':');
          return { number: (number || '').trim(), apikey: (apikey || '').trim() };
        });
      } else if (provider === 'webhook') {
        cfg.webhookUrl = (document.getElementById('waWebhookUrl')?.value || '').trim();
      } else if (provider === 'meta') {
        cfg.phoneNumberId = (document.getElementById('waPhoneNumberId')?.value || '').trim();
        cfg.accessToken = (document.getElementById('waAccessToken')?.value || '').trim();
        cfg.recipientNumbers = (document.getElementById('waRecipients')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      }

      try {
        await setDoc(doc(db, 'settings', 'whatsapp'), cfg);
        toast('WhatsApp settings saved!', 'success');
      } catch (err) {
        toast('Failed to save: ' + err.message, 'alert');
      }
      return;
    }

    // WhatsApp test
    if (e.target.id === 'waTestBtn') {
      e.target.disabled = true;
      e.target.textContent = 'Sending...';
      try {
        // Trigger test by saving a temp flag
        await setDoc(doc(db, 'settings', 'whatsapp'), { lastTest: new Date().toISOString() }, { merge: true });
        toast('Settings saved. Test a real alert by having a driver hit Active.', 'info');
      } catch (err) {
        toast('Failed: ' + err.message, 'alert');
      }
      e.target.disabled = false;
      e.target.textContent = 'Send Test Message';
      return;
    }

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

    // Save delivery note
    const noteBtn = e.target.closest('.route-note-save');
    if (noteBtn) {
      const loadId = noteBtn.dataset.noteId;
      const input = document.querySelector(`.route-note-input[data-note-id="${loadId}"]`);
      if (input) {
        try {
          await updateRouteNotes(loadId, input.value.trim());
          toast('Note saved!', 'success');
        } catch (err) {
          toast('Failed to save note: ' + err.message, 'alert');
        }
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
