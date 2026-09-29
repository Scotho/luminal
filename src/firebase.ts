// ── Firebase Initialization ──────────────────────────────
import { initializeApp, setLogLevel } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { ENABLE_APP_CHECK, IS_LOCAL_BUILD } from './buildFlags';


const firebaseConfig = {
  apiKey: 'AIzaSyDhETMiM4-FGiUio8xn0-8u1KPQbfcpvIg',
  authDomain: 'luminal-game.firebaseapp.com',
  projectId: 'luminal-game',
  storageBucket: 'luminal-game.firebasestorage.app',
  messagingSenderId: '181965726295',
  appId: '1:181965726295:web:db8fc84de39c9493df3912',
  databaseURL: 'https://luminal-game-default-rtdb.firebaseio.com',
  measurementId: 'G-KSXCPP35TR',
};

const app = initializeApp(firebaseConfig);

setLogLevel(IS_LOCAL_BUILD ? 'silent' : 'error');

export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const functions = getFunctions(app, 'us-central1');
export const storage = getStorage(app);

// ── App Check ───────────────────────────────────────────
// Debug token for local development — must be set BEFORE initializeAppCheck.
// Using a fixed token so it only needs to be registered once in Firebase Console
// (App Check → Manage debug tokens). Set to `true` to auto-generate a random token.
if (IS_LOCAL_BUILD) {
  (self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}

export const appCheck = ENABLE_APP_CHECK
  ? initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider('6LcacacsAAAAAIDQJTSeHfE8GFrm3Z2bUCe9DyYn'),
    isTokenAutoRefreshEnabled: true,
  })
  : null;

if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectDatabaseEmulator(rtdb, 'localhost', 9000);
  connectFirestoreEmulator(db, 'localhost', 8080);
}
