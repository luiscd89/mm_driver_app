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
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
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
