/**
 * Supervisor Dashboard
 * Main dashboard for supervisors to monitor agents, manage alerts, and view metrics
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Bell,
  LogOut,
  RefreshCw,
  MessageSquare,
  Settings,
  BarChart3,
  Workflow,
  AlertTriangle,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  Activity,
  Search,
  Phone,
  PhoneCall,
} from 'lucide-react';
import { useAuthStore } from '@store/authStore';
import { useCallStore } from '@store/callStore';
import { useDistributionWebSocket } from '@hooks/useDistributionWebSocket';
import { useAlertDistributionStore } from '@store/alertDistributionStore';
import { StatsOverview } from './components/StatsOverview';
import { BroadcastModal } from './components/BroadcastModal';
import StolenVehicleManager from './components/StolenVehicleManager';
import AgentCallLogs from './components/AgentCallLogs';
import CDRDashboard from './components/CDRDashboard';
import LiveCallsPanel from './components/LiveCallsPanel';
import { SupervisorAlertDashboard, DistributionRulesManager, PerformanceReports, AlertTypeConfigManager, LiveDistributionMonitor, SupervisorVehicleLookup } from '@features/alerts';
import Softphone, { IncomingCallPopup } from '@features/softphone/Softphone';
import { ScreenPop } from '@features/softphone';
import Toaster from '@components/Toaster';

type TabKey = 'distribution' | 'live-monitor' | 'vehicle-lookup' | 'rules' | 'alert-config' | 'reports' | 'stolen' | 'cdr' | 'live-calls' | 'call-logs';

export default function SupervisorDashboard() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const { connected: wsConnected } = useDistributionWebSocket({
    agentId: user?.id || '',
    role: 'supervisor',
    enabled: !!user?.id,
  });

  const [activeTab, setActiveTab] = useState<TabKey>('distribution');
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const phoneRegistrationState = useCallStore((s) => s.registrationState);
  const phoneExtension = useCallStore((s) => s.extension);
  const loadAudioDevices = useCallStore((s) => s.loadAudioDevices);
  const initializeDefaults = useCallStore((s) => s.initializeDefaults);
  const register = useCallStore((s) => s.register);
  const phoneExtensionSaved = useCallStore((s) => s.extension);
  const phonePasswordSaved = useCallStore((s) => s.password);

  const stats = useAlertDistributionStore((s) => s.stats);
  const fetchSnapshot = useAlertDistributionStore((s) => s.fetchSnapshot);
  const fetchRules = useAlertDistributionStore((s) => s.fetchRules);

  useEffect(() => {
    loadAudioDevices();
    initializeDefaults().then(() => {
      if (phoneExtensionSaved && phonePasswordSaved) {
        register();
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user?.id) return;
    const dist = useAlertDistributionStore.getState();
    if (!dist.session) {
      const role = user.role === 'supervisor' || user.role === 'admin' ? 'supervisor' : 'agent';
      dist.login(user.id, user.name || user.username, role).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    const fetchAll = () => {
      fetchSnapshot();
      fetchRules();
    };
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchSnapshot, fetchRules]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchSnapshot();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  return (
    <div className="lg-page-bg w-full h-screen flex flex-col overflow-hidden">
      {/* Ambient blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="lg-page-blob" style={{ width: 500, height: 500, background: 'radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)', top: '-10%', right: '-5%' }} />
        <div className="lg-page-blob" style={{ width: 400, height: 400, background: 'radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)', bottom: '10%', left: '-5%', animationDelay: '10s' }} />
      </div>

      {/* Header */}
      <header className="lg-header flex-shrink-0 h-14 lg:h-16 px-4 xl:px-6 flex items-center justify-between relative z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logot.png" alt="iTecknologi" className="h-9 w-auto drop-shadow-[0_0_12px_rgba(139,92,246,0.2)]" />
            <div className="h-8 w-px bg-white/8" />
            <div>
              <h1 className="text-lg font-bold text-white/90 leading-none">Supervisor Dashboard</h1>
              <p className="text-[10px] text-violet-300/40 uppercase tracking-wider">Fleet Command Center</p>
            </div>
          </div>
        </div>

        {/* Center — live counters */}
        <div className="flex items-center gap-2 xl:gap-4">
          <div className="lg-chip flex items-center gap-2 px-2.5 xl:px-3 py-1.5 rounded-xl border-emerald-500/15 bg-emerald-500/8" title="Online agents">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />
            <span className="text-sm font-medium text-emerald-400">{stats?.online_agents ?? 0}</span>
            <span className="hidden 2xl:inline text-xs text-white/25">Online</span>
          </div>
          <div className="lg-chip flex items-center gap-2 px-2.5 xl:px-3 py-1.5 rounded-xl border-amber-500/15 bg-amber-500/8" title="Pending alerts">
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-sm font-medium text-amber-400">{stats?.pending_alerts ?? 0}</span>
            <span className="hidden 2xl:inline text-xs text-white/25">Pending</span>
          </div>
          <div className="lg-chip flex items-center gap-2 px-2.5 xl:px-3 py-1.5 rounded-xl border-red-500/15 bg-red-500/8" title="Escalated alerts">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-sm font-medium text-red-400">{stats?.escalated_alerts ?? 0}</span>
            <span className="hidden 2xl:inline text-xs text-white/25">Escalated</span>
          </div>
        </div>

        {/* Right — actions */}
        <div className="flex items-center gap-2 xl:gap-3">
          <div
            className={`flex items-center gap-1.5 px-2 xl:px-2.5 py-1.5 rounded-xl text-xs font-medium ${
              phoneRegistrationState === 'registered'
                ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                : 'bg-white/5 text-white/30 border border-white/10'
            }`}
            title={phoneRegistrationState === 'registered' ? `Phone registered: Ext ${phoneExtension}` : 'Phone not registered — open softphone to configure'}
          >
            <Phone className="w-3.5 h-3.5" />
            <span className="hidden 2xl:inline">
              {phoneRegistrationState === 'registered' ? `Ext ${phoneExtension}` : 'Phone'}
            </span>
          </div>

          <div
            className={`flex items-center gap-1.5 px-2 xl:px-2.5 py-1.5 rounded-xl text-xs font-medium ${
              wsConnected
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}
            title={wsConnected ? 'Real-time connection active' : 'Reconnecting... using polling fallback'}
          >
            {wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5 animate-pulse" />}
            <span className="hidden 2xl:inline">{wsConnected ? 'Live' : 'Polling'}</span>
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="lg-icon-btn p-2 rounded-xl text-white/30 hover:text-white/70 disabled:opacity-50"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setShowBroadcast(true)}
            className="liquid-button flex items-center gap-1.5 xl:gap-2 px-2.5 xl:px-3 py-2 bg-violet-500/15 hover:bg-violet-500/25 text-violet-400 rounded-xl border border-violet-500/20 hover:border-violet-500/30 transition-all"
            title="Broadcast message"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden 2xl:inline text-sm font-medium">Broadcast</span>
          </button>

          <div className="h-8 w-px bg-white/6" />

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium text-white/80">{user?.name || 'Supervisor'}</div>
              <div className="text-[10px] text-violet-400/60 flex items-center justify-end gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                Supervisor
              </div>
            </div>
            <button
              onClick={logout}
              className="lg-icon-btn p-2 rounded-xl text-white/30 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/10 transition-all"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="relative z-10">
        <StatsOverview />
      </div>

      {/* Tab Navigation */}
      <div className="lg-tab-bar flex-shrink-0 px-4 xl:px-6 py-2 xl:py-3 relative z-10">
        <div className="relative">
          <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabButton
            active={activeTab === 'distribution'}
            onClick={() => setActiveTab('distribution')}
            icon={<Workflow className="w-4 h-4" />}
            label="Distribution"
            count={stats?.escalated_alerts || 0}
            highlight={(stats?.escalated_alerts ?? 0) > 0}
          />
          <TabButton
            active={activeTab === 'live-monitor'}
            onClick={() => setActiveTab('live-monitor')}
            icon={<Activity className="w-4 h-4" />}
            label="Live Monitor"
          />
          <TabButton
            active={activeTab === 'vehicle-lookup'}
            onClick={() => setActiveTab('vehicle-lookup')}
            icon={<Search className="w-4 h-4" />}
            label="Vehicle Lookup"
          />
          <TabButton
            active={activeTab === 'rules'}
            onClick={() => setActiveTab('rules')}
            icon={<Settings className="w-4 h-4" />}
            label="Rules"
          />
          <TabButton
            active={activeTab === 'alert-config'}
            onClick={() => setActiveTab('alert-config')}
            icon={<SlidersHorizontal className="w-4 h-4" />}
            label="Alert Types"
          />
          <TabButton
            active={activeTab === 'reports'}
            onClick={() => setActiveTab('reports')}
            icon={<BarChart3 className="w-4 h-4" />}
            label="Reports"
          />
          <TabButton
            active={activeTab === 'cdr'}
            onClick={() => setActiveTab('cdr')}
            icon={<Phone className="w-4 h-4" />}
            label="Call Records"
          />
          <TabButton
            active={activeTab === 'live-calls'}
            onClick={() => setActiveTab('live-calls')}
            icon={<PhoneCall className="w-4 h-4" />}
            label="Live Calls"
            count={0}
          />
          <TabButton
            active={activeTab === 'call-logs'}
            onClick={() => setActiveTab('call-logs')}
            icon={<PhoneOff className="w-4 h-4" />}
            label="Call Logs"
          />
          <TabButton
            active={activeTab === 'stolen'}
            onClick={() => setActiveTab('stolen')}
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Stolen Tracking"
          />
          </div>
          {/* Right-edge fade — hints that more tabs are scrollable */}
          <div className="absolute right-0 top-0 bottom-0 w-10 pointer-events-none bg-gradient-to-l from-[#06081a] to-transparent" />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative z-10">
        <AnimatePresence mode="wait">
          {activeTab === 'distribution' && (
            <motion.div key="distribution" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full overflow-hidden px-4 xl:px-6 py-3 xl:py-4">
              <SupervisorAlertDashboard onSwitchTab={(tab) => setActiveTab(tab as TabKey)} />
            </motion.div>
          )}

          {activeTab === 'live-monitor' && (
            <motion.div key="live-monitor" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full overflow-hidden px-4 xl:px-6 py-3 xl:py-4">
              <LiveDistributionMonitor />
            </motion.div>
          )}

          {activeTab === 'vehicle-lookup' && (
            <motion.div key="vehicle-lookup" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full overflow-hidden px-4 xl:px-6 py-3 xl:py-4">
              <SupervisorVehicleLookup />
            </motion.div>
          )}

          {activeTab === 'rules' && (
            <motion.div key="rules" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full overflow-y-auto p-4 xl:p-6">
              <div className="max-w-4xl mx-auto"><DistributionRulesManager /></div>
            </motion.div>
          )}

          {activeTab === 'alert-config' && (
            <motion.div key="alert-config" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full overflow-y-auto p-4 xl:p-6">
              <div className="max-w-4xl mx-auto"><AlertTypeConfigManager /></div>
            </motion.div>
          )}

          {activeTab === 'reports' && (
            <motion.div key="reports" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full overflow-y-auto p-4 xl:p-6">
              <div className="max-w-4xl mx-auto"><PerformanceReports /></div>
            </motion.div>
          )}

          {activeTab === 'cdr' && (
            <motion.div key="cdr" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full overflow-hidden px-4 xl:px-6 py-3 xl:py-4">
              <CDRDashboard />
            </motion.div>
          )}

          {activeTab === 'live-calls' && (
            <motion.div key="live-calls" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full overflow-hidden px-4 xl:px-6 py-3 xl:py-4">
              <LiveCallsPanel />
            </motion.div>
          )}

          {activeTab === 'call-logs' && (
            <motion.div key="call-logs" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full overflow-y-auto px-4 xl:px-6 py-3 xl:py-4">
              <AgentCallLogs />
            </motion.div>
          )}

          {activeTab === 'stolen' && (
            <motion.div key="stolen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full overflow-y-auto p-4 xl:p-6">
              <div className="max-w-5xl mx-auto"><StolenVehicleManager /></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
      </AnimatePresence>

      <Softphone />
      <IncomingCallPopup />
      <ScreenPop />
      <Toaster />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
  highlight,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`lg-tab flex items-center gap-2 px-4 py-2 rounded-xl whitespace-nowrap ${
        active ? 'lg-tab-active text-violet-300' : 'text-white/35 hover:text-white/60'
      }`}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={`px-1.5 py-0.5 text-xs rounded-full ${
          highlight
            ? 'bg-red-500/80 text-white animate-pulse shadow-sm shadow-red-500/30'
            : active
              ? 'bg-violet-500/25 text-violet-300'
              : 'bg-white/8 text-white/30'
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}
