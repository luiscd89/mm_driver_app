/**
 * Fuel management — request fuel, self-fill receipts, dashboard analysis.
 */
import { storage, db, functions } from "./firebase-config.js";
import { currentUser } from "./auth.js";
import { state } from "./state.js";
import { toast } from "./toast.js";
import { ref as sRef, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { collection, addDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { httpsCallable }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

const analyzeDashboard = httpsCallable(functions, 'analyzeDashboard');
const submitFuelRequestFn = httpsCallable(functions, 'submitFuelRequest');

let currentFile = null;
let dashFile = null;
let receiptFile = null;

// Legacy gas receipt functions (kept for backward compat)
export function handleGasPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  currentFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('gasPreview');
    preview.src = e.target.result;
    preview.style.display = 'block';
    document.getElementById('gasForm').style.display = 'block';
    const active = state.routes.find(r => r.confirmed && !r.dispatched);
    if (active) document.getElementById('gasLoadId').value = active.load_id;
  };
  reader.readAsDataURL(file);
}

export async function submitGasReceipt() {
  if (!currentUser) return;
  const amount = document.getElementById('gasAmount').value;
  const loadId = document.getElementById('gasLoadId').value;
  if (!amount)      { toast('Enter the amount paid', 'warn'); return; }
  if (!currentFile) { toast('Please take/choose a photo', 'warn'); return; }
  try {
    toast('Uploading…', 'info');
    const filename = `${Date.now()}_${currentFile.name.replace(/[^\w.-]/g,'_')}`;
    const path = `gas_receipts/${currentUser.uid}/${filename}`;
    const storageRef = sRef(storage, path);
    await uploadBytes(storageRef, currentFile, { contentType: currentFile.type });
    const imageUrl = await getDownloadURL(storageRef);
    await addDoc(collection(db, 'gasReceipts'), {
      driver_uid: currentUser.uid,
      driver_name: currentUser.displayName || currentUser.email,
      load_id: loadId || 'N/A',
      amount: parseFloat(amount).toFixed(2),
      notes: document.getElementById('gasNotes').value,
      imageUrl, storagePath: path,
      createdAt: serverTimestamp()
    });
    currentFile = null;
    document.getElementById('gasForm').style.display = 'none';
    document.getElementById('gasFileInput').value = '';
    document.getElementById('gasAmount').value = '';
    document.getElementById('gasLoadId').value = '';
    document.getElementById('gasNotes').value = '';
    toast('Receipt uploaded!', 'success');
  } catch (err) {
    toast('Upload failed: ' + err.message, 'alert');
  }
}

// ─── Fuel Request System ────────────────────────────────────
export function renderFuelTab() {
  const container = document.getElementById('fuelContent');
  if (!container) return;

  const activeRoute = state.routes.find(r => (r.active || r.confirmed) && !r.dispatched);
  const loadId = activeRoute?.load_id || '';

  container.innerHTML = `
    <div style="padding:16px;">
      <!-- Request Fuel -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:12px;">⛽ Request Fuel</div>
        <p style="font-size:11px;color:var(--muted);margin-bottom:12px;">Take a photo of your dashboard. We'll read the gauges and estimate fuel cost.</p>

        <label class="gas-file-btn" for="dashPhotoInput" style="display:block;text-align:center;margin-bottom:12px;">📷 Take Dashboard Photo</label>
        <input type="file" id="dashPhotoInput" accept="image/*" capture="environment" style="display:none;">
        <img id="dashPreview" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;margin-bottom:12px;display:none;">

        <div id="dashAnalyzing" style="display:none;text-align:center;padding:12px;color:var(--accent);">
          <span class="btn-spinner" style="border-color:rgba(0,212,170,.3);border-top-color:var(--accent);"></span>
          <span style="margin-left:8px;font-size:12px;">Analyzing dashboard...</span>
        </div>

        <div id="fuelFields" style="display:none;">
          <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px;">Load ID</label>
          <input class="gas-input" type="text" id="fuelLoadId" value="${loadId}" placeholder="Auto-filled from active route">

          <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px;">Odometer (miles)</label>
          <input class="gas-input" type="number" id="fuelOdometer" placeholder="e.g. 245000">

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px;">Fuel Level %</label>
              <input class="gas-input" type="number" id="fuelLevel" min="0" max="100" placeholder="e.g. 15">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px;">DEF Level %</label>
              <input class="gas-input" type="number" id="defLevel" min="0" max="100" placeholder="e.g. 40">
            </div>
          </div>

          <div id="fuelEstimate" style="display:none;background:rgba(0,212,170,.1);border:1px solid rgba(0,212,170,.3);border-radius:8px;padding:12px;margin-bottom:12px;">
          </div>

          <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px;">Notes (optional)</label>
          <input class="gas-input" type="text" id="fuelNotes" placeholder="e.g. Low DEF warning on">

          <button id="submitFuelRequest" class="gas-submit" style="background:var(--accent);">⛽ Submit Fuel Request</button>
        </div>
      </div>

      <!-- Self-Fill Receipt -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:12px;">🧾 Already Filled Up?</div>
        <p style="font-size:11px;color:var(--muted);margin-bottom:12px;">Upload your receipt and we'll track the expense.</p>

        <label class="gas-file-btn" for="receiptPhotoInput" style="display:block;text-align:center;margin-bottom:12px;">📷 Take Receipt Photo</label>
        <input type="file" id="receiptPhotoInput" accept="image/*" capture="environment" style="display:none;">
        <img id="receiptPreview" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;margin-bottom:12px;display:none;">

        <div id="receiptFields" style="display:none;">
          <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px;">Amount Paid ($)</label>
          <input class="gas-input" type="number" id="receiptAmount" step="0.01" placeholder="e.g. 487.50">

          <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px;">Load ID</label>
          <input class="gas-input" type="text" id="receiptLoadId" value="${loadId}" placeholder="Which route">

          <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px;">Odometer (miles)</label>
          <input class="gas-input" type="number" id="receiptOdometer" placeholder="Current miles">

          <button id="submitSelfFill" class="gas-submit" style="background:var(--accent2);">🧾 Submit Receipt</button>
        </div>
      </div>

      <!-- Fuel History -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:12px;">📊 Fuel History</div>
        <div id="fuelHistoryList"></div>
      </div>
    </div>`;

  renderFuelHistory();
}

function renderFuelHistory() {
  const list = document.getElementById('fuelHistoryList');
  if (!list) return;
  const reqs = state.fuelRequests || [];
  if (!reqs.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:16px">No fuel records yet</div>';
    return;
  }
  list.innerHTML = reqs.slice(0, 10).map(r => {
    const statusColors = { pending: 'var(--accent2)', approved: 'var(--ok)', denied: 'var(--danger)', completed: 'var(--blue)' };
    const statusLabels = { pending: 'Pending', approved: 'Approved', denied: 'Denied', completed: 'Filled' };
    const color = statusColors[r.status] || 'var(--muted)';
    const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString() : '';
    return `<div style="border-bottom:1px solid var(--border);padding:10px 0;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:12px;font-weight:600;">${r.type === 'self-fill' ? '🧾' : '⛽'} ${r.load_id || 'N/A'}</div>
        <div style="font-size:10px;color:var(--muted);">${date} · ${r.odometer ? r.odometer + ' mi' : ''} · Fuel: ${r.fuelLevel != null ? r.fuelLevel + '%' : 'N/A'}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:var(--accent2);">$${r.receiptAmount || r.estimatedCost || r.approvedAmount || 0}</div>
        <span style="font-size:9px;padding:2px 7px;border-radius:10px;background:${color}22;color:${color};font-weight:600;">${statusLabels[r.status] || r.status}</span>
      </div>
    </div>`;
  }).join('');
}

export function wireFuelEvents() {
  const content = document.getElementById('fuelContent');
  if (!content) return;

  content.addEventListener('change', async (e) => {
    // Dashboard photo
    if (e.target.id === 'dashPhotoInput') {
      const file = e.target.files[0];
      if (!file) return;
      dashFile = file;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const preview = document.getElementById('dashPreview');
        preview.src = ev.target.result;
        preview.style.display = 'block';
        document.getElementById('fuelFields').style.display = 'block';

        // Try AI analysis
        const analyzing = document.getElementById('dashAnalyzing');
        analyzing.style.display = 'flex';
        try {
          const base64 = ev.target.result.split(',')[1];
          const result = await analyzeDashboard({ imageBase64: base64 });
          if (result.data?.success && result.data?.data) {
            const d = result.data.data;
            if (d.odometer) document.getElementById('fuelOdometer').value = d.odometer;
            if (d.fuelLevel != null) document.getElementById('fuelLevel').value = d.fuelLevel;
            if (d.defLevel != null) document.getElementById('defLevel').value = d.defLevel;
            toast('Dashboard analyzed! Verify the readings.', 'success');
            updateFuelEstimate();
          } else {
            toast('Could not auto-read dashboard. Please enter manually.', 'info');
          }
        } catch (err) {
          toast('Auto-read unavailable. Enter readings manually.', 'info');
        }
        analyzing.style.display = 'none';
      };
      reader.readAsDataURL(file);
    }

    // Receipt photo
    if (e.target.id === 'receiptPhotoInput') {
      const file = e.target.files[0];
      if (!file) return;
      receiptFile = file;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const preview = document.getElementById('receiptPreview');
        preview.src = ev.target.result;
        preview.style.display = 'block';
        document.getElementById('receiptFields').style.display = 'block';
      };
      reader.readAsDataURL(file);
    }

    // Update estimate when fuel level changes
    if (e.target.id === 'fuelLevel') updateFuelEstimate();
  });

  content.addEventListener('input', (e) => {
    if (e.target.id === 'fuelLevel') updateFuelEstimate();
  });

  content.addEventListener('click', async (e) => {
    // Submit fuel request
    if (e.target.id === 'submitFuelRequest') {
      const fuelLevel = document.getElementById('fuelLevel')?.value;
      if (!dashFile) { toast('Take a dashboard photo first', 'warn'); return; }
      if (!fuelLevel) { toast('Enter fuel level %', 'warn'); return; }

      e.target.disabled = true;
      e.target.innerHTML = '<span class="btn-spinner"></span> Submitting...';

      try {
        // Upload dash image
        const filename = `${Date.now()}_dash.jpg`;
        const path = `fuel_dash/${currentUser.uid}/${filename}`;
        const storageRef = sRef(storage, path);
        await uploadBytes(storageRef, dashFile, { contentType: dashFile.type });
        const dashImageUrl = await getDownloadURL(storageRef);

        const result = await submitFuelRequestFn({
          type: 'request',
          loadId: document.getElementById('fuelLoadId')?.value || '',
          odometer: parseInt(document.getElementById('fuelOdometer')?.value) || null,
          fuelLevel: parseInt(fuelLevel),
          defLevel: parseInt(document.getElementById('defLevel')?.value) || null,
          dashImageUrl,
          dashStoragePath: path,
          notes: document.getElementById('fuelNotes')?.value || ''
        });

        toast(`Fuel request sent! Est: $${result.data.estimatedCost}`, 'success');
        dashFile = null;
        renderFuelTab();
      } catch (err) {
        toast('Request failed: ' + err.message, 'alert');
        e.target.disabled = false;
        e.target.innerHTML = '⛽ Submit Fuel Request';
      }
    }

    // Submit self-fill receipt
    if (e.target.id === 'submitSelfFill') {
      const amount = document.getElementById('receiptAmount')?.value;
      if (!receiptFile) { toast('Take a receipt photo first', 'warn'); return; }
      if (!amount) { toast('Enter the amount paid', 'warn'); return; }

      e.target.disabled = true;
      e.target.innerHTML = '<span class="btn-spinner"></span> Submitting...';

      try {
        const filename = `${Date.now()}_receipt.jpg`;
        const path = `fuel_receipts/${currentUser.uid}/${filename}`;
        const storageRef = sRef(storage, path);
        await uploadBytes(storageRef, receiptFile, { contentType: receiptFile.type });
        const receiptImageUrl = await getDownloadURL(storageRef);

        await submitFuelRequestFn({
          type: 'self-fill',
          loadId: document.getElementById('receiptLoadId')?.value || '',
          odometer: parseInt(document.getElementById('receiptOdometer')?.value) || null,
          receiptImageUrl,
          receiptStoragePath: path,
          receiptAmount: parseFloat(amount)
        });

        toast('Receipt submitted!', 'success');
        receiptFile = null;
        renderFuelTab();
      } catch (err) {
        toast('Upload failed: ' + err.message, 'alert');
        e.target.disabled = false;
        e.target.innerHTML = '🧾 Submit Receipt';
      }
    }
  });
}

function updateFuelEstimate() {
  const fuelLevel = parseInt(document.getElementById('fuelLevel')?.value);
  const estimateDiv = document.getElementById('fuelEstimate');
  if (!estimateDiv || isNaN(fuelLevel)) { if (estimateDiv) estimateDiv.style.display = 'none'; return; }

  const tankCapacity = 150; // gallons
  const dieselPrice = 3.85; // fallback, actual from server
  const gallonsNeeded = Math.round(tankCapacity * (1 - fuelLevel / 100));
  const cost = (gallonsNeeded * dieselPrice).toFixed(2);

  estimateDiv.style.display = 'block';
  estimateDiv.innerHTML = `
    <div style="font-size:10px;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:4px;">Estimated Fuel Cost</div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;color:var(--text2);">${gallonsNeeded} gal × ~$${dieselPrice}/gal</span>
      <span style="font-family:'Space Mono',monospace;font-size:18px;font-weight:700;color:var(--accent);">$${cost}</span>
    </div>`;
}
