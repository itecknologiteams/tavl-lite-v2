import React, { useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAdminAuthStore } from './stores/adminAuthStore';
import { useConfigStore } from './stores/configStore';
import {
  Users,
  Network,
  Settings,
  LogOut,
  ChevronRight,
  Save,
  X,
  CheckCircle,
  AlertTriangle,
  Server,
  Menu,
  LayoutDashboard,
  Headphones,
  ArrowUpDown,
  Grid3X3,
  Music,
  Database,
  FileText,
  ShieldBan,
  Activity,
  Radio,
  Video,
  Clock,
  Code,
  Voicemail,
  Printer,
} from 'lucide-react';

export function PbxAdminShell({ children }: { children?: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, isAuthenticated } = useAdminAuthStore();
  const { pendingChanges, isApplying, lastError, clearChanges, setApplying, setError, getChangeCount } = useConfigStore();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [showSuccess, setShowSuccess] = React.useState(false);

  // Protect routes
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/pbx-admin');
    }
  }, [isAuthenticated, navigate]);

  const handleLogout = () => {
    logout();
    navigate('/pbx-admin');
  };

  const handleApplyChanges = async () => {
    if (pendingChanges.length === 0) return;
    setApplying(true);
    setError(null);

    try {
      const response = await fetch('/api/pbx-admin/system/reload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useAdminAuthStore.getState().token}`,
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      if (data.success) {
        clearChanges();
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 3000);
      } else {
        setError(data.error || 'Failed to reload FreeSWITCH');
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed');
    } finally {
      setApplying(false);
    }
  };

  const changeCount = getChangeCount();

  const navItems = [
    { path: '/pbx-admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/pbx-admin/extensions', label: 'Extensions', icon: Users },
    { path: '/pbx-admin/trunks', label: 'Trunks', icon: Network },
    { path: '/pbx-admin/queues', label: 'Queues', icon: Headphones },
    { path: '/pbx-admin/queue-monitor', label: 'Queue Monitor', icon: Activity },
    { path: '/pbx-admin/ring-groups', label: 'Ring Groups', icon: Users },
    { path: '/pbx-admin/conferences', label: 'Conferences', icon: Video },
    { path: '/pbx-admin/routing', label: 'Routing', icon: ArrowUpDown },
    { path: '/pbx-admin/time-conditions', label: 'Time Conditions', icon: Clock },
    { path: '/pbx-admin/ivr', label: 'IVR', icon: Grid3X3 },
    { path: '/pbx-admin/voicemail', label: 'Voicemail', icon: Voicemail },
    { path: '/pbx-admin/fax', label: 'Fax', icon: Printer },
    { path: '/pbx-admin/cdr', label: 'CDR / Reports', icon: FileText },
    { path: '/pbx-admin/blacklist', label: 'Blacklist', icon: ShieldBan },
    { path: '/pbx-admin/moh', label: 'Music & Audio', icon: Music },
    { path: '/pbx-admin/sip-profiles', label: 'SIP Profiles', icon: Radio },
    { path: '/pbx-admin/scripts', label: 'Scripts', icon: Code },
    { path: '/pbx-admin/backups', label: 'Backup', icon: Database },
    { path: '/pbx-admin/system', label: 'System', icon: Settings },
  ];

  return (
    <div className="h-screen bg-slate-900 flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-full bg-slate-800 border-r border-slate-700/50 transition-all duration-300 z-20 ${
          isSidebarOpen ? 'w-64' : 'w-16'
        }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
              <Server className="w-4 h-4 text-white" />
            </div>
            {isSidebarOpen && (
              <div>
                <span className="text-white font-semibold text-sm">PBX Admin</span>
                <p className="text-slate-500 text-xs">FreeSWITCH</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
                title={!isSidebarOpen ? item.label : undefined}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {isSidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Toggle Sidebar Button */}
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute bottom-4 right-4 p-2 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white transition-all"
        >
          <Menu className="w-4 h-4" />
        </button>
      </aside>

      {/* Main Content */}
      <main
        className={`flex-1 flex flex-col transition-all duration-300 min-h-0 ${
          isSidebarOpen ? 'ml-64' : 'ml-16'
        }`}
      >
        {/* Header */}
        <header className="h-16 flex-shrink-0 bg-slate-800/50 backdrop-blur-xl border-b border-slate-700/50 flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>PBX Admin</span>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white">
              {navItems.find((n) => n.path === location.pathname)?.label || 'Dashboard'}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm text-white font-medium">{user.username}</p>
                  <p className="text-xs text-emerald-400">Administrator</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-lg bg-slate-700/50 text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Logout"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>

        {/* Pending Changes Bar */}
        {changeCount > 0 && (
          <div className="sticky bottom-0 left-0 right-0 bg-slate-800/95 backdrop-blur-xl border-t border-amber-500/30 p-4 z-30">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    {changeCount} pending {changeCount === 1 ? 'change' : 'changes'}
                  </p>
                  <p className="text-xs text-slate-400">
                    Changes will not take effect until applied
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {lastError && (
                  <span className="text-sm text-red-400 mr-2">{lastError}</span>
                )}
                <button
                  onClick={clearChanges}
                  disabled={isApplying}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  <X className="w-4 h-4" />
                  Discard
                </button>
                <button
                  onClick={handleApplyChanges}
                  disabled={isApplying}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50 flex items-center gap-2"
                >
                  {isApplying ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Applying...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Apply & Reload</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Success Notification */}
        {showSuccess && (
          <div className="fixed bottom-20 right-6 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3 animate-fade-in">
            <CheckCircle className="w-5 h-5 text-emerald-400" />
            <span className="text-sm text-emerald-400">Changes applied successfully</span>
          </div>
        )}
      </main>
    </div>
  );
}
