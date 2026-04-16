// Replace with the config from your Firebase console:
//   Project settings → General → Your apps → Web app
// Also paste the same config into /public/firebase-messaging-sw.js.
export const firebaseConfig = {
  apiKey:            "AIzaSyA7g31qD05rUTo9VS4kAlpo4cP4rccy7Jo",
  authDomain:        "trucking-ai-cf0d4.firebaseapp.com",
  projectId:         "trucking-ai-cf0d4",
  storageBucket:     "trucking-ai-cf0d4.firebasestorage.app",
  messagingSenderId: "887761760203",
  appId:             "1:887761760203:web:c1e1fbd7e8f5eff193904e"
};

// Web Push "VAPID" key — Project settings → Cloud Messaging → Web Push certificates.
export const VAPID_KEY = "BLpZ6H9MS158JjnjWn5EXt5U_P-eBwk3o49WhtrdbIZZk11YRxnv64UBMDItwtFQhHb81Ju7DueEee1MbRsp0PI";

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
