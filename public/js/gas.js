/**
 * Gas receipt upload — photo lands in Firebase Storage, metadata
 * lands in Firestore gasReceipts/{autoId}. No more base64 in localStorage.
 */
import { storage, db } from "./firebase-config.js";
import { currentUser } from "./auth.js";
import { state } from "./state.js";
import { toast } from "./toast.js";
import { ref as sRef, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { collection, addDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

let currentFile = null;

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
      driver_uid:  currentUser.uid,
      driver_name: currentUser.displayName || currentUser.email,
      load_id:     loadId || 'N/A',
      amount:      parseFloat(amount).toFixed(2),
      notes:       document.getElementById('gasNotes').value,
      imageUrl, storagePath: path,
      createdAt:   serverTimestamp()
    });

    currentFile = null;
    document.getElementById('gasForm').style.display = 'none';
    document.getElementById('gasFileInput').value = '';
    document.getElementById('gasAmount').value = '';
    document.getElementById('gasLoadId').value = '';
    document.getElementById('gasNotes').value = '';
    toast('⛽ Receipt uploaded!', 'success');
  } catch (err) {
    console.error(err);
    toast('Upload failed: ' + err.message, 'alert');
  }
}
