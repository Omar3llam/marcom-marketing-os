// ============================================================
// MARCOM — Firebase Admin SDK Initialization
// ------------------------------------------------------------
// Initializes firebase-admin using service account JSON from env var.
// Used by auth middleware to verify Firebase ID tokens.
//
// Set FIREBASE_SERVICE_ACCOUNT_JSON in Render environment with the
// full JSON content of your Firebase service account file.
// ============================================================
import admin from 'firebase-admin';
import { logger } from './logger.js';

let _initialized = false;

export function initializeFirebaseAdmin() {
  if (_initialized) return admin;

  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (!serviceAccountJson) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set. ' +
        'Please add your Firebase service account JSON to Render environment variables.'
      );
    }

    logger.info('[firebase-admin] Loading service account from env var');

    const serviceAccount = JSON.parse(serviceAccountJson);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });

    _initialized = true;
    logger.info({ projectId: serviceAccount.project_id }, '[firebase-admin] Initialized successfully');
  } catch (err) {
    logger.error({ err: err.message }, '[firebase-admin] Initialization failed');
    throw new Error(`Firebase Admin initialization failed: ${err.message}`);
  }

  return admin;
}

// Initialize on module load
initializeFirebaseAdmin();

export default admin;
