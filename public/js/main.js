import { onAuth, login, register, isAdmin, currentUser } from "./auth.js";
import { listenAsDriver, listenAsAdmin, subscribe, clearSubscriptions } from "./state.js";
import { renderDriverApp, wireDriverEvents } from "./driver.js";
import { renderAdmin, wireAdminEvents } from "./admin.js";
import { handleGasPhoto, submitGasReceipt } from "./gas.js";
import { registerPush } from "./notifications.js";
import { toast } from "./toast.js";

// Expose a tiny set of globals for inline onclick= attributes that remain.
window.submitGasReceipt = submitGasReceipt;
window.handleGasPhoto   = handleGasPhoto;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── Login form ──────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await login(
      document.getElementById('loginEmail').value,
      document.getElementById('loginPassword').value
    );
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

document.getElementById('gasFileInput').addEventListener('change', (e) =>
  handleGasPhoto(e.target));
document.getElementById('gasSubmit').addEventListener('click', submitGasReceipt);
document.getElementById('notifEnable').addEventListener('click', () => {
  if (currentUser) registerPush(currentUser.uid);
});

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
