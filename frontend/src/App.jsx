/**
 * App root component — provides authentication context, routing, and global state.
 *
 * Authentication flow:
 * 1. AuthProvider manages Google Sign-In state
 * 2. Unauthenticated users are redirected to /login
 * 3. Authenticated users get their Google sub as userId
 * 4. In development mode without GOOGLE_CLIENT_ID, falls back to DEFAULT_USER_ID
 */

import React, { createContext, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import MobileNav from './components/MobileNav';
import Wardrobe from './pages/Wardrobe';
import Calendar from './pages/Calendar';
import Outfits from './pages/Outfits';
import History from './pages/History';
import Avatar from './pages/Avatar';
import Login from './pages/Login';

export const AppContext = createContext(null);

/**
 * Protected route wrapper — redirects to /login if not authenticated.
 */
function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-lg mx-auto mt-20 p-8 bg-white rounded-2xl shadow-sm border border-red-100 text-center">
          <h2 className="text-xl font-bold text-red-700 mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Inner app that consumes auth context to derive userId.
 */
function AppInner() {
  const { user, isAuthenticated } = useAuth();
  const [userLocation, setUserLocation] = useState(null);

  // userId comes from authenticated Google sub, or fallback for dev
  const userId = user?.user_id || import.meta.env.VITE_DEFAULT_USER_ID || 'anonymous';

  return (
    <AppContext.Provider value={{ userId, userLocation, setUserLocation, user }}>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50">
          {isAuthenticated && <Navbar />}
          <main className={`${isAuthenticated ? 'pt-16 md:pt-20' : ''} pb-20 md:pb-12 px-3 sm:px-4 md:px-6 max-w-7xl mx-auto`}>
            <ErrorBoundary>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <Navigate to="/wardrobe" replace />
                    </ProtectedRoute>
                  }
                />
                <Route path="/wardrobe" element={<ProtectedRoute><Wardrobe /></ProtectedRoute>} />
                <Route path="/calendar" element={<ProtectedRoute><Calendar /></ProtectedRoute>} />
                <Route path="/outfits/:date" element={<ProtectedRoute><Outfits /></ProtectedRoute>} />
                <Route path="/outfits" element={<ProtectedRoute><Outfits /></ProtectedRoute>} />
                <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
                <Route path="/avatar" element={<ProtectedRoute><Avatar /></ProtectedRoute>} />
              </Routes>
            </ErrorBoundary>
          </main>
          {isAuthenticated && <MobileNav />}
        </div>
      </BrowserRouter>
    </AppContext.Provider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
