// ============================================================
// MARCOM — Firebase Admin SDK Initialization
// ------------------------------------------------------------
// Initializes firebase-admin using the service account JSON file.
// Used by auth middleware to verify Firebase ID tokens.
// ============================================================
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { logger } from './logger.js';

let _initialized = false;

export function initializeFirebaseAdmin() {
  if (_initialized) return admin;

  try {
    // Path to service account JSON (set via env or default location)
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      || resolve(process.cwd(), 'src/config/firebase-service-account.json');

    logger.info({ path: serviceAccountPath }, '[firebase-admin] Loading service account');

    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });

    _initialized = true;
    logger.info('[firebase-admin] Initialized successfully');
  } catch (err) {
    logger.error({ err: err.message }, '[firebase-admin] Initialization failed');
    throw new Error(`Firebase Admin initialization failed: ${err.message}`);
  }

  return admin;
}

// Initialize on module load
initializeFirebaseAdmin();

export default admin;
