import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getDatabase, connectDatabaseEmulator, type Database } from 'firebase/database';
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions';
import { getEnvironment, getConfig } from './envSwitcher';

let app: FirebaseApp;
export let auth: Auth;
export let db: Firestore;
export let rtdb: Database;
export let functions: Functions;

let _isReinit = false;

function initForEnv(): void {
  const config = getConfig();

  // Delete previous app if it exists
  if (app) {
    deleteApp(app).catch(() => {/* ignore cleanup errors */});
  }

  // Use a stable name on first load so Auth persistence works across refreshes.
  // Only use a dynamic name during reinit (env switch) to avoid duplicate-app errors.
  const appName = _isReinit ? `admin-${Date.now()}` : 'luminal-admin';
  _isReinit = true;

  app = initializeApp({
    apiKey: 'AIzaSyDhETMiM4-FGiUio8xn0-8u1KPQbfcpvIg',
    authDomain: 'luminal-game.firebaseapp.com',
    projectId: config.projectId,
    storageBucket: 'luminal-game.firebasestorage.app',
    messagingSenderId: '181965726295',
    appId: '1:181965726295:web:db8fc84de39c9493df3912',
    databaseURL: config.databaseURL,
  }, appName);

  auth = getAuth(app);
  db = getFirestore(app);
  rtdb = getDatabase(app);
  functions = getFunctions(app, 'us-central1');

  if (config.isEmulator) {
    if (config.authHost) {
      connectAuthEmulator(auth, config.authHost, { disableWarnings: true });
    }
    if (config.firestoreHost) {
      const [host, port] = config.firestoreHost.split(':');
      connectFirestoreEmulator(db, host, parseInt(port, 10));
    }
    connectDatabaseEmulator(rtdb, 'localhost', 9000);
    connectFunctionsEmulator(functions, 'localhost', 5001);
  }
}

// Initialize on module load
initForEnv();

/**
 * Reinitialize Firebase for the current environment.
 * Call after setEnvironment() to switch connections.
 */
export function reinitFirebase(): void {
  initForEnv();
}
