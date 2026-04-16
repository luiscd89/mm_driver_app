/* Background FCM handler. Uses the compat build because service workers
 * can't yet import the modular SDK directly.
 *
 * ⚠️ Paste the SAME firebaseConfig you used in /js/firebase-config.js.
 */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyA7g31qD05rUTo9VS4kAlpo4cP4rccy7Jo",
  authDomain:        "trucking-ai-cf0d4.firebaseapp.com",
  projectId:         "trucking-ai-cf0d4",
  storageBucket:     "trucking-ai-cf0d4.firebasestorage.app",
  messagingSenderId: "887761760203",
  appId:             "1:887761760203:web:c1e1fbd7e8f5eff193904e"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'MTN Driver', {
    body: n.body || '',
    icon: '/icon.png',
    data: payload.data || {}
  });
});
