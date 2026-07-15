import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAdminAuthStore } from '@features/pbx-admin';
import { useMutation } from '@tanstack/react-query';
import { reloadSystem, extractError } from './api';
import {
  LayoutDashboard, Users, Network, Headphones, Activity, Users2,
  PhoneForwarded, Clock, Voicemail, Video, FileText, Music, BarChart2,
  ArrowUpDown, ShieldOff, Sliders, Code, Archive, Settings,
  ChevronRight, LogOut, Menu, Server, RefreshCcw, Loader2,
  CheckCircle, XCircle,
} from 'lucide-react';

interface ToastItem {
  id: string;
  type: 'success' | 'error';
  message: string;
}

const navSections = [
  {
    label: 'Core',
    items: [
      { path: '/pbx-admin-v2/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { path: '/pbx-admin-v2/extensions', label: 'Extensions', icon: Users },
      { path: '/pbx-admin-v2/trunks', label: 'Trunks', icon: Network },
    ],
  },
  {
    label: 'Call Handling',
    items: [
      { path: '/pbx-admin-v2/queues', label: 'Queues', icon: Headphones },
      { path: '/pbx-admin-v2/queue-monitor', label: 'Queue Monitor', icon: Activity },
      { path: '/pbx-admin-v2/ring-groups', label: 'Ring Groups', icon: Users2 },
      { path: '/pbx-admin-v2/ivr', label: 'IVR / Auto-Attendant', icon: PhoneForwarded },
      { path: '/pbx-admin-v2/time-conditions', label: 'Time Conditions', icon: Clock },
    ],
  },
  {
    label: 'Communication',
    items: [
      { path: '/pbx-admin-v2/voicemail', label: 'Voicemail', icon: Voicemail },
      { path: '/pbx-admin-v2/conferences', label: 'Conferences', icon: Video },
      { path: '/pbx-admin-v2/fax', label: 'Fax', icon: FileText },
    ],
  },
  {
    label: 'Media',
    items: [
      { path: '/pbx-admin-v2/moh', label: 'Music on Hold', icon: Music },
    ],
  },
  {
    label: 'Reports',
    items: [
      { path: '/pbx-admin-v2/cdr', label: 'Call History', icon: BarChart2 },
    ],
  },
  {
    label: 'Admin',
    items: [
      { path: '/pbx-admin-v2/routing', label: 'Routing', icon: ArrowUpDown },
      { path: '/pbx-admin-v2/blacklist', label: 'Blacklist', icon: ShieldOff },
      { path: '/pbx-admin-v2/sip-profiles', label: 'SIP Profiles', icon: Sliders },
      { path: '/pbx-admin-v2/scripts', label: 'Scripts', icon: Code },
      { path: '/pbx-admin-v2/backups', label: 'Backups', icon: Archive },
      { path: '/pbx-admin-v2/system', label: 'System', icon: Settings },
    ],
  },
];

const allNavItems = navSections.flatMap((s) => s.items);

export function PbxAdminShellV2({ children }: { children?: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, isAuthenticated } = useAdminAuthStore();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = (type: 'success' | 'error', message: string) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      type === 'success' ? 3000 : 5000,
    );
  };

  const reloadMut = useMutation({
    mutationFn: reloadSystem,
    onSuccess: (data) => {
      addToast('success', data.message || 'Configuration applied successfully');
    },
    onError: (err) => {
      addToast('error', extractError(err));
    },
  });

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/pbx-admin-v2');
    }
  }, [isAuthenticated, navigate]);

  const handleLogout = () => {
    logout();
    navigate('/pbx-admin-v2');
  };

  const currentPageLabel =
    allNavItems.find((n) => location.pathname.startsWith(n.path))?.label || 'Dashboard';

  return (
    <div className="h-screen bg-slate-950 flex overflow-hidden font-sans lg-page-bg">
      <div className="lg-page-blob" />

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-full lg-sidebar transition-all duration-300 z-20 flex flex-col ${
          isSidebarOpen ? 'w-64' : 'w-16'
        }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-slate-700/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 glow-primary">
              <Server className="w-4 h-4 text-white" />
            </div>
            {isSidebarOpen && (
              <div>
                <span className="text-white font-semibold text-sm tracking-wide">PBX Admin V2</span>
                <p className="text-indigo-400 text-xs font-medium">FreeSWITCH</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto hide-scrollbar py-3 px-2 space-y-0.5">
          {navSections.map((section) => (
            <div key={section.label}>
              {isSidebarOpen && (
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500 px-3 pt-4 pb-1.5">
                  {section.label}
                </p>
              )}
              {!isSidebarOpen && <div className="mt-3 mb-1 mx-2 h-px bg-slate-700/40" />}
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname.startsWith(item.path);
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    title={!isSidebarOpen ? item.label : undefined}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                      isActive
                        ? 'lg-tab-active text-indigo-300'
                        : 'lg-tab text-slate-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {isSidebarOpen && (
                      <span className="text-sm font-medium tracking-wide truncate">{item.label}</span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Collapse Toggle */}
        <div className="p-2 border-t border-slate-700/50 flex-shrink-0">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="w-full flex items-center justify-center p-2 rounded-lg lg-icon-btn text-slate-400 hover:text-white transition-all"
            title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`flex-1 flex flex-col transition-all duration-300 min-h-0 relative z-10 ${
          isSidebarOpen ? 'ml-64' : 'ml-16'
        }`}
      >
        {/* Header */}
        <header className="h-16 flex-shrink-0 lg-header flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400 font-medium">PBX Admin V2</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
            <span className="text-white font-semibold">{currentPageLabel}</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => reloadMut.mutate()}
              disabled={reloadMut.isPending}
              className="glass-button px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-60 transition-all"
              title="Reload FreeSWITCH configuration — applies all pending changes"
            >
              {reloadMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCcw className="w-4 h-4" />
              )}
              Apply Config
            </button>

            {user && (
              <div className="flex items-center gap-3 pl-4 border-l border-slate-700/50">
                <div className="text-right hidden sm:block">
                  <p className="text-sm text-white font-semibold leading-tight">{user.username}</p>
                  <p className="text-xs text-indigo-400 font-medium">System Admin</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-lg lg-icon-btn text-slate-400 hover:text-red-400"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6 md:p-8 hide-scrollbar">
          <div className="max-w-7xl mx-auto">{children}</div>
        </div>
      </main>

      {/* Toast Notifications */}
      <div className="fixed bottom-6 right-6 z-50 space-y-3 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-xl border animate-fade-in shadow-lg pointer-events-auto max-w-sm ${
              toast.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
