// Replace with the config from your Firebase console:
//   Project settings → General → Your apps → Web app
// Also paste the same config into /public/firebase-messaging-sw.js.
export const firebaseConfig = {
  apiKey:            "REPLACE_ME",
  authDomain:        "REPLACE_ME.firebaseapp.com",
  projectId:         "REPLACE_ME",
  storageBucket:     "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId:             "REPLACE_ME"
};

// Web Push "VAPID" key — Project settings → Cloud Messaging → Web Push certificates.
export const VAPID_KEY = "REPLACE_ME";

import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getStorage }     from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { getFunctions }   from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { getMessaging, isSupported }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";

export const app       = initializeApp(firebaseConfig);
export const auth      = getAuth(app);
export const db        = getFirestore(app);
export const storage   = getStorage(app);
export const functions = getFunctions(app);
export const messaging = (await isSupported()) ? getMessaging(app) : null;
