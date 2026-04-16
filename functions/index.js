/**
 * MTN Driver — Cloud Functions backend.
 *
 * - scheduledCheckTrips: every minute, looks for routes whose first stop is
 *   ~10 min out and pushes an FCM notification to the assigned driver.
 * - sendAdminAlert:      callable, admin-only, pushes a manual alert.
 * - setDriverRole:       callable, admin-only, grants the 'admin' custom claim.
 * - onDriverCreated:     auth trigger, bootstraps a /drivers/{uid} document.
 */

const { onSchedule }        = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const functionsV1           = require('firebase-functions/v1');
const admin                 = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function todayISO(tz = 'America/New_York') {
  // Returns YYYY-MM-DD in the given IANA zone.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

async function fcmTokensFor(uid) {
  const snap = await db.collection('drivers').doc(uid).get();
  const data = snap.data() || {};
  return Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
}

async function pushToUid(uid, notification, data = {}) {
  const tokens = await fcmTokensFor(uid);
  if (!tokens.length) return { sent: 0 };
  const resp = await admin.messaging().sendEachForMulticast({
    tokens, notification, data,
    webpush: {
      notification: { icon: '/icon.png', requireInteraction: true },
      fcmOptions:   { link: '/' }
    }
  });
  // Prune dead tokens.
  const dead = [];
  resp.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token') {
        dead.push(tokens[i]);
      }
    }
  });
  if (dead.length) {
    await db.collection('drivers').doc(uid).update({
      fcmTokens: admin.firestore.FieldValue.arrayRemove(...dead)
    });
  }
  return { sent: resp.successCount, failed: resp.failureCount };
}

// ─────────────────────────────────────────────────────────────
// Scheduled trip check — runs every minute.
// ─────────────────────────────────────────────────────────────
exports.scheduledCheckTrips = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'America/New_York' },
  async () => {
    const today = todayISO();
    const snap  = await db.collection('routes')
      .where('date', '==', today)
      .where('notified10min', '==', false)
      .get();

    const now = new Date();
    const jobs = [];

    snap.forEach(doc => {
      const r = doc.data();
      if (!r.stops || !r.stops.length) return;
      if (r.dispatched) return;
      const first = r.stops[0];
      if (!first || !first.time) return;

      const tripDT  = new Date(`${r.date}T${first.time}:00-05:00`); // EST/EDT approximation
      const diffMin = (tripDT - now) / 60000;

      if (diffMin > 9 && diffMin <= 11) {
        jobs.push((async () => {
          await pushToUid(r.driver_uid, {
            title: `⏰ 10-Min Alert — Route ${r.load_id}`,
            body:  `Starts at ${first.time} · ${r.route || ''}`
          }, { loadId: r.load_id, type: '10min' });
          await doc.ref.update({ notified10min: true });
        })());
      }
    });

    await Promise.all(jobs);
    console.log(`scheduledCheckTrips: processed ${jobs.length} alert(s)`);
  }
);

// ─────────────────────────────────────────────────────────────
// Manual alert from admin panel.
// ─────────────────────────────────────────────────────────────
exports.sendAdminAlert = onCall(async (req) => {
  if (!req.auth || req.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  const { driverUid, message } = req.data || {};
  if (!driverUid) throw new HttpsError('invalid-argument', 'driverUid required');
  const result = await pushToUid(driverUid, {
    title: '📢 Manager Alert',
    body:  message || 'Check in with dispatch immediately.'
  }, { type: 'admin' });
  return { ok: true, ...result };
});

// ─────────────────────────────────────────────────────────────
// Grant / revoke admin role.
// ─────────────────────────────────────────────────────────────
exports.setDriverRole = onCall(async (req) => {
  if (!req.auth || req.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  const { uid, role } = req.data || {};
  if (!uid || !['admin', 'driver'].includes(role)) {
    throw new HttpsError('invalid-argument', 'uid and role=admin|driver required');
  }
  await admin.auth().setCustomUserClaims(uid, { role });
  await db.collection('drivers').doc(uid).set({ role }, { merge: true });
  return { ok: true };
});

// ─────────────────────────────────────────────────────────────
// Bootstrap /drivers/{uid} when a new user signs up.
// v1 auth trigger (v2 has no onCreate yet).
// ─────────────────────────────────────────────────────────────
exports.onDriverCreated = functionsV1.auth.user().onCreate(async (user) => {
  await db.collection('drivers').doc(user.uid).set({
    name:      user.displayName || user.email || 'Driver',
    email:     user.email || null,
    role:      'driver',
    fcmTokens: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
});

// ─────────────────────────────────────────────────────────────
// Reset notified10min each day (runs at 3am ET so the next day starts fresh).
// ─────────────────────────────────────────────────────────────
exports.resetDailyFlags = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'America/New_York' },
  async () => {
    const today = todayISO();
    const snap = await db.collection('routes').where('date', '==', today).get();
    const batch = db.batch();
    snap.forEach(doc => batch.update(doc.ref, { notified10min: false }));
    await batch.commit();
  }
);

// ─────────────────────────────────────────────────────────────
// WhatsApp alerts on route status changes.
// ─────────────────────────────────────────────────────────────
async function sendWhatsAppAlert(message) {
  const settingsDoc = await db.collection('settings').doc('whatsapp').get();
  if (!settingsDoc.exists) return;
  const cfg = settingsDoc.data();
  if (!cfg.enabled) return;

  // Support multiple webhook services
  if (cfg.provider === 'callmebot') {
    // CallMeBot: one request per phone number in the group
    const phones = cfg.phones || [];
    for (const phone of phones) {
      try {
        const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone.number)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(phone.apikey)}`;
        await fetch(url);
      } catch (e) { console.warn('CallMeBot failed for', phone.number, e.message); }
    }
  } else if (cfg.provider === 'webhook') {
    // Generic webhook (works with Make.com, Zapier, n8n, etc.)
    try {
      await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, timestamp: new Date().toISOString() })
      });
    } catch (e) { console.warn('Webhook failed:', e.message); }
  } else if (cfg.provider === 'meta') {
    // Meta WhatsApp Business Cloud API
    const { phoneNumberId, accessToken, recipientNumbers } = cfg;
    for (const to of (recipientNumbers || [])) {
      try {
        await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: message }
          })
        });
      } catch (e) { console.warn('Meta WA failed for', to, e.message); }
    }
  }
}

exports.onRouteStatusChange = onDocumentUpdated('routes/{loadId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const loadId = event.params.loadId;
  const driver = after.driver_name || 'Unknown Driver';
  const route = after.route || '';

  // Detect status transitions
  if (!before.active && after.active) {
    await sendWhatsAppAlert(
      `📍 *DRIVER ACTIVE*\n\n👤 ${driver}\n🚛 Load: ${loadId}\n📦 Route: ${route}\n⏰ ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}\n\n_Driver is on the way to the truck_`
    );
  }
  if (!before.confirmed && after.confirmed) {
    await sendWhatsAppAlert(
      `🚛 *IN TRUCK*\n\n👤 ${driver}\n🚛 Load: ${loadId}\n📦 Route: ${route}\n⏰ ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}\n\n_Driver confirmed in truck and ready_`
    );
  }
  if (!before.dispatched && after.dispatched) {
    await sendWhatsAppAlert(
      `🚦 *DISPATCHED*\n\n👤 ${driver}\n🚛 Load: ${loadId}\n📦 Route: ${route}\n⏰ ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}\n\n_Driver dispatched — route in progress_`
    );
  }
});

// ─────────────────────────────────────────────────────────────
// Sync routes from a published Google Sheet (CSV).
// ─────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

function splitCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  result.push(cur);
  return result;
}

function normalizeTime(raw) {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();
  // HH:MM or H:MM 24-hour
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(':');
    return `${h.padStart(2, '0')}:${m}`;
  }
  // 12-hour with AM/PM
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2];
    const period = ampm[3].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  // Excel fractional day (e.g. 0.75 = 18:00)
  const num = parseFloat(s);
  if (!isNaN(num) && num >= 0 && num < 1) {
    const totalMin = Math.round(num * 1440);
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return s; // return as-is if unrecognized
}

function normalizeDate(raw) {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  // Try Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

exports.syncFromSheet = onCall({ timeoutSeconds: 120 }, async (req) => {
  if (!req.auth || req.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }

  const { sheetUrl } = req.data || {};
  if (!sheetUrl) {
    throw new HttpsError('invalid-argument', 'sheetUrl is required.');
  }

  // Fetch CSV
  let csvText;
  try {
    const resp = await fetch(sheetUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    csvText = await resp.text();
  } catch (err) {
    throw new HttpsError('unavailable', `Failed to fetch sheet: ${err.message}`);
  }

  const rows = parseCSV(csvText);
  if (!rows.length) {
    return { total: 0, created: 0, updated: 0, skipped: 0, unmatchedDrivers: [] };
  }

  // Build driver name → uid lookup
  const driversSnap = await db.collection('drivers').get();
  const driverMap = new Map();
  driversSnap.forEach(doc => {
    const d = doc.data();
    if (d.name)  driverMap.set(d.name.trim().toLowerCase(), doc.id);
    if (d.email) driverMap.set(d.email.trim().toLowerCase(), doc.id);
  });

  const stopTimeCols = [
    'Stop 1 Planned Arrival Time', 'Stop 2 Planned Arrival Time',
    'Stop 3 Planned Arrival Time', 'Stop 4 Planned Arrival Time',
    'Stop 5 Planned Arrival Time', 'Stop 6 Planned Arrival Time',
    'Stop 7 Planned Arrival Time', 'Stop 8 Planned Arrival Time'
  ];

  let created = 0, updated = 0, skipped = 0;
  const unmatchedDrivers = new Set();
  const batches = [];
  let batch = db.batch();
  let batchCount = 0;

  // Check which load_ids already exist
  const existingIds = new Set();
  const existingSnap = await db.collection('routes').select().get();
  existingSnap.forEach(doc => existingIds.add(doc.id));

  for (const row of rows) {
    const loadId = (row['Load ID'] || '').trim();
    if (!loadId) { skipped++; continue; }

    const driverName = (row['Driver Name'] || '').trim();
    const driverKey = driverName.toLowerCase();
    const driverUid = driverMap.get(driverKey) || null;
    if (driverName && !driverUid) unmatchedDrivers.add(driverName);

    const facilities = (row['Facility Sequence'] || '').split('->').map(f => f.trim()).filter(Boolean);
    const stops = facilities.map((facility, i) => ({
      facility,
      time: normalizeTime(row[stopTimeCols[i]] || '')
    }));

    const routeDoc = {
      load_id:     loadId,
      driver_uid:  driverUid,
      driver_name: driverName || null,
      date:        normalizeDate(row['Stop 1 Planned Arrival Date']),
      route:       (row['Facility Sequence'] || '').trim(),
      shipper:     (row['Shipper Account'] || '').trim() || null,
      distance:    parseFloat(row['Estimate Distance']) || 0,
      stops,
      meta: {
        block_id:       (row['Block ID'] || '').trim() || null,
        trip_id:        (row['Trip ID'] || '').trim() || null,
        scac:           (row['SCAC'] || '').trim() || null,
        equipment_type: (row['Equipment Type'] || '').trim() || null,
        rate_type:      (row['Rate Type'] || '').trim() || null,
        estimated_cost: (row['Estimated Cost'] || '').trim() || null,
        currency:       (row['Currency'] || '').trim() || null
      }
    };

    const ref = db.collection('routes').doc(loadId);
    if (existingIds.has(loadId)) {
      batch.set(ref, routeDoc, { merge: true });
      updated++;
    } else {
      batch.set(ref, { ...routeDoc, active: false, confirmed: false, dispatched: false, notified10min: false });
      created++;
    }

    batchCount++;
    if (batchCount >= 499) {
      batches.push(batch);
      batch = db.batch();
      batchCount = 0;
    }
  }

  batches.push(batch);
  await Promise.all(batches.map(b => b.commit()));

  return {
    total: rows.length,
    created,
    updated,
    skipped,
    unmatchedDrivers: [...unmatchedDrivers]
  };
});
