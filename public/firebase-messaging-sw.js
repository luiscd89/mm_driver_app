/* Background FCM handler. Uses the compat build because service workers
 * can't yet import the modular SDK directly.
 *
 * ⚠️ Paste the SAME firebaseConfig you used in /js/firebase-config.js.
 */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "REPLACE_ME",
  authDomain:        "REPLACE_ME.firebaseapp.com",
  projectId:         "REPLACE_ME",
  storageBucket:     "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId:             "REPLACE_ME"
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
