import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const STORAGE_KEY = 'wardrobeai_auth';

const AuthContext = createContext(null);

function isTokenExpired(token) {
  if (!token || token === 'dev-token') return false;
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    if (!payload.exp) return true;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  const clearAuth = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { token: t, user: u } = JSON.parse(stored);
        if (t && !isTokenExpired(t)) {
          setToken(t);
          setUser(u);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setLoading(false);
  }, []);

  const signIn = useCallback(async (idToken) => {
    if (!idToken) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Auth failed');
      const profile = await res.json();
      setToken(idToken);
      setUser(profile);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: idToken, user: profile }));
    } catch (err) {
      console.error('[Auth] Sign-in failed:', err);
    }
  }, []);

  const signInDev = useCallback(() => {
    const devUser = {
      user_id: import.meta.env.VITE_DEFAULT_USER_ID || 'test-user-001',
      email: 'dev@localhost',
      name: 'Dev User',
      picture: null,
    };
    setToken('dev-token');
    setUser(devUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: 'dev-token', user: devUser }));
  }, []);

  const signOut = useCallback(() => {
    try {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.disableAutoSelect();
      }
    } catch {}
    clearAuth();
  }, [clearAuth]);

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!user && !!token,
    signIn,
    signInDev,
    signOut,
    googleClientId: GOOGLE_CLIENT_ID,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
