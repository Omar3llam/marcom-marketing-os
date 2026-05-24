import { createContext, useContext } from 'react';
import { useFirebaseAuth } from '../hooks/useFirebaseAuth.js';

const AuthContext = createContext({
  currentUser: null,
  loading: true,
  authReady: false,
  signInWithGoogle: async () => {},
  signInWithEmail: async () => {},
  signUpWithEmail: async () => {},
  logout: async () => {},
  getIdToken: async () => null,
});

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function AuthProvider({ children }) {
  const value = useFirebaseAuth();
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
