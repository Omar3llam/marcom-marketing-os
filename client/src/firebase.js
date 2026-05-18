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
    return { valid: false, missing, config: null };
  }

  // Production: strict mode (no fallbacks)
  // Development: allow fallbacks for localhost convenience
  const isDev = import.meta.env.DEV;
  const fallback = (envKey, devDefault) =>
    import.meta.env[envKey] || (isDev ? devDefault : '');

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

  // Use initializeAuth with explicit persistence (prevents IndexedDB corruption)
  _auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
  });

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

// ── Export auth methods for convenience ──────────────────────

export {
  signInWithPopup,
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
