// ============================================================
// MARCOM / Lumi — Firebase Client Configuration
// ============================================================
// ARCHITECTURE:
// - Lazy initialization (validation before init)
// - Env-only configuration (no committed fallbacks)
// - Explicit error reporting (no silent failures)
// ============================================================
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth';

// ── Config Validation ────────────────────────────────────────

const REQUIRED_ENV = [
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_APP_ID',
];

/**
 * Validates Firebase environment variables.
 * @returns {{ valid: boolean, missing: string[], config: object | null }}
 */
export function validateFirebaseConfig() {
  const missing = REQUIRED_ENV.filter(key => !import.meta.env[key]);

  if (missing.length > 0) {
    console.error('[Firebase] Config validation failed. Missing:', missing);
    return { valid: false, missing, config: null };
  }

  const config = {
    apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId:             import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  };

  return { valid: true, missing: [], config };
}

// ── Lazy Initialization ──────────────────────────────────────

let app = null;
let _auth = null;  // Internal auth instance

/**
 * Initializes Firebase app (lazy singleton pattern).
 * Throws if config validation fails.
 *
 * ARCHITECTURE NOTE:
 * Uses getAuth directly to avoid IndexedDB heartbeat-store corruption
 * issues observed in production.
 */
function initializeFirebase() {
  if (app) return app;

  const validation = validateFirebaseConfig();

  if (!validation.valid) {
    throw new Error(
      `Firebase initialization failed: missing required environment variables: ${validation.missing.join(', ')}`
    );
  }

  app = initializeApp(validation.config);

  // BUGFIX: Use getAuth directly to avoid IndexedDB heartbeat-store corruption
  // See: https://github.com/firebase/firebase-js-sdk/issues/7693
  try {
    _auth = getAuth(app);
  } catch (error) {
    console.error('[Firebase] Auth initialization failed:', error);
    throw error;
  }

  return app;
}

/**
 * Returns the Firebase Auth instance (initializes if needed).
 */
export function getFirebaseAuth() {
  if (!_auth) {
    initializeFirebase();
  }
  return _auth;
}

// ── Google Auth Provider ─────────────────────────────────────

let _googleProvider = null;  // Internal provider instance

/**
 * Returns the Google Auth Provider (initializes if needed).
 */
export function getGoogleProvider() {
  if (!_googleProvider) {
    _googleProvider = new GoogleAuthProvider();
    _googleProvider.setCustomParameters({
      prompt: 'select_account',
    });
  }
  return _googleProvider;
}

// ── User Agent Detection ─────────────────────────────────────

/**
 * Detects if the current browser is an embedded webview or mobile browser.
 * Google blocks OAuth in embedded webviews (Facebook, Instagram, etc.).
 * @returns {boolean} true if embedded webview or mobile browser
 */
export function isEmbeddedWebviewOrMobile() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;

  // Check for embedded webviews (Facebook, Instagram, LINE, etc.)
  const isEmbedded = /FBAN|FBAV|Instagram|Line/i.test(ua);

  // Check for mobile browsers
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);

  return isEmbedded || isMobile;
}

// ── IndexedDB Cleanup Utility ────────────────────────────────
// BUGFIX: Clear corrupted Firebase IndexedDB stores
// Call this if you encounter "firebase-heartbeat-store" errors

export async function clearFirebaseIndexedDB() {
  const databases = [
    'firebase-heartbeat-database',
    'firebaseLocalStorageDb',
  ];

  try {
    for (const db of databases) {
      await indexedDB.deleteDatabase(db);
    }
    return true;
  } catch (error) {
    console.error('[Firebase] Failed to clear IndexedDB:', error);
    return false;
  }
}

// Auto-clear IndexedDB on heartbeat errors (development only)
if (import.meta.env.DEV) {
  window.clearFirebaseIndexedDB = clearFirebaseIndexedDB;
}

// ── Export auth methods for convenience ──────────────────────

export {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
};

// ── Backwards compatibility exports ──────────────────────────
// ARCHITECTURE:
// - main.jsx validates config BEFORE rendering AuthProvider
// - If config invalid → ConfigErrorPage shown (no Firebase init)
// - If config valid → AuthProvider mounts → imports this file → eager init safe
//
// SAFETY: Firebase only initializes if:
//   1. Config validation passed in main.jsx, OR
//   2. Required Vite env vars are present
//
// FUTURE TODO: Refactor all imports to use lazy getters:
//   const auth = getFirebaseAuth();  // explicit lazy init

export const auth = getFirebaseAuth();             // Eager init (safe after validation)
export const googleProvider = getGoogleProvider(); // Eager init

export default initializeFirebase;
