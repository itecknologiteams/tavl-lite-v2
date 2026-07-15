import { Users, Bell, CheckCircle, Clock, Coffee } from 'lucide-react';
import { useAlertDistributionStore } from '@store/alertDistributionStore';

export function StatsOverview() {
  const stats = useAlertDistributionStore((s) => s.stats);
  const allAgents = useAlertDistributionStore((s) => s.allAgents);

  const totalAgents = allAgents.length;
  const onBreak = (stats?.on_break ?? 0) + (stats?.break_requested ?? 0);

  return (
    <div className="flex-shrink-0 px-6 py-2 bg-slate-900/30 border-b border-white/10 flex items-center gap-5">
      <StatItem icon={<Users className="w-3.5 h-3.5" />} label="Total" value={totalAgents} color="text-violet-400" />
      <Divider />
      <StatItem icon={<Coffee className="w-3.5 h-3.5" />} label="On Break" value={onBreak} color="text-amber-400" />
      <Divider />
      <StatItem icon={<Bell className="w-3.5 h-3.5" />} label="Assigned" value={stats?.assigned_alerts ?? 0} color="text-blue-400" />
      <Divider />
      <StatItem icon={<Clock className="w-3.5 h-3.5" />} label="Acknowledged" value={stats?.acknowledged_alerts ?? 0} color="text-cyan-400" />
      <Divider />
      <StatItem icon={<CheckCircle className="w-3.5 h-3.5" />} label="Resolved Today" value={stats?.resolved_today ?? 0} color="text-emerald-400" />
    </div>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-white/10 flex-shrink-0" />;
}

function StatItem({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={color}>{icon}</span>
      <span className={`text-base font-bold tabular-nums ${color}`}>{value.toLocaleString()}</span>
      <span className="text-[10px] text-slate-500 uppercase tracking-wider hidden xl:block">{label}</span>
    </div>
  );
}
