import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import MobileNav from "./components/MobileNav";
import { TabNavigationProvider } from "./contexts/TabNavigationContext";
import Login from "./components/Login";

const queryClient = new QueryClient();

// Simple auth check using your existing localStorage session
function isAuthenticated() {
  try {
    const raw = localStorage.getItem("di_client_session");
    if (!raw) return false;
    const { id, username, ts } = JSON.parse(raw);
    const MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12 hours
    if (!id || !username) return false;
    if (!ts || Date.now() - ts > MAX_AGE_MS) {
      localStorage.removeItem("di_client_session");
      return false;
    }
    return true;
  } catch {
    localStorage.removeItem("di_client_session"); // Clear invalid sessions
    return false;
  }
}

const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
};

const PublicOnlyRoute = ({ children }: { children: JSX.Element }) => {
  return isAuthenticated() ? <Navigate to="/dashboard" replace /> : children;
};

// Router wrapper component to handle initial route logic
function AppRoutes() {
  const location = useLocation();
  
  useEffect(() => {
    // If we hit the root URL directly, ensure we're starting fresh
    if (location.pathname === "/") {
      // Only remove if we're at exactly root path - this prevents 
      // login loops when navigating within the app
      localStorage.removeItem("di_client_session");
    }
  }, [location.pathname]);

  // Check if we're on the login page or root (which redirects to login when not authenticated)
  const isLoginPage = location.pathname === "/login" || location.pathname === "/";
  
  return (
    <>
      <Routes>
        {/* Default route shows Login for unauthenticated users */}
        <Route
          path="/"
          element={
            <PublicOnlyRoute>
              <Login />
            </PublicOnlyRoute>
          }
        />
        {/* Keep /login explicitly mapped as well */}
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <Login />
            </PublicOnlyRoute>
          }
        />
        {/* Dashboard gated behind auth */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Index />
            </ProtectedRoute>
          }
        />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      
      {/* Only render MobileNav when not on login pages */}
      {!isLoginPage && <MobileNav />}
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <TabNavigationProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
          <div className="container py-8">
          </div>
        </TabNavigationProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
