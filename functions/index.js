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
const { GoogleGenAI }       = require('@google/genai');

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
  } else if (cfg.provider === 'twilio') {
    // Twilio WhatsApp API (supports groups via individual messages)
    const { accountSid, authToken, fromNumber, toNumbers } = cfg;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    for (const to of (toNumbers || [])) {
      try {
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `From=whatsapp%3A%2B${fromNumber}&To=whatsapp%3A%2B${to}&Body=${encodeURIComponent(message)}`
        });
      } catch (e) { console.warn('Twilio failed for', to, e.message); }
    }
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
// Analyze dashboard photo with Google Gen AI SDK (Gemini).
// Uses Gemini API key stored in Firestore settings/gemini.apiKey
// Get a free key at https://aistudio.google.com/apikeys
// ─────────────────────────────────────────────────────────────
let genAI = null;

async function getGenAI() {
  if (genAI) return genAI;
  // Try API key from Firestore settings first
  const settingsDoc = await db.collection('settings').doc('gemini').get();
  const apiKey = settingsDoc.exists && settingsDoc.data().apiKey;
  if (apiKey) {
    genAI = new GoogleGenAI({ apiKey });
    console.log('Gemini initialized with API key from settings');
  } else {
    // Fallback to Vertex AI (requires aiplatform API enabled)
    genAI = new GoogleGenAI({ vertexai: true, project: 'trucking-ai-cf0d4', location: 'us-central1' });
    console.log('Gemini initialized with Vertex AI');
  }
  return genAI;
}

exports.analyzeDashboard = onCall({ timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { imageBase64 } = req.data || {};
  if (!imageBase64) throw new HttpsError('invalid-argument', 'imageBase64 required.');

  console.log('analyzeDashboard called, image size:', Math.round(imageBase64.length / 1024), 'KB base64');

  try {
    const ai = await getGenAI();
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: `You are analyzing a commercial truck dashboard instrument cluster photo. These are rental trucks from Ryder or Penske.

Extract ALL visible readings. Return a JSON object:

1. ODOMETER: The mileage display (6+ digits). Look for "ODO" label or the largest number on the digital display.
2. FUEL LEVEL: Digital percentage OR estimate from gauge needle (E=0%, 1/4=25%, 1/2=50%, 3/4=75%, F=100%).
3. DEF LEVEL: Diesel Exhaust Fluid percentage or gauge reading if visible.
4. TRUCK NUMBER: The unit number — often visible on a sticker on the dashboard, windshield, or as a number displayed on screen. Ryder trucks typically show a 4-6 digit number. Penske trucks may show it differently.

Be precise with the odometer — read every digit carefully.
For fuel level, even a rough estimate from the gauge position is useful.

Return ONLY this JSON — no markdown, no backticks, no extra text:
{"odometer": <number or null>, "fuelLevel": <0-100 or null>, "defLevel": <0-100 or null>, "truckNumber": "<string or null>", "fuelGauge": "<e.g. quarter tank, half, near empty>", "notes": "<warnings, engine hours, or anything useful>"}` }
        ]
      }]
    });

    const text = (result.text || '').trim();
    console.log('Gemini raw response:', text.slice(0, 500));

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('Parsed dashboard data:', JSON.stringify(parsed));
        return { success: true, data: parsed };
      } catch (parseErr) {
        console.error('JSON parse failed:', parseErr.message, 'from:', jsonMatch[0]);
        return { success: false, error: 'Could not parse AI response', raw: text };
      }
    }
    console.warn('No JSON found in Gemini response:', text);
    return { success: false, error: 'No readings detected', raw: text };
  } catch (err) {
    console.error('Gemini analysis failed:', err.message, err.stack);
    return { success: false, error: err.message };
  }
});

// ─────────────────────────────────────────────────────────────
// Get current diesel price (national average from EIA or settings).
// ─────────────────────────────────────────────────────────────
async function getDieselPrice() {
  // Check if admin set a manual price
  const settingsDoc = await db.collection('settings').doc('fuel').get();
  if (settingsDoc.exists && settingsDoc.data().dieselPrice) {
    return settingsDoc.data().dieselPrice;
  }
  // Try EIA API for national average
  try {
    const resp = await fetch('https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=DEMO_KEY&frequency=weekly&data[0]=value&facets[product][]=EPD2D&facets[duession][]=NUS&sort[0][column]=period&sort[0][direction]=desc&length=1');
    const json = await resp.json();
    if (json?.response?.data?.[0]?.value) {
      return parseFloat(json.response.data[0].value);
    }
  } catch {}
  return 3.85; // Fallback national average
}

// ─────────────────────────────────────────────────────────────
// Submit fuel request — calculates cost estimate, alerts admins.
// ─────────────────────────────────────────────────────────────
exports.submitFuelRequest = onCall({ timeoutSeconds: 30 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { loadId, truckNumber, rentalCompany, odometer, fuelLevel, defLevel, dashImageUrl, dashStoragePath,
          type, receiptImageUrl, receiptStoragePath, receiptAmount, notes } = req.data || {};

  const uid = req.auth.uid;
  const driverDoc = await db.collection('drivers').doc(uid).get();
  const driverName = driverDoc.exists ? (driverDoc.data().name || req.auth.token.email) : 'Unknown';

  const dieselPrice = await getDieselPrice();
  const tankCapacity = 150; // Default truck tank gallons (can be configured)

  // Calculate estimated fuel needed and cost
  let estimatedGallons = 0;
  let estimatedCost = 0;
  if (type === 'request' && fuelLevel !== null && fuelLevel !== undefined) {
    estimatedGallons = Math.round(tankCapacity * (1 - fuelLevel / 100));
    estimatedCost = Math.round(estimatedGallons * dieselPrice * 100) / 100;
  }

  const fuelReq = {
    driver_uid: uid,
    driver_name: driverName,
    load_id: loadId || null,
    truckNumber: truckNumber || null,
    rentalCompany: rentalCompany || null,
    type, // 'request' or 'self-fill'
    status: type === 'self-fill' ? 'completed' : 'pending',
    odometer: odometer || null,
    fuelLevel: fuelLevel ?? null,
    defLevel: defLevel ?? null,
    dashImageUrl: dashImageUrl || null,
    dashStoragePath: dashStoragePath || null,
    receiptImageUrl: receiptImageUrl || null,
    receiptStoragePath: receiptStoragePath || null,
    receiptAmount: receiptAmount || null,
    dieselPrice,
    estimatedGallons,
    estimatedCost,
    notes: notes || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedAt: type === 'self-fill' ? admin.firestore.FieldValue.serverTimestamp() : null,
    resolvedBy: null
  };

  const docRef = await db.collection('fuelRequests').add(fuelReq);

  // Send alerts
  if (type === 'request') {
    // Push to all admins via FCM
    const adminsSnap = await db.collection('drivers').where('role', '==', 'admin').get();
    const jobs = [];
    adminsSnap.forEach(doc => {
      const tokens = doc.data().fcmTokens || [];
      if (tokens.length) {
        jobs.push(admin.messaging().sendEachForMulticast({
          tokens,
          notification: {
            title: `⛽ Fuel Request — ${driverName}`,
            body: `Load: ${loadId || 'N/A'} · Fuel: ${fuelLevel}% · Est: $${estimatedCost}`
          }
        }).catch(() => {}));
      }
    });
    await Promise.all(jobs);

    // WhatsApp alert
    const truckInfo = truckNumber ? `🚛 Truck #${truckNumber}${rentalCompany ? ' (' + rentalCompany + ')' : ''}` : '🚛 Load: ' + (loadId || 'N/A');
    await sendWhatsAppAlert(
      `⛽ *FUEL REQUEST*\n\n👤 ${driverName}\n${truckInfo}\n📦 Load: ${loadId || 'N/A'}\n⛽ Fuel Level: ${fuelLevel}%\n💧 DEF Level: ${defLevel != null ? defLevel + '%' : 'N/A'}\n📏 Odometer: ${odometer || 'N/A'} mi\n\n💰 Est. ${estimatedGallons} gal × $${dieselPrice}/gal\n💵 *Estimated: $${estimatedCost}*\n\n⏰ ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}`
    );
  } else {
    // Self-fill WhatsApp notification
    await sendWhatsAppAlert(
      `🧾 *FUEL RECEIPT*\n\n👤 ${driverName}\n🚛 Load: ${loadId || 'N/A'}\n💵 Amount: $${receiptAmount || 0}\n📏 Odometer: ${odometer || 'N/A'} mi\n\n⏰ ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}`
    );
  }

  return { ok: true, id: docRef.id, estimatedGallons, estimatedCost, dieselPrice };
});

// ─────────────────────────────────────────────────────────────
// Resolve fuel request (admin approve/deny).
// ─────────────────────────────────────────────────────────────
exports.resolveFuelRequest = onCall(async (req) => {
  if (!req.auth || req.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  const { requestId, action, amount, notes } = req.data || {};
  if (!requestId || !['approved', 'denied'].includes(action)) {
    throw new HttpsError('invalid-argument', 'requestId and action=approved|denied required.');
  }

  // Fetch request data first so we can default the amount
  const reqDoc = await db.collection('fuelRequests').doc(requestId).get();
  if (!reqDoc.exists) throw new HttpsError('not-found', 'Fuel request not found.');
  const reqData = reqDoc.data();

  const approvedAmount = action === 'approved'
    ? (amount || reqData.estimatedCost || null)
    : null;

  const update = {
    status: action,
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedBy: req.auth.uid,
    approvedAmount,
    adminNotes: notes || null
  };
  await db.collection('fuelRequests').doc(requestId).update(update);
  if (reqData.driver_uid) {
    await pushToUid(reqData.driver_uid, {
      title: action === 'approved' ? '✅ Fuel Request Approved' : '❌ Fuel Request Denied',
      body: action === 'approved'
        ? `$${approvedAmount} approved for load ${reqData.load_id || 'N/A'}`
        : `Request for load ${reqData.load_id || 'N/A'} was denied. ${notes || ''}`
    });
  }

  return { ok: true };
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
