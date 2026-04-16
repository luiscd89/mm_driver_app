/**
 * FCM web-push registration. Replaces the client-side setInterval/Notification
 * logic — the 10-min warning is now fired from the scheduledCheckTrips
 * Cloud Function, so the browser only needs a valid token.
 */
import { messaging, db, VAPID_KEY } from "./firebase-config.js";
import { doc, updateDoc, arrayUnion }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getToken, onMessage }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";
import { toast } from "./toast.js";

export async function registerPush(uid) {
  if (!messaging) return;
  if (!('Notification' in window)) return;

  const banner = document.getElementById('notifBanner');

  if (Notification.permission === 'denied') {
    if (banner) banner.style.display = 'flex';
    return;
  }
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') {
      if (banner) banner.style.display = 'flex';
      return;
    }
  }
  if (banner) banner.style.display = 'none';

  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY, serviceWorkerRegistration: reg
  });
  if (!token) return;

  await updateDoc(doc(db, 'drivers', uid), {
    fcmTokens: arrayUnion(token)
  });

  onMessage(messaging, (payload) => {
    const n = payload.notification || {};
    toast(`${n.title || 'Alert'} — ${n.body || ''}`, 'alert');
  });
}
