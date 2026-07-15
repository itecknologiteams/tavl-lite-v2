/**
 * KPI Card Component
 * Displays a single key performance indicator
 */

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface KPICardProps {
  title: string;
  value: number | string;
  icon: ReactNode;
  color: 'blue' | 'purple' | 'red' | 'amber' | 'emerald' | 'rose';
  subtitle?: string;
  pulse?: boolean;
}

const colorClasses = {
  blue: {
    bg: 'bg-blue-500/20',
    border: 'border-blue-500/30',
    icon: 'text-blue-400',
    value: 'text-blue-400',
  },
  purple: {
    bg: 'bg-purple-500/20',
    border: 'border-purple-500/30',
    icon: 'text-purple-400',
    value: 'text-purple-400',
  },
  red: {
    bg: 'bg-red-500/20',
    border: 'border-red-500/30',
    icon: 'text-red-400',
    value: 'text-red-400',
  },
  amber: {
    bg: 'bg-amber-500/20',
    border: 'border-amber-500/30',
    icon: 'text-amber-400',
    value: 'text-amber-400',
  },
  emerald: {
    bg: 'bg-emerald-500/20',
    border: 'border-emerald-500/30',
    icon: 'text-emerald-400',
    value: 'text-emerald-400',
  },
  rose: {
    bg: 'bg-rose-500/20',
    border: 'border-rose-500/30',
    icon: 'text-rose-400',
    value: 'text-rose-400',
  },
};

export default function KPICard({ title, value, icon, color, subtitle, pulse }: KPICardProps) {
  const colors = colorClasses[color];
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`
        relative p-3 rounded-xl border ${colors.bg} ${colors.border}
        ${pulse ? 'animate-pulse' : ''}
      `}
    >
      {pulse && (
        <div className="absolute -top-1 -right-1">
          <span className="relative flex h-3 w-3">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color === 'red' ? 'bg-red-400' : 'bg-rose-400'} opacity-75`} />
            <span className={`relative inline-flex rounded-full h-3 w-3 ${color === 'red' ? 'bg-red-500' : 'bg-rose-500'}`} />
          </span>
        </div>
      )}
      
      <div className="flex items-center justify-between mb-1">
        <span className={colors.icon}>{icon}</span>
      </div>
      
      <div className={`text-2xl font-bold ${colors.value}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      
      <div className="text-xs text-gray-400 font-medium">{title}</div>
      
      {subtitle && (
        <div className="text-[10px] text-gray-500 mt-0.5">{subtitle}</div>
      )}
    </motion.div>
  );
}
