import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lock, User, LogIn, Loader2, CheckCircle, Eye, EyeOff, Shield,
  Radio, ShieldCheck, Satellite, Activity,
} from 'lucide-react';
import { useAuthStore } from '@store/authStore';
import { api, isElectron } from '@services/api';
import type { User as UserType } from '../../types/api';

const STATS = [
  { label: 'Vehicles Monitored', value: '100K+', icon: Radio },
  { label: 'Uptime SLA', value: '99.97%', icon: ShieldCheck },
  { label: 'Response Time', value: '<30s', icon: Activity },
  { label: 'Coverage', value: 'Nationwide', icon: Satellite },
];

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'user' | 'pass' | null>(null);
  const [time, setTime] = useState(new Date());

  const login = useAuthStore((state) => state.login);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const particles = useMemo(() =>
    Array.from({ length: 40 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 14,
      duration: 10 + Math.random() * 14,
      size: 1 + Math.random() * 2.5,
    })), []
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      setStatus('Connecting to fleet database...');

      let user: UserType;

      if (isElectron()) {
        const tavlConfig = await (window as any).electron.db.updateConfig({
          server: '192.168.20.253',
          database: 'tavl2',
          user: 'developer',
          password: 'tavldev123',
        });

        if (!tavlConfig.success) {
          setError('Failed to connect to fleet database. Please try again.');
          setLoading(false);
          return;
        }

        setStatus('Validating credentials...');

        const userValidation = await (window as any).electron.db.query(
          `SELECT [LoginId], [User], [Comment] 
           FROM [tavl2].[tavl].[Login] 
           WHERE [User] = @username`,
          { username }
        );

        if (!userValidation.success || !userValidation.data || userValidation.data.length === 0) {
          console.warn('User not found in TAVL Login table, proceeding with simple auth');
        }

        user = {
          id: userValidation.data?.[0]?.LoginId?.toString() || '0',
          username,
          name: userValidation.data?.[0]?.Comment || username,
          role: 'operator',
          groups: [],
          permissions: ['view_vehicles', 'view_reports', 'view_history', 'search'],
          loginIds: userValidation.data?.[0]?.LoginId ? [userValidation.data[0].LoginId] : [],
        };
      } else {
        setStatus('Validating credentials...');
        
        const result = await api.auth.login(username, password);
        
        if (!result.success) {
          setError(result.error || 'Login failed. Please check your credentials.');
          setLoading(false);
          return;
        }

        const userData = result.data as any;
        
        const isSupervisor = userData?.role === 'supervisor';
        const basePermissions: typeof user.permissions = ['view_vehicles', 'view_reports', 'view_history', 'search', 'acknowledge_alarms'];
        const supervisorPermissions: typeof user.permissions = [...basePermissions, 'view_agents', 'assign_alerts', 'view_metrics', 'manage_users'];
        
        user = {
          id: userData?.id?.toString() || '0',
          username: userData?.username || username,
          name: userData?.name || username,
          role: userData?.role || 'operator',
          groups: [],
          permissions: isSupervisor ? supervisorPermissions : basePermissions,
          loginIds: userData?.id ? [parseInt(userData.id)] : [],
        };
      }

      setStatus('Login successful!');
      await new Promise(resolve => setTimeout(resolve, 500));
      login(user, `session_${Date.now()}`);
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Login failed. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#06081a] flex">
      {/* ═══ Background layers (shared across both columns) ═══ */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#06081a] via-[#0c1033] to-[#0a0618]" />
      <div className="absolute inset-0 login-grid-bg" />
      <div className="absolute inset-0 login-noise pointer-events-none" />

      <div className="absolute inset-0 overflow-hidden">
        <div className="login-blob login-blob-1" />
        <div className="login-blob login-blob-2" />
        <div className="login-blob login-blob-3" />
        <div className="login-blob login-blob-4" />
      </div>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map(p => (
          <div
            key={p.id}
            className="login-particle"
            style={{
              left: `${p.left}%`,
              bottom: '-2%',
              width: p.size,
              height: p.size,
              animation: `float-particle ${p.duration}s ${p.delay}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>

      {/* ═══ LEFT COLUMN — Brand showcase ═══ */}
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 hidden lg:flex w-[55%] flex-col justify-between p-12 xl:p-16"
      >
        {/* Top — Logo + tagline */}
        <div>
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="flex items-center gap-4"
          >
            <motion.img
              src="/images/logot.png"
              alt="iTecknologi"
              className="h-14 w-auto drop-shadow-[0_0_30px_rgba(99,102,241,0.35)]"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="h-10 w-px bg-gradient-to-b from-transparent via-indigo-400/30 to-transparent" />
            <div>
              <h2 className="text-lg font-bold text-white/90 tracking-tight">iTecknologi</h2>
              <p className="text-[10px] uppercase tracking-[0.25em] text-indigo-300/50 font-medium">
                Intelligent Command Center
              </p>
            </div>
          </motion.div>
        </div>

        {/* Center — Hero */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.7 }}
          className="space-y-6 max-w-lg"
        >
          <h1 className="text-4xl xl:text-5xl font-bold leading-[1.15] tracking-tight">
            <span className="text-white/95">Fleet Security</span>
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
              Operations Center
            </span>
          </h1>
          <p className="text-base text-white/40 leading-relaxed max-w-md">
            24/7 real-time vehicle monitoring, alert management, and rapid response 
            coordination for nationwide fleet protection.
          </p>

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            {STATS.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.08, duration: 0.5 }}
                className="liquid-glass rounded-xl px-4 py-3 flex items-center gap-3"
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/15">
                  <stat.icon className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white/90">{stat.value}</div>
                  <div className="text-[10px] text-white/35 uppercase tracking-wider">{stat.label}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Bottom — Live clock + copyright */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="flex items-end justify-between"
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/60 font-medium">
                Systems Operational
              </span>
            </div>
            <p className="text-[11px] text-white/20">
              &copy; {new Date().getFullYear()} iTecknologi. All rights reserved.
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-light text-white/25 tabular-nums tracking-wider">
              {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </div>
            <div className="text-[10px] text-white/15 uppercase tracking-wider">
              {time.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* ═══ Vertical separator line ═══ */}
      <div className="relative z-10 hidden lg:flex items-center">
        <div className="w-px h-[70%] bg-gradient-to-b from-transparent via-white/8 to-transparent" />
      </div>

      {/* ═══ RIGHT COLUMN — Login form ═══ */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-6 lg:px-12">
        <div className="w-full max-w-[420px]">

          {/* Mobile-only logo (hidden on lg+) */}
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-center mb-8 lg:hidden"
          >
            <motion.img
              src="/images/logot.png"
              alt="iTecknologi"
              className="h-14 w-auto mx-auto drop-shadow-[0_0_25px_rgba(99,102,241,0.3)]"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            />
            <p className="text-[11px] uppercase tracking-[0.3em] text-indigo-300/50 font-medium mt-3">
              Command Center
            </p>
          </motion.div>

          {/* ── Liquid glass card ── */}
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.65, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="liquid-glass rounded-3xl p-8 lg:p-10"
          >
            {/* Card header */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/12 border border-indigo-500/20 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="h-5 w-px bg-white/8" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-medium">
                  Secure Access
                </span>
              </div>
              <h1 className="text-2xl font-bold text-white/95 tracking-tight">
                Sign in
              </h1>
              <p className="text-sm text-white/35 mt-1.5">
                Enter your credentials to access the operations center
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Username */}
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
              >
                <label className="block text-[11px] font-medium text-white/45 mb-2 uppercase tracking-wider">
                  Username
                </label>
                <div className="relative group">
                  <div className={`absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors duration-300 ${focused === 'user' ? 'text-indigo-400' : 'text-white/20'}`}>
                    <User className="w-[18px] h-[18px]" />
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={() => setFocused('user')}
                    onBlur={() => setFocused(null)}
                    className="liquid-input w-full pl-12 pr-4 py-3.5 rounded-xl text-white placeholder-white/15 text-sm"
                    placeholder="Enter your username"
                    required
                    disabled={loading}
                    autoFocus
                  />
                </div>
              </motion.div>

              {/* Password */}
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
              >
                <label className="block text-[11px] font-medium text-white/45 mb-2 uppercase tracking-wider">
                  Password
                </label>
                <div className="relative group">
                  <div className={`absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors duration-300 ${focused === 'pass' ? 'text-indigo-400' : 'text-white/20'}`}>
                    <Lock className="w-[18px] h-[18px]" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocused('pass')}
                    onBlur={() => setFocused(null)}
                    className="liquid-input w-full pl-12 pr-12 py-3.5 rounded-xl text-white placeholder-white/15 text-sm"
                    placeholder="Enter your password"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-white/20 hover:text-white/45 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                  </button>
                </div>
              </motion.div>

              {/* Status / Error */}
              <AnimatePresence mode="wait">
                {error && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, y: -8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -8, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-2">
                      <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  </motion.div>
                )}

                {status && !error && (
                  <motion.div
                    key="status"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 text-sm"
                  >
                    {status.includes('successful') ? (
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                    )}
                    <span className={status.includes('successful') ? 'text-emerald-300' : 'text-indigo-300/80'}>
                      {status}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Submit */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="pt-1"
              >
                <motion.button
                  type="submit"
                  disabled={loading}
                  className="liquid-button w-full py-3.5 rounded-xl font-semibold text-sm text-white
                             bg-gradient-to-r from-indigo-600/80 to-violet-600/80
                             hover:from-indigo-500/90 hover:to-violet-500/90
                             disabled:from-gray-700/50 disabled:to-gray-600/50 disabled:text-white/40
                             flex items-center justify-center gap-2
                             border border-indigo-400/20 hover:border-indigo-400/30
                             shadow-[0_4px_24px_rgba(99,102,241,0.25)] hover:shadow-[0_8px_32px_rgba(99,102,241,0.35)]"
                  whileHover={{ scale: loading ? 1 : 1.015 }}
                  whileTap={{ scale: loading ? 1 : 0.985 }}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      Sign In
                    </>
                  )}
                </motion.button>
              </motion.div>
            </form>

            {/* Version badge */}
            {!isElectron() && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="mt-6 flex items-center justify-center"
              >
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-medium uppercase tracking-wider text-indigo-300/40 bg-indigo-500/6 border border-indigo-400/8">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 animate-pulse" />
                  Web Platform v2.0
                </span>
              </motion.div>
            )}
          </motion.div>

          {/* Mobile-only footer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="mt-6 text-center lg:hidden"
          >
            <p className="text-[11px] text-white/15">
              &copy; {new Date().getFullYear()} iTecknologi. All rights reserved.
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
