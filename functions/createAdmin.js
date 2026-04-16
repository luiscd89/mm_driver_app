/**
 * One-shot script: create a user and grant admin role.
 * Run: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node createAdmin.js
 */
const admin = require('firebase-admin');
admin.initializeApp();

const EMAIL = 'aitruckingmm@gmail.com';
const PASSWORD = 'Morvenca2025!';

(async () => {
  try {
    // Create the user
    const user = await admin.auth().createUser({
      email: EMAIL,
      password: PASSWORD,
      displayName: 'MTN Admin'
    });
    console.log(`User created: ${user.uid}`);

    // Set admin custom claim
    await admin.auth().setCustomUserClaims(user.uid, { role: 'admin' });

    // Create Firestore driver doc
    await admin.firestore().collection('drivers').doc(user.uid).set({
      name: 'MTN Admin',
      email: EMAIL,
      role: 'admin',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`Admin account ready: ${EMAIL}`);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
