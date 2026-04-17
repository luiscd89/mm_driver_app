import { onAuth, login, register, logout, isAdmin, currentUser } from "./auth.js";
import { listenAsDriver, listenAsAdmin, subscribe, clearSubscriptions } from "./state.js";
import { renderDriverApp, wireDriverEvents } from "./driver.js";
import { renderAdmin, wireAdminEvents } from "./admin.js";
import { registerPush } from "./notifications.js";
import { toast } from "./toast.js";

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── Remember username ───────────────────────────────────────
const emailInput = document.getElementById('loginEmail');
try { emailInput.value = localStorage.getItem('lastUsername') || ''; } catch {}

// ─── Login form ──────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = emailInput.value;
  try {
    await login(username, document.getElementById('loginPassword').value);
    try { localStorage.setItem('lastUsername', username); } catch {}
  } catch (err) {
    toast('Login failed: ' + err.message, 'alert');
  }
});

document.getElementById('registerBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) return toast('Enter email and password first', 'alert');
  try {
    await register(email, password);
    toast('Account created!', 'success');
  } catch (err) {
    toast('Registration failed: ' + err.message, 'alert');
  }
});

document.getElementById('notifEnable').addEventListener('click', () => {
  if (currentUser) registerPush(currentUser.uid);
});

document.getElementById('logoutBtn').addEventListener('click', () => logout());
document.getElementById('logoutBtnAdmin').addEventListener('click', () => logout());

wireDriverEvents();
wireAdminEvents();

// ─── Re-render on state updates ──────────────────────────────
subscribe(() => {
  if (!currentUser) return;
  if (isAdmin()) renderAdmin();
  else           renderDriverApp();
});

// Periodically refresh countdowns.
setInterval(() => {
  if (currentUser && !isAdmin()) renderDriverApp();
}, 60000);

// ─── Auth gate ───────────────────────────────────────────────
onAuth((user) => {
  if (!user) {
    clearSubscriptions();
    showScreen('loginScreen');
    return;
  }
  if (isAdmin()) {
    listenAsAdmin();
    showScreen('adminScreen');
    renderAdmin('overview');
  } else {
    listenAsDriver(user.uid);
    showScreen('driverScreen');
    registerPush(user.uid).catch(console.error);
  }
});
