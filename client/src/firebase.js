// ============================================================
// MARCOM / Lumi — Firebase Client Configuration
// ============================================================
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCLtn1Q7dzhN-SU_BwsfVulFBzZcQJNgqw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "marcom-ai-722f0.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "marcom-ai-722f0",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "marcom-ai-722f0.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "117077763726",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:117077763726:web:64f5bedc1e39204d4a4bdf",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-T95N4FJH2B"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Google Auth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Export auth methods for convenience
export {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
};

export default app;
