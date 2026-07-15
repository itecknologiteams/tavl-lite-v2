import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LogOut,
  Search,
  Phone,
  Inbox,
} from 'lucide-react';
import MapContainer from './components/MapContainer';
import VehicleDetailPanel from './components/VehicleDetailPanel';
import TrackHistoryDialog from './components/TrackHistoryDialog';
import TrackPlaybackControls from './components/TrackPlaybackControls';
import TripTimeline from './components/TripTimeline';
import VehicleSearch from './components/VehicleSearch';
import Softphone, { IncomingCallPopup } from '@features/softphone/Softphone';
import { ScreenPop } from '@features/softphone';
import { AgentInbox } from '@features/alerts';
import { useAlarms } from '@hooks/useAlarms';
import { usePinnedVehicleRefresh } from '@hooks/usePinnedVehicleRefresh';
import { useDistributionWebSocket } from '@hooks/useDistributionWebSocket';
import { useVehicleStore } from '@store/vehicleStore';
import { useAuthStore } from '@store/authStore';
import { useCallStore } from '@store/callStore';
import { useAlertDistributionStore } from '@store/alertDistributionStore';

export default function Dashboard() {
  const [alertsOpen, setAlertsOpen] = useState(false);
  
  const vehicles = useVehicleStore((state) => state.vehicles);
  const selectedVehicle = useVehicleStore((state) => state.selectedVehicle);
  
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  
  const { unacknowledgedAlerts, session: distributionSession, login: distributionLogin } = useAlertDistributionStore();
  
  const phoneExtension = useCallStore((state) => state.extension);
  useDistributionWebSocket({
    agentId: user?.id || '',
    role: 'agent',
    enabled: !!user?.id,
    extension: phoneExtension,
  });
  
  useEffect(() => {
    if (user?.id && !distributionSession) {
      const role = user.role === 'supervisor' || user.role === 'admin' ? 'supervisor' : 'agent';
      distributionLogin(user.id, user.name || user.username, role);
    }
  }, [user, distributionSession, distributionLogin]);
  
  const phoneRegistrationState = useCallStore((state) => state.registrationState);
  const phoneCallMode = useCallStore((state) => state.callMode);
  const loadAudioDevices = useCallStore((state) => state.loadAudioDevices);
  const initializeDefaults = useCallStore((state) => state.initializeDefaults);
  const register = useCallStore((state) => state.register);
  const phoneExtensionSaved = useCallStore((state) => state.extension);
  const phonePasswordSaved = useCallStore((state) => state.password);

  useAlarms();
  usePinnedVehicleRefresh();

  useEffect(() => {
    loadAudioDevices();
    initializeDefaults().then(() => {
      // Auto-reconnect if credentials were saved from a previous session.
      // register() handles both modes: SIP handshake for WebRTC, checkAmiStatus for AMI.
      if (phoneExtensionSaved && phonePasswordSaved) {
        register();
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusCounts = useMemo(() => {
    const counts = { total: 0, moving: 0, idle: 0, parked: 0, offline: 0, gpsInvalid: 0 };
    vehicles.forEach((v) => {
      counts.total++;
      if (v.status === 'moving') counts.moving++;
      else if (v.status === 'idle') counts.idle++;
      else if (v.status === 'parked') counts.parked++;
      else if (v.status === 'offline') counts.offline++;
      else if (v.status === 'gps-invalid') counts.gpsInvalid++;
    });
    return counts;
  }, [vehicles]);

  return (
    <div className="lg-page-bg w-full h-screen flex flex-col overflow-hidden">
      {/* Ambient blobs — very subtle behind content */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="lg-page-blob" style={{ width: 500, height: 500, background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)', top: '-10%', left: '-5%' }} />
        <div className="lg-page-blob" style={{ width: 400, height: 400, background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)', bottom: '-5%', right: '-5%', animationDelay: '8s' }} />
      </div>

      {/* Header */}
      <header className="lg-header flex-shrink-0 h-16 px-4 flex items-center justify-between relative z-header">
        {/* Left — Logo */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logot.png" alt="iTecknologi" className="h-9 w-auto drop-shadow-[0_0_12px_rgba(99,102,241,0.2)]" />
            <div className="h-8 w-px bg-white/8" />
            <div>
              <h1 className="text-lg font-bold text-white/90 leading-none">Command Center</h1>
              <p className="text-[10px] text-indigo-300/60 uppercase tracking-wider">Fleet Monitoring</p>
            </div>
          </div>
        </div>

        {/* Center — Search */}
        <div className="flex-1 flex justify-center px-8">
          <VehicleSearch />
        </div>

        {/* Right — Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAlertsOpen(!alertsOpen)}
            className={`relative lg-icon-btn p-2.5 rounded-xl transition-all ${
              alertsOpen ? 'bg-indigo-500/15 border-indigo-500/25 text-indigo-400' : 'text-white/40 hover:text-white/70'
            }`}
            title="My Alerts"
          >
            <Inbox className="w-5 h-5" />
            {unacknowledgedAlerts.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold flex items-center justify-center text-white animate-pulse shadow-lg shadow-red-500/30">
                {unacknowledgedAlerts.length > 9 ? '9+' : unacknowledgedAlerts.length}
              </span>
            )}
          </button>
          
          <div className="h-8 w-px bg-white/6" />
          
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium text-white/80">{user?.name || 'Agent'}</div>
              <div className="text-[10px] text-emerald-400/85 flex items-center justify-end gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Online
              </div>
            </div>
            <button
              onClick={logout}
              className="lg-icon-btn p-2.5 rounded-xl text-white/30 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/10 transition-all"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Map */}
        <div className="flex-1 relative">
          <MapContainer />
          
          {/* Trip Timeline Overlay (left side) */}
          <TripTimeline />

          {/* Vehicle Detail Overlay */}
          <AnimatePresence>
            {selectedVehicle && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute top-4 right-4 z-map-panel w-[94vw] min-w-[300px] max-w-[400px] sm:w-[320px] md:w-[340px] lg:w-[340px] xl:w-[380px] 2xl:w-[420px] 3xl:w-[440px]"
              >
                <VehicleDetailPanel />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Empty State */}
          {vehicles.size === 0 && !selectedVehicle && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center p-8 lg-empty-state rounded-2xl max-w-md"
              >
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Search className="w-8 h-8 text-indigo-400/60" />
                </div>
                <h2 className="text-xl font-semibold text-white/80 mb-2">
                  Search for a Vehicle
                </h2>
                <p className="text-white/50 text-sm mb-4">
                  Use the search bar above to find vehicles by plate number, IMEI, or description.
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-white/40">
                  <kbd className="px-2 py-1 lg-chip rounded text-white/40">Ctrl</kbd>
                  <span>+</span>
                  <kbd className="px-2 py-1 lg-chip rounded text-white/40">K</kbd>
                  <span className="ml-2">to focus search</span>
                </div>
              </motion.div>
            </div>
          )}
        </div>

        {/* Alerts Sidebar */}
        <AnimatePresence>
          {alertsOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'min(400px, 28vw)', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="h-full overflow-hidden lg-sidebar flex flex-col"
            >
              <div className="flex-1 overflow-y-auto min-h-0">
                <AgentInbox />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Track Playback Bar — sits in flex flow above footer */}
      <TrackPlaybackControls />

      {/* Footer Status Bar */}
      <footer className="lg-footer flex-shrink-0 h-8 px-4 flex items-center justify-between text-xs relative z-10">
        <div className="flex items-center gap-4 text-white/40">
          {statusCounts.total > 0 && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                <span className="text-emerald-400/70 font-medium">{statusCounts.moving}</span> moving
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" />
                <span className="text-amber-400/70 font-medium">{statusCounts.idle}</span> idle
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-500" />
                <span className="text-white/50 font-medium">{statusCounts.offline}</span> offline
              </span>
            </>
          )}
          {statusCounts.total === 0 && (
            <span>Search for vehicles to view their status</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-white/40">
          <span className="flex items-center gap-1.5">
            <Phone className={`w-3 h-3 ${
              (phoneCallMode === 'ami' ? !!phoneExtension : phoneRegistrationState === 'registered')
                ? 'text-emerald-400/80'
                : phoneRegistrationState === 'registering'
                  ? 'text-amber-400/80'
                  : 'text-white/40'
            }`} />
            <span className={
              (phoneCallMode === 'ami' ? !!phoneExtension : phoneRegistrationState === 'registered')
                ? 'text-emerald-400/80'
                : phoneRegistrationState === 'registering'
                  ? 'text-amber-400/80'
                  : 'text-white/40'
            }>
              {phoneCallMode === 'ami' 
                ? (phoneExtension ? `Click2Call Ext:${phoneExtension}` : 'Configure phone')
                : phoneRegistrationState === 'registered'
                  ? `WebRTC ${phoneExtension || ''}`
                  : phoneRegistrationState === 'registering' 
                    ? 'Connecting...' 
                    : 'Phone offline'}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />
            System Online
          </span>
          <span className="text-white/15">© 2026 iTecknologi</span>
        </div>
      </footer>
      
      <TrackHistoryDialog />
      <Softphone railDocked />
      <IncomingCallPopup />
      <ScreenPop />
    </div>
  );
}
