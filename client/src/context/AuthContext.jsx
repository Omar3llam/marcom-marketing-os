// ============================================================
// MARCOM / Lumi — Firebase Auth Context
// ------------------------------------------------------------
// Provides authentication state and methods throughout the app.
// Listens to Firebase auth state changes via onAuthStateChanged.
// ============================================================
import { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from '../firebase.js';
import { clearContextCache } from '../router/ProtectedRoute.jsx';

const AuthContext = createContext({
  currentUser: null,
  loading: true,
  signInWithGoogle: async () => {},
  signInWithEmail: async () => {},
  signUpWithEmail: async () => {},
  logout: async () => {},
  getIdToken: async () => null,
});

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // authReady: true after Firebase has completed the initial auth check.
  // Components should wait for authReady before calling protected APIs.
  // Without this, post-OAuth-redirect race conditions cause false 401s.
  const [authReady, setAuthReady] = useState(false);

  // Sign in with Google
  const signInWithGoogle = async () => {
    return signInWithPopup(auth, googleProvider);
  };

  // Sign in with Email/Password
  const signInWithEmail = async (email, password) => {
    console.log('[AuthContext] signInWithEmail called', {
      authDefined: !!auth,
      emailDefined: !!email,
      passwordDefined: !!password,
    });

    if (!auth) {
      throw new Error('Firebase auth not initialized');
    }
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    return signInWithEmailAndPassword(auth, email, password);
  };

  // Sign up with Email/Password
  const signUpWithEmail = async (email, password) => {
    console.log('[AuthContext] signUpWithEmail called', {
      authDefined: !!auth,
      emailDefined: !!email,
      passwordDefined: !!password,
      emailLength: email?.length,
      passwordLength: password?.length,
    });

    if (!auth) {
      throw new Error('Firebase auth not initialized');
    }
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    return createUserWithEmailAndPassword(auth, email, password);
  };

  // Logout
  const logout = async () => {
    console.log('[AuthContext] logout called — clearing onboarding cache');

    // CRITICAL: Clear the onboarding cache BEFORE signing out.
    // This prevents stale onboarding state from persisting across
    // user sessions, which could cause User B to bypass onboarding
    // if User A's cache wasn't properly invalidated.
    clearContextCache();

    return signOut(auth);
  };

  // Get Firebase ID Token (for API calls)
  const getIdToken = async (forceRefresh = false) => {
    if (!currentUser) return null;
    try {
      return await currentUser.getIdToken(forceRefresh);
    } catch (err) {
      console.error('[AuthContext] getIdToken failed:', err);
      return null;
    }
  };

  // Listen to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
      // Mark auth as resolved — safe for API calls now
      setAuthReady(true);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    loading,
    authReady,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    logout,
    getIdToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
