/**
 * Firestore live state — replaces the old localStorage-backed `LS` module.
 * Subscribers get pushed fresh data whenever Firestore changes.
 */
import { db } from "./firebase-config.js";
import {
  collection, query, where, onSnapshot, orderBy, doc, updateDoc, getDocs,
  addDoc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

export const state = {
  routes: [],          // routes for the current driver (or all, if admin)
  allDrivers: [],      // admin only
  allRoutes: [],       // admin only
  gasReceipts: [],     // current driver's receipts (or all, if admin)
  tripLogs: [],        // trip logs (driver: own, admin: all)
  fuelRequests: [],    // fuel requests (driver: own, admin: all)
  unsub: []
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => fn(state)); }

export function clearSubscriptions() {
  state.unsub.forEach(u => { try { u(); } catch {} });
  state.unsub = [];
  state.routes = []; state.allDrivers = []; state.allRoutes = [];
  state.gasReceipts = []; state.tripLogs = []; state.fuelRequests = [];
  emit();
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

// ─── Driver-scoped listeners ───────────────────────────────────────
export function listenAsDriver(uid) {
  clearSubscriptions();

  const qRoutes = query(
    collection(db, 'routes'),
    where('driver_uid', '==', uid),
    orderBy('date', 'asc')
  );
  state.unsub.push(onSnapshot(qRoutes, snap => {
    state.routes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit();
  }));

  const qGas = query(
    collection(db, 'gasReceipts'),
    where('driver_uid', '==', uid),
    orderBy('createdAt', 'desc')
  );
  state.unsub.push(onSnapshot(qGas, snap => {
    state.gasReceipts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit();
  }));

  // Trip logs for current week (Sun-Sat)
  const weekStart = getWeekStart(new Date());
  const qLogs = query(
    collection(db, 'tripLogs'),
    where('driver_uid', '==', uid),
    where('weekStart', '==', weekStart)
  );
  state.unsub.push(onSnapshot(qLogs, snap => {
    state.tripLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit();
  }));

  // Fuel requests
  const qFuel = query(
    collection(db, 'fuelRequests'),
    where('driver_uid', '==', uid),
    orderBy('createdAt', 'desc')
  );
  state.unsub.push(onSnapshot(qFuel, snap => {
    state.fuelRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit();
  }));
}

// ─── Admin-scoped listeners ────────────────────────────────────────
export function listenAsAdmin() {
  clearSubscriptions();

  state.unsub.push(onSnapshot(collection(db, 'drivers'), snap => {
    state.allDrivers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    emit();
  }));

  state.unsub.push(onSnapshot(collection(db, 'routes'), snap => {
    state.allRoutes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    emit();
  }));

  state.unsub.push(onSnapshot(
    query(collection(db, 'gasReceipts'), orderBy('createdAt', 'desc')),
    snap => {
      state.gasReceipts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit();
    }
  ));

  // All trip logs
  state.unsub.push(onSnapshot(
    query(collection(db, 'tripLogs'), orderBy('activeTime', 'desc')),
    snap => {
      state.tripLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit();
    }
  ));

  // All fuel requests
  state.unsub.push(onSnapshot(
    query(collection(db, 'fuelRequests'), orderBy('createdAt', 'desc')),
    snap => {
      state.fuelRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit();
    }
  ));
}

// ─── Mutations ─────────────────────────────────────────────────────
export async function updateDriverStatus(uid, availability) {
  await updateDoc(doc(db, 'drivers', uid), { availability });
}

export async function updateRouteNotes(loadId, notes) {
  await updateDoc(doc(db, 'routes', loadId), { notes });
}

export async function activateRoute(loadId, uid) {
  const now = new Date().toISOString();
  await updateDoc(doc(db, 'routes', loadId), {
    active: true, activeTime: now
  });

  // Find driver name and route info
  const route = state.routes.find(r => r.load_id === loadId);
  const driverName = route?.driver_name || '';

  // Create trip log
  const logRef = await addDoc(collection(db, 'tripLogs'), {
    driver_uid: uid,
    driver_name: driverName,
    load_id: loadId,
    route: route?.route || '',
    activeTime: now,
    confirmTime: null,
    dispatchTime: null,
    distanceMiles: 0,
    transitMinutes: 0,
    status: 'active',
    weekStart: getWeekStart(new Date()),
    gpsTrail: [],
    events: [{ type: 'active', time: now, description: 'Driver activated — on the way to truck' }]
  });

  // Store log ID on the route for reference
  await updateDoc(doc(db, 'routes', loadId), { tripLogId: logRef.id });

  startTracking(uid, logRef.id);
}

export async function confirmRoute(loadId) {
  const now = new Date().toISOString();
  await updateDoc(doc(db, 'routes', loadId), {
    confirmed: true, confirmTime: now
  });

  // Update trip log
  const route = state.routes.find(r => r.load_id === loadId);
  if (route?.tripLogId) {
    const logRef = doc(db, 'tripLogs', route.tripLogId);
    const logSnap = await getDoc(logRef);
    if (logSnap.exists()) {
      const data = logSnap.data();
      const events = data.events || [];
      events.push({ type: 'confirm', time: now, description: 'Driver confirmed — in truck' });
      const transitMin = data.activeTime
        ? Math.round((new Date(now) - new Date(data.activeTime)) / 60000)
        : 0;
      await updateDoc(logRef, {
        confirmTime: now,
        status: 'confirmed',
        transitMinutes: transitMin,
        events
      });
    }
  }
}

export async function dispatchRoute(loadId) {
  const now = new Date().toISOString();
  await updateDoc(doc(db, 'routes', loadId), {
    dispatched: true, dispatchTime: now
  });

  // Finalize trip log
  const route = state.routes.find(r => r.load_id === loadId);
  if (route?.tripLogId) {
    const logRef = doc(db, 'tripLogs', route.tripLogId);
    const logSnap = await getDoc(logRef);
    if (logSnap.exists()) {
      const data = logSnap.data();
      const events = data.events || [];
      events.push({ type: 'dispatch', time: now, description: 'Driver dispatched — route started' });
      const totalMin = data.activeTime
        ? Math.round((new Date(now) - new Date(data.activeTime)) / 60000)
        : 0;
      await updateDoc(logRef, {
        dispatchTime: now,
        status: 'dispatched',
        transitMinutes: totalMin,
        events
      });
    }
  }

  stopTracking();
}

// ─── GPS Tracking with Distance Logging ─────────────────────────
let trackingWatchId = null;
let trackingLogId = null;
let lastPosition = null;
let accumulatedDistance = 0;

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startTracking(uid, logId) {
  if (trackingWatchId !== null) return;
  if (!('geolocation' in navigator)) return;

  trackingLogId = logId;
  lastPosition = null;
  accumulatedDistance = 0;

  trackingWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const now = new Date().toISOString();

      // Calculate distance from last point
      if (lastPosition) {
        const d = haversineDistance(lastPosition.lat, lastPosition.lng, lat, lng);
        if (d > 0.01) { // Ignore tiny movements (GPS jitter)
          accumulatedDistance += d;
        }
      }
      lastPosition = { lat, lng };

      try {
        // Update driver's live location
        await updateDoc(doc(db, 'drivers', uid), {
          location: { lat, lng, accuracy: pos.coords.accuracy, updatedAt: now }
        });

        // Update trip log with GPS trail and distance
        if (trackingLogId) {
          const logRef = doc(db, 'tripLogs', trackingLogId);
          const logSnap = await getDoc(logRef);
          if (logSnap.exists()) {
            const data = logSnap.data();
            const trail = data.gpsTrail || [];
            // Sample trail every ~30s (limit trail size)
            if (!trail.length || (new Date(now) - new Date(trail[trail.length - 1].time)) > 30000) {
              trail.push({ lat, lng, time: now });
            }
            await updateDoc(logRef, {
              gpsTrail: trail,
              distanceMiles: Math.round(accumulatedDistance * 100) / 100
            });
          }
        }
      } catch (e) {
        console.warn('Tracking update failed:', e.message);
      }
    },
    (err) => console.warn('GPS error:', err.message),
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
  );
}

export function stopTracking() {
  if (trackingWatchId !== null) {
    navigator.geolocation.clearWatch(trackingWatchId);
    trackingWatchId = null;
    trackingLogId = null;
    lastPosition = null;
    accumulatedDistance = 0;
  }
}
