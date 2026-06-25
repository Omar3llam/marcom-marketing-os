// ============================================================
// MARCOM — Firebase Admin SDK Initialization
// ------------------------------------------------------------
// Initializes firebase-admin using service account JSON from env var.
// Used by auth middleware to verify Firebase ID tokens.
//
// Set FIREBASE_SERVICE_ACCOUNT_JSON in Render environment with the
// full JSON content of your Firebase service account file.
// ============================================================
// firebase-admin v14 dropped the legacy namespaced default export
// (`admin.apps` / `admin.credential` / `admin.auth()` are all gone). We use the
// modular subpath API (`firebase-admin/app`, `firebase-admin/auth`) and expose a
// small stable handle so the rest of the app keeps calling `admin.auth()` —
// this file is the single seam over firebase-admin, so the break is absorbed here.
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { logger } from './logger.js';

let _initialized = false;
let _initAttempted = false;
let _initError = null;

// Stable handle with the legacy `.auth()` shape, backed by the modular getAuth().
const admin = { auth: () => getAuth() };

export function initializeFirebaseAdmin() {
  if (_initialized || getApps().length > 0) {
    _initialized = true;
    _initError = null;
    return admin;
  }
  if (_initAttempted && _initError) return null;

  try {
    _initAttempted = true;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (!serviceAccountJson) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set. ' +
        'Please add your Firebase service account JSON to Render environment variables.'
      );
    }

    logger.info('[firebase-admin] Loading service account from env var');

    const serviceAccount = JSON.parse(serviceAccountJson);

    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });

    _initialized = true;
    _initError = null;
    logger.info({ projectId: serviceAccount.project_id }, '[firebase-admin] Initialized successfully');
  } catch (err) {
    _initialized = false;
    _initError = err;
    logger.error({ err: err.message, stack: err.stack }, '[firebase-admin] Initialization failed');
    return null;
  }

  return admin;
}

export function getFirebaseAdminReadiness() {
  if (!_initialized && getApps().length > 0) {
    _initialized = true;
    _initError = null;
  }
  return {
    ok: _initialized,
    status: _initialized ? 'ok' : 'uninitialized',
    error: _initError?.message ?? null,
  };
}

export function requireFirebaseAdminReady() {
  if (!_initialized) initializeFirebaseAdmin();
  const readiness = getFirebaseAdminReadiness();
  if (!readiness.ok) {
    const err = new Error(readiness.error || 'Firebase Admin is not initialized');
    err.code = 'FIREBASE_ADMIN_UNINITIALIZED';
    err.status = 503;
    throw err;
  }
  return admin;
}

// Initialize on module load, but do not crash the process. Protected routes
// classify an uninitialized Admin SDK as a 503 so the failure is visible.
initializeFirebaseAdmin();

export default admin;
