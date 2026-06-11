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
    if (useRedirect) {
      return signInWithRedirect(auth, googleProvider);
    }
    return signInWithPopup(auth, googleProvider);
  };

  const signInWithEmail = async (email, password) => {
    if (!auth) throw new Error('Firebase auth not initialized');
    if (!email || !password) throw new Error('Email and password are required');
    return signInWithEmailAndPassword(auth, email, password);
  };

  const signUpWithEmail = async (email, password) => {
    if (!auth) throw new Error('Firebase auth not initialized');
    if (!email || !password) throw new Error('Email and password are required');
    return createUserWithEmailAndPassword(auth, email, password);
  };

  // CRITICAL: Clear the onboarding cache BEFORE signing out to prevent stale
  // onboarding state from persisting across user sessions.
  const logout = async () => {
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
    // getRedirectResult must resolve before we declare auth ready.
    // Without this, onAuthStateChanged can fire with user=null (no cached session)
    // before the redirect credential is processed. That null leaks through
    // ProtectedRoute → navigate to /login, and any in-flight API calls fire
    // with no token → 401 → blank page.
    //
    // After the first startup the promise is already resolved, so subsequent
    // onAuthStateChanged calls (logout, token refresh) have zero extra latency.
    const redirectPromise = getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          // User successfully signed in via redirect.
        }
      })
      .catch((err) => {
        console.error('[AuthContext] Redirect result error:', err);
      });

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      await redirectPromise;
      setCurrentUser(user);
      setLoading(false);
      setAuthReady(true);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return { currentUser, loading, authReady, signInWithGoogle, signInWithEmail, signUpWithEmail, logout, getIdToken };
}
