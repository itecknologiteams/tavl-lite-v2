import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@store/authStore';
import LoginScreen from '@features/auth/LoginScreen';
import Dashboard from '@features/dashboard/Dashboard';
import SupervisorDashboard from '@features/supervisor/SupervisorDashboard';
import { TrackingWall } from '@features/tracking-wall';
import { AnalyticsWall } from '@features/analytics-wall';
import '@/styles/glass.css';

// PBX Admin imports
import {
  PbxAdminLogin, PbxAdminShell, DashboardPage, ExtensionsPage, TrunksPage, QueuesPage,
  QueueMonitorPage, RingGroupsPage, ConferencesPage, RoutingPage, TimeConditionsPage,
  IvrPage, MohPage, BackupPage, SystemPage, SipProfilesPage, ScriptsPage,
  VoicemailPage, FaxPage, useAdminAuthStore
} from '@features/pbx-admin';
import { CdrPage } from '@features/pbx-admin/pages/CdrPage';
import { BlacklistPage } from '@features/pbx-admin/pages/BlacklistPage';

// PBX Admin V2 imports
import { PbxAdminV2Routes } from '@features/pbx-admin-v2';

// Role-based redirect component
function RoleBasedRedirect() {
  const user = useAuthStore((state) => state.user);
  const isSupervisor = user?.role === 'supervisor' || user?.role === 'admin';
  
  // Redirect based on role
  return <Navigate to={isSupervisor ? '/supervisor' : '/agent'} replace />;
}

// Protected route component
function ProtectedRoute({ 
  children, 
  allowedRoles 
}: { 
  children: React.ReactNode; 
  allowedRoles?: ('supervisor' | 'admin' | 'operator' | 'agent')[];
}) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  // If roles are specified, check if user has permission
  if (allowedRoles && user) {
    const userRole = user.role || 'operator';
    // Treat 'supervisor' and 'admin' as equivalent
    const normalizedRole = userRole === 'admin' ? 'supervisor' : userRole;
    const hasAccess = allowedRoles.some(role => 
      role === normalizedRole || 
      (role === 'supervisor' && userRole === 'admin') ||
      (role === 'admin' && userRole === 'supervisor')
    );
    
    if (!hasAccess) {
      // Redirect to appropriate dashboard based on role
      const isSupervisor = userRole === 'supervisor' || userRole === 'admin';
      return <Navigate to={isSupervisor ? '/supervisor' : '/agent'} replace />;
    }
  }
  
  return <>{children}</>;
}

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    try { localStorage.removeItem('tavl-auth-storage'); } catch {}
  }, []);

  useEffect(() => {
    const handleUnload = () => {
      const state = useAuthStore.getState();
      if (!state.user) return;
      const payload = JSON.stringify({
        userId: state.user.id,
        extension: (() => {
          try { return JSON.parse(localStorage.getItem('tavl_softphone_settings') || '{}').extension; } catch { return undefined; }
        })(),
      });
      navigator.sendBeacon('/api/distribution/logout', new Blob([payload], { type: 'application/json' }));
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* Login - redirect to role-based home if already authenticated */}
        <Route
          path="/login"
          element={isAuthenticated ? <RoleBasedRedirect /> : <LoginScreen />}
        />
        
        {/* Root - redirect to role-based home */}
        <Route
          path="/"
          element={isAuthenticated ? <RoleBasedRedirect /> : <Navigate to="/login" replace />}
        />
        
        {/* Agent Dashboard - for agents/operators only */}
        <Route
          path="/agent"
          element={
            <ProtectedRoute allowedRoles={['operator', 'agent']}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        
        {/* Supervisor Dashboard - for supervisors/admins only */}
        <Route
          path="/supervisor"
          element={
            <ProtectedRoute allowedRoles={['supervisor', 'admin']}>
              <SupervisorDashboard />
            </ProtectedRoute>
          }
        />
        
        {/* Tracking Wall - NO AUTHENTICATION REQUIRED */}
        {/* Designed for video wall displays in command centers */}
        <Route
          path="/tracking-wall"
          element={<TrackingWall />}
        />
        
        {/* Analytics Wall - NO AUTHENTICATION REQUIRED */}
        {/* Real-time analytics dashboard for video wall displays */}
        <Route
          path="/analytics-wall"
          element={<AnalyticsWall />}
        />

        {/* PBX Admin - Separate authentication */}
        <Route path="/pbx-admin/*" element={<PbxAdminRoutes />} />
        
        {/* PBX Admin V2 - Modern Backend */}
        <Route path="/pbx-admin-v2/*" element={<PbxAdminV2Routes />} />
      </Routes>
    </BrowserRouter>
  );
}

// PBX Admin Routes - separate from main app auth
function PbxAdminRoutes() {
  const isAuthenticated = useAdminAuthStore((state) => state.isAuthenticated);

  return (
    <Routes>
      <Route
        path="/"
        element={isAuthenticated ? <Navigate to="/pbx-admin/dashboard" replace /> : <PbxAdminLogin />}
      />
      <Route
        path="/*"
        element={
          isAuthenticated ? (
            <PbxAdminShell>
              <Routes>
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="extensions" element={<ExtensionsPage />} />
                <Route path="trunks" element={<TrunksPage />} />
                <Route path="queues" element={<QueuesPage />} />
                <Route path="queue-monitor" element={<QueueMonitorPage />} />
                <Route path="ring-groups" element={<RingGroupsPage />} />
                <Route path="conferences" element={<ConferencesPage />} />
                <Route path="routing" element={<RoutingPage />} />
                <Route path="time-conditions" element={<TimeConditionsPage />} />
                <Route path="ivr" element={<IvrPage />} />
                <Route path="voicemail" element={<VoicemailPage />} />
                <Route path="fax" element={<FaxPage />} />
                <Route path="cdr" element={<CdrPage />} />
                <Route path="blacklist" element={<BlacklistPage />} />
                <Route path="moh" element={<MohPage />} />
                <Route path="sip-profiles" element={<SipProfilesPage />} />
                <Route path="scripts" element={<ScriptsPage />} />
                <Route path="backups" element={<BackupPage />} />
                <Route path="system" element={<SystemPage />} />
                <Route path="*" element={<Navigate to="/pbx-admin/dashboard" replace />} />
              </Routes>
            </PbxAdminShell>
          ) : (
            <Navigate to="/pbx-admin" replace />
          )
        }
      />
    </Routes>
  );
}

export default App;
