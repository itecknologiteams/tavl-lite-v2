import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { subscribeToWs } from '@services/api';

interface F5AlertData {
  extension: string;
  crmUsername: string;
  timestamp: string;
  key: string;
}

// Generate alert beep using Web Audio API — plays once, no file needed
function playAlertBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    [0, 0.15, 0.3].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.12);
    });
    // Clean up audio context after 1 second
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {}
}

export default function F5AlertPopup() {
  const [alerts, setAlerts] = useState<Array<F5AlertData & { id: number }>>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  useEffect(() => {
    const unsub = subscribeToWs('supervisorF5Alert', (data: F5AlertData) => {
      const id = ++counterRef.current;
      playAlertBeep();
      setAlerts(prev => [{ ...data, id }, ...prev]);
      // Auto-dismiss after 10-12 seconds
      const delay = 10000 + Math.floor(Math.random() * 2000);
      setTimeout(() => dismiss(id), delay);
    });
    return () => { unsub(); };
  }, [dismiss]);

  if (alerts.length === 0) return null;

  return (
    <AnimatePresence>
      {alerts.map((alert, idx) => (
        <motion.div
          key={alert.id}
          initial={{ opacity: 0, y: -80, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -40, scale: 0.9 }}
          transition={{ duration: 0.3 }}
          className="fixed z-[9999] inset-x-0 flex justify-center pointer-events-none"
          style={{ top: `${20 + idx * 110}px` }}
        >
          <div className="pointer-events-auto bg-gradient-to-r from-red-900/95 to-red-950/95 border-2 border-red-500/60 rounded-2xl px-8 py-5 shadow-2xl shadow-red-500/20 max-w-lg w-full mx-4 backdrop-blur-xl">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 mt-0.5">
                <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-red-400 animate-pulse" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-black text-red-300 tracking-wide">
                  AGENT REFRESH DETECTED
                </h1>
                <p className="text-sm text-white/90 mt-1 font-semibold">
                  Ext {alert.extension} · {alert.crmUsername || 'Unknown'}
                </p>
                <p className="text-xs text-red-300/70 mt-1">
                  Pressed {alert.key} during an active call at {new Date(alert.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </p>
              </div>
              <button
                onClick={() => dismiss(alert.id)}
                className="flex-shrink-0 w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-red-300" />
              </button>
            </div>
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
