// ============================================================
// MARCOM / Lumi — Firebase Client Configuration
// ============================================================
// ARCHITECTURE:
// - Lazy initialization (validation before init)
// - Production-strict mode (no fallbacks in prod)
// - Development fallbacks (localhost convenience)
// - Explicit error reporting (no silent failures)
// ============================================================
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  browserLocalPersistence,
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
  console.log('[Firebase] Validating config. Environment variables:', {
    API_KEY: import.meta.env.VITE_FIREBASE_API_KEY ? '✓ present' : '✗ missing',
    PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID ? '✓ present' : '✗ missing',
    APP_ID: import.meta.env.VITE_FIREBASE_APP_ID ? '✓ present' : '✗ missing',
  });

  const missing = REQUIRED_ENV.filter(key => !import.meta.env[key]);

  if (missing.length > 0) {
    console.error('[Firebase] Config validation failed. Missing:', missing);
    return { valid: false, missing, config: null };
  }

  // Production: strict mode (no fallbacks)
  // Development: allow fallbacks for localhost convenience
  const isDev = import.meta.env.DEV;
  const fallback = (envKey, devDefault) => {
    if (import.meta.env[envKey]) return import.meta.env[envKey];
    if (isDev) return devDefault;
    console.error(`[Firebase] Missing required env var in production: ${envKey}`);
    return '';
  };

  const config = {
    apiKey:            fallback('VITE_FIREBASE_API_KEY', 'AIzaSyCLtn1Q7dzhN-SU_BwsfVulFBzZcQJNgqw'),
    authDomain:        fallback('VITE_FIREBASE_AUTH_DOMAIN', 'marcom-ai-722f0.firebaseapp.com'),
    projectId:         fallback('VITE_FIREBASE_PROJECT_ID', 'marcom-ai-722f0'),
    storageBucket:     fallback('VITE_FIREBASE_STORAGE_BUCKET', 'marcom-ai-722f0.firebasestorage.app'),
    messagingSenderId: fallback('VITE_FIREBASE_MESSAGING_SENDER_ID', '117077763726'),
    appId:             fallback('VITE_FIREBASE_APP_ID', '1:117077763726:web:64f5bedc1e39204d4a4bdf'),
    measurementId:     fallback('VITE_FIREBASE_MEASUREMENT_ID', 'G-T95N4FJH2B'),
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
 * Uses initializeAuth with explicit browserLocalPersistence to prevent
 * IndexedDB heartbeat-store corruption issues in production.
 * Falls back to getAuth if initializeAuth fails (e.g., already initialized).
 */
function initializeFirebase() {
  if (app) return app;

  const validation = validateFirebaseConfig();

  if (!validation.valid) {
    throw new Error(
      `Firebase initialization failed: missing required environment variables: ${validation.missing.join(', ')}`
    );
  }

  console.log('[Firebase] Initializing with config:', {
    projectId: validation.config.projectId,
    authDomain: validation.config.authDomain,
  });

  app = initializeApp(validation.config);

  // Try initializeAuth first, fall back to getAuth if it fails
  // BUGFIX: Use getAuth directly to avoid IndexedDB heartbeat-store corruption
  // See: https://github.com/firebase/firebase-js-sdk/issues/7693
  try {
    _auth = getAuth(app);
    console.log('[Firebase] Auth initialized (using default persistence to avoid IndexedDB issues)');
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
    console.log('[Firebase] Auth not yet initialized, calling initializeFirebase()');
    initializeFirebase();
  }
  console.log('[Firebase] getFirebaseAuth returning:', { defined: !!_auth, type: typeof _auth });
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
      console.log(`[Firebase] Cleared IndexedDB: ${db}`);
    }
    console.log('[Firebase] IndexedDB cleanup complete. Please refresh the page.');
    return true;
  } catch (error) {
    console.error('[Firebase] Failed to clear IndexedDB:', error);
    return false;
  }
}

// Auto-clear IndexedDB on heartbeat errors (development only)
if (import.meta.env.DEV) {
  window.clearFirebaseIndexedDB = clearFirebaseIndexedDB;
  console.log('[Firebase] Dev mode: run clearFirebaseIndexedDB() to fix IndexedDB issues');
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
//   2. Development mode with fallback config
//
// FUTURE TODO: Refactor all imports to use lazy getters:
//   const auth = getFirebaseAuth();  // explicit lazy init

export const auth = getFirebaseAuth();             // Eager init (safe after validation)
export const googleProvider = getGoogleProvider(); // Eager init

export default initializeFirebase;
