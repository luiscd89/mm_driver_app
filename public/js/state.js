/**
 * Firestore live state — replaces the old localStorage-backed `LS` module.
 * Subscribers get pushed fresh data whenever Firestore changes.
 */
import { db } from "./firebase-config.js";
import {
  collection, query, where, onSnapshot, orderBy, doc, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

export const state = {
  routes: [],          // routes for the current driver (or all, if admin)
  allDrivers: [],      // admin only
  allRoutes: [],       // admin only
  gasReceipts: [],     // current driver's receipts (or all, if admin)
  unsub: []
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => fn(state)); }

export function clearSubscriptions() {
  state.unsub.forEach(u => { try { u(); } catch {} });
  state.unsub = [];
  state.routes = []; state.allDrivers = []; state.allRoutes = []; state.gasReceipts = [];
  emit();
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
}

// ─── Mutations ─────────────────────────────────────────────────────
export async function activateRoute(loadId, uid) {
  await updateDoc(doc(db, 'routes', loadId), {
    active: true, activeTime: new Date().toISOString()
  });
  startTracking(uid);
}

export async function confirmRoute(loadId) {
  await updateDoc(doc(db, 'routes', loadId), {
    confirmed: true, confirmTime: new Date().toISOString()
  });
}

export async function dispatchRoute(loadId) {
  await updateDoc(doc(db, 'routes', loadId), {
    dispatched: true, dispatchTime: new Date().toISOString()
  });
  stopTracking();
}

// ─── GPS Tracking ─────────────────────────────────────────────
let trackingWatchId = null;

function startTracking(uid) {
  if (trackingWatchId !== null) return;
  if (!('geolocation' in navigator)) return;

  trackingWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      try {
        await updateDoc(doc(db, 'drivers', uid), {
          location: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            updatedAt: new Date().toISOString()
          }
        });
      } catch (e) {
        console.warn('Location update failed:', e.message);
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
  }
}
