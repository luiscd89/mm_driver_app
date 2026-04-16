import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

export let currentUser   = null;
export let currentClaims = {};

export function onAuth(cb) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    currentClaims = {};
    if (user) {
      const token = await user.getIdTokenResult();
      currentClaims = token.claims || {};
      try {
        await setDoc(doc(db, 'drivers', user.uid),
          { lastSeen: serverTimestamp() }, { merge: true });
      } catch (e) {
        console.warn('lastSeen update failed:', e.message);
      }
    }
    cb(user);
  });
}

function resolveEmail(input) {
  const v = input.trim();
  if (v.includes('@')) return v;
  // Admin shorthand
  if (v === 'aitruckingmm') return 'aitruckingmm@gmail.com';
  return v + '@mtndriver.com';
}

export async function login(email, password) {
  await signInWithEmailAndPassword(auth, resolveEmail(email), password);
}

export async function register(email, password) {
  await createUserWithEmailAndPassword(auth, resolveEmail(email), password);
}

export async function logout() {
  await signOut(auth);
}

export function isAdmin() {
  return currentClaims.role === 'admin';
}
