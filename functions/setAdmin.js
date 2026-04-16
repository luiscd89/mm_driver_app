/**
 * Grant the 'admin' custom claim to an existing user.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node setAdmin.js boss@mtn.test
 */
const admin = require('firebase-admin');
admin.initializeApp();

const email = process.argv[2];
if (!email) { console.error('Usage: node setAdmin.js <email>'); process.exit(1); }

(async () => {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { role: 'admin' });
  await admin.firestore().collection('drivers').doc(user.uid)
    .set({ role: 'admin', email, name: user.displayName || email }, { merge: true });
  console.log(`✅ ${email} is now admin (uid=${user.uid})`);
  console.log('User must sign out / back in for the new claim to take effect.');
  process.exit(0);
})();
