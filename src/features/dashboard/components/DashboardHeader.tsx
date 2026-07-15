import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  LogOut,
  Settings,
  Bell,
  User,
  Menu,
  AlertTriangle,
} from 'lucide-react';
import { useAuthStore } from '@store/authStore';
import { useAlarmStore } from '@store/alarmStore';

interface Props {
  onMenuClick: () => void;
  onAlarmClick: () => void;
}

export default function DashboardHeader({ onMenuClick, onAlarmClick }: Props) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const unacknowledgedCount = useAlarmStore((state) => state.unacknowledgedCount);
  const [showUserMenu, setShowUserMenu] = useState(false);

  return (
    <header className="lg-header px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="lg-icon-btn p-2 rounded-xl hover:text-white/70 text-white/40 transition-all"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <img src="/images/logot.png" alt="iTecknologi" className="h-9 w-auto drop-shadow-[0_0_12px_rgba(99,102,241,0.2)]" />
            <div className="h-8 w-px bg-white/8" />
            <div>
              <h1 className="text-lg font-bold text-white/90 leading-tight">Command Center</h1>
              <p className="text-[10px] text-indigo-300/40 uppercase tracking-wider">Real-time Fleet Monitoring</p>
            </div>
          </div>
        </div>

        {/* Center */}
        <div className="flex-1 max-w-xl mx-8" />

        {/* Right Section */}
        <div className="flex items-center gap-3">
          <button
            onClick={onAlarmClick}
            className="relative lg-icon-btn p-3 rounded-xl text-white/40 hover:text-red-400 hover:border-red-500/20 transition-all"
          >
            <AlertTriangle className="w-5 h-5" />
            {unacknowledgedCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold pulse-alarm shadow-sm shadow-red-500/30"
              >
                {unacknowledgedCount > 99 ? '99+' : unacknowledgedCount}
              </motion.span>
            )}
          </button>

          <button className="lg-icon-btn p-3 rounded-xl text-white/40 hover:text-white/70 transition-all">
            <Bell className="w-5 h-5" />
          </button>

          <button className="lg-icon-btn p-3 rounded-xl text-white/40 hover:text-white/70 transition-all">
            <Settings className="w-5 h-5" />
          </button>

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 lg-icon-btn px-4 py-2 rounded-xl text-white/60 hover:text-white/80 transition-all"
            >
              <User className="w-5 h-5" />
              <span className="font-medium text-sm">{user?.name}</span>
            </button>

            {showUserMenu && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute right-0 mt-2 w-48 liquid-glass rounded-xl shadow-2xl overflow-hidden z-50"
              >
                <button
                  onClick={() => {
                    logout();
                    setShowUserMenu(false);
                  }}
                  className="w-full px-4 py-3 flex items-center gap-2 hover:bg-white/5 text-white/60 hover:text-red-400 transition-colors text-sm"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Logout</span>
                </button>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
