# MTN Driver — Firebase Backend

Cloud-backed rebuild of `mtn_driver_app.html`. The old file is untouched; the
new code lives under `public/` (frontend) and `functions/` (Cloud Functions).

## Architecture

| Piece          | Tech                                       |
| -------------- | ------------------------------------------ |
| Hosting        | Firebase Hosting (`public/`)               |
| Auth           | Firebase Auth (email/password)             |
| Real-time data | Firestore `onSnapshot`                     |
| Gas photos     | Firebase Storage                           |
| Push           | FCM Web Push + Cloud Functions scheduler   |
| Backend        | Node.js 20 Cloud Functions (`functions/`)  |

### Firestore collections

- `drivers/{uid}` — `{ name, email, role, fcmTokens[], lastSeen }`
- `routes/{load_id}` — `{ driver_uid, date, stops[], confirmed, dispatched, notified10min, ... }`
- `gasReceipts/{autoId}` — `{ driver_uid, load_id, amount, imageUrl, storagePath, createdAt }`

The old `ROUTES`/`DRIVERS` constants are gone — data now lives in Firestore.

## One-time setup

1. **Create a Firebase project** at https://console.firebase.google.com.
2. Enable: **Authentication (Email/Password)**, **Firestore**, **Storage**, **Cloud Messaging**.
3. Install the CLI and sign in:
   ```bash
   npm i -g firebase-tools
   firebase login
   ```
4. In `.firebaserc`, replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` with your project ID.
5. Get your web-app config (Project settings → General → Your apps → Web) and paste it into:
   - `public/js/firebase-config.js` (and set `VAPID_KEY` from Cloud Messaging → Web Push certificates)
   - `public/firebase-messaging-sw.js` (same config, compat form)
6. Install function deps:
   ```bash
   cd functions && npm install
   ```

## Seed data & first admin

```bash
# Generate a service account key (Project settings → Service accounts → Generate new private key)
# Save it as functions/service-account.json (gitignored).

cd functions
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node seed.js
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node setAdmin.js you@example.com
```

The seeder creates three driver users (`jose@mtn.test` / `mike@mtn.test` / `sara@mtn.test`, password `changeme123`) with two demo routes each for today. `setAdmin.js` grants the `role: admin` custom claim to any existing user — they'll see the admin panel instead of the driver view after re-login.

## Run locally with emulators

```bash
firebase emulators:start
# open http://localhost:5000
```

## Deploy

```bash
firebase deploy
```

Or piece by piece:
```bash
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules,storage:rules
```

## How push notifications work now

1. Driver signs in → `registerPush()` asks for permission, gets an FCM token, adds it to `drivers/{uid}.fcmTokens[]`.
2. `scheduledCheckTrips` runs every minute. For routes where `date == today`, `notified10min == false`, and first stop is 9–11 min away, it calls FCM and sets `notified10min = true`.
3. Admins can also fire a manual alert from the drivers tab, which calls the `sendAdminAlert` callable function.

## Security rules summary

- **Firestore**: drivers can read/update only their own routes, and only for `confirmed`/`dispatched`/time fields; admins can do anything. See `firestore.rules`.
- **Storage**: drivers can only write their own `gas_receipts/{uid}/*` path, images under 8 MB.

## What about the old `mtn_driver_app.html`?

Left in place for reference. The new app is a drop-in replacement served from Firebase Hosting — you can delete the old file once you're happy with the new one.
