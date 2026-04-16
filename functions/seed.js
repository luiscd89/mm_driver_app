/**
 * One-shot seeder — creates a few drivers and example routes.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node seed.js
 *
 * The drivers array contains (email, password, name). Each gets an Auth user,
 * a /drivers/{uid} doc, and two demo /routes/{load_id} records for today.
 */
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

const drivers = [
  { email: 'jose@mtn.test',  password: 'changeme123', name: 'Jose Martinez' },
  { email: 'mike@mtn.test',  password: 'changeme123', name: 'Mike Johnson'  },
  { email: 'sara@mtn.test',  password: 'changeme123', name: 'Sara Lee'      }
];

const today = new Date().toISOString().slice(0, 10);

async function upsertUser({ email, password, name }) {
  try { return await auth.getUserByEmail(email); }
  catch {
    return await auth.createUser({ email, password, displayName: name });
  }
}

(async () => {
  for (const d of drivers) {
    const user = await upsertUser(d);
    await db.collection('drivers').doc(user.uid).set({
      name: d.name, email: d.email, role: 'driver', fcmTokens: []
    }, { merge: true });

    const routes = [
      {
        load_id: `${user.uid.slice(0,6).toUpperCase()}-A`,
        driver_uid: user.uid,
        driver_name: d.name,
        date: today,
        route: 'DCH1 → SMF5',
        shipper: 'AMZL Outbound',
        distance: 142,
        stops: [
          { facility: 'DCH1', time: '06:00' },
          { facility: 'SMF5', time: '09:30' }
        ],
        confirmed: false,
        dispatched: false,
        notified10min: false
      },
      {
        load_id: `${user.uid.slice(0,6).toUpperCase()}-B`,
        driver_uid: user.uid,
        driver_name: d.name,
        date: today,
        route: 'SMF5 → DLA9',
        shipper: 'DDU Outbound',
        distance: 88,
        stops: [
          { facility: 'SMF5', time: '13:00' },
          { facility: 'DLA9', time: '15:15' }
        ],
        confirmed: false,
        dispatched: false,
        notified10min: false
      }
    ];
    for (const r of routes) {
      await db.collection('routes').doc(r.load_id).set(r);
    }
    console.log(`✅ seeded ${d.name} (${user.uid})`);
  }
  console.log('\nDone.');
  process.exit(0);
})();
