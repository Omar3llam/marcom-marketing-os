import { useEffect, useState } from 'react';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  isEmbeddedWebviewOrMobile,
} from '../firebase.js';
import { clearContextCache } from '../router/ProtectedRoute.jsx';

export function useFirebaseAuth() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // authReady: true after Firebase has completed the initial auth check.
  // Without this, post-OAuth-redirect race conditions cause false 401s.
  const [authReady, setAuthReady] = useState(false);

  // ARCHITECTURE: Use signInWithRedirect for mobile/embedded browsers
  // to avoid Google OAuth "disallowed_useragent" error (Error 403).
  const signInWithGoogle = async () => {
    const useRedirect = isEmbeddedWebviewOrMobile();
    console.log('[AuthContext] signInWithGoogle called', { useRedirect, userAgent: navigator.userAgent });
    if (useRedirect) {
      return signInWithRedirect(auth, googleProvider);
    }
    return signInWithPopup(auth, googleProvider);
  };

  const signInWithEmail = async (email, password) => {
    console.log('[AuthContext] signInWithEmail called', { authDefined: !!auth, emailDefined: !!email, passwordDefined: !!password });
    if (!auth) throw new Error('Firebase auth not initialized');
    if (!email || !password) throw new Error('Email and password are required');
    return signInWithEmailAndPassword(auth, email, password);
  };

  const signUpWithEmail = async (email, password) => {
    console.log('[AuthContext] signUpWithEmail called', { authDefined: !!auth, emailDefined: !!email, passwordDefined: !!password, emailLength: email?.length, passwordLength: password?.length });
    if (!auth) throw new Error('Firebase auth not initialized');
    if (!email || !password) throw new Error('Email and password are required');
    return createUserWithEmailAndPassword(auth, email, password);
  };

  // CRITICAL: Clear the onboarding cache BEFORE signing out to prevent stale
  // onboarding state from persisting across user sessions.
  const logout = async () => {
    console.log('[AuthContext] logout called — clearing onboarding cache');
    clearContextCache();
    return signOut(auth);
  };

  const getIdToken = async (forceRefresh = false) => {
    if (!currentUser) return null;
    try {
      return await currentUser.getIdToken(forceRefresh);
    } catch (err) {
      console.error('[AuthContext] getIdToken failed:', err);
      return null;
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // BUGFIX: Handle Google OAuth redirect flow (signInWithRedirect) on mount.
  useEffect(() => {
    const handleRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result) {
          console.log('[AuthContext] Redirect result received:', { user: result.user?.email, providerId: result.providerId });
        }
      } catch (error) {
        console.error('[AuthContext] Redirect result error:', error);
        // Don't throw — let the user retry sign-in
      }
    };
    handleRedirectResult();
  }, []);

  return { currentUser, loading, authReady, signInWithGoogle, signInWithEmail, signUpWithEmail, logout, getIdToken };
}
