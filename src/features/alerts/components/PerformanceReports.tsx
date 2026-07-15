/**
 * Agent Performance Reports
 * Visualizes agent performance metrics with charts and statistics
 */
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle,
  AlertTriangle,
  ArrowUpCircle,
  Timer,
  Calendar,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  User,
  Award,
  Target,
} from 'lucide-react';
import { useAlertDistributionStore, AgentSession } from '@store/alertDistributionStore';
import { api } from '@services/api';
import { format, subDays } from 'date-fns';

// Performance data interface
interface PerformanceDay {
  date: string;
  alerts_received: number;
  alerts_acknowledged: number;
  alerts_resolved: number;
  alerts_escalated: number;
  alerts_timeout: number;
  total_handling_time_seconds: number;
  avg_acknowledge_time_seconds: number;
  avg_resolution_time_seconds: number;
}

interface AgentPerformanceSummary {
  userId: string;
  username: string;
  totalReceived: number;
  totalResolved: number;
  totalEscalated: number;
  totalTimeout: number;
  avgHandlingTime: number;
  resolutionRate: number;
  escalationRate: number;
  timeoutRate: number;
}

// Mini bar chart component
const MiniBarChart: React.FC<{ data: number[]; maxValue: number; color: string }> = ({ data, maxValue, color }) => {
  const barWidth = 100 / data.length;
  
  return (
    <div className="flex items-end gap-0.5 h-12">
      {data.map((value, index) => {
        const height = maxValue > 0 ? (value / maxValue) * 100 : 0;
        return (
          <div
            key={index}
            className={`${color} rounded-t transition-all`}
            style={{
              width: `${barWidth - 2}%`,
              height: `${height}%`,
              minHeight: value > 0 ? '2px' : '0px',
            }}
          />
        );
      })}
    </div>
  );
};

// Metric card component
interface MetricCardProps {
  label: string;
  value: number | string;
  change?: number;
  icon: any;
  color: string;
  bgColor: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, change, icon: Icon, color, bgColor }) => (
  <div className={`p-4 rounded-lg ${bgColor} border border-white/5`}>
    <div className="flex items-center justify-between">
      <Icon className={`w-5 h-5 ${color}`} />
      {change !== undefined && (
        <div className={`flex items-center gap-0.5 text-xs ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(change)}%
        </div>
      )}
    </div>
    <div className="mt-2">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  </div>
);

// Agent performance row
interface AgentPerformanceRowProps {
  agent: AgentPerformanceSummary;
  rank: number;
  isTop: boolean;
}

const AgentPerformanceRow: React.FC<AgentPerformanceRowProps> = ({ agent, rank, isTop }) => (
  <div className={`flex items-center justify-between py-3 px-4 rounded-lg ${
    isTop ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-white/5'
  }`}>
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
        rank === 1 ? 'bg-yellow-500/20 text-yellow-400' :
        rank === 2 ? 'bg-slate-400/20 text-slate-400' :
        rank === 3 ? 'bg-amber-600/20 text-amber-600' :
        'bg-white/10 text-slate-400'
      }`}>
        {rank <= 3 ? <Award className="w-4 h-4" /> : <span className="text-sm">{rank}</span>}
      </div>
      <div>
        <div className="text-sm font-medium text-white">{agent.username}</div>
        <div className="text-xs text-slate-400">
          {agent.totalResolved} resolved • {agent.totalReceived} received
        </div>
      </div>
    </div>
    
    <div className="flex items-center gap-4">
      {/* Resolution rate */}
      <div className="text-right">
        <div className={`text-sm font-bold ${
          agent.resolutionRate >= 80 ? 'text-emerald-400' :
          agent.resolutionRate >= 60 ? 'text-amber-400' :
          'text-red-400'
        }`}>
          {agent.resolutionRate.toFixed(0)}%
        </div>
        <div className="text-xs text-slate-500">Resolution</div>
      </div>
      
      {/* Escalation rate */}
      <div className="text-right">
        <div className={`text-sm font-bold ${
          agent.escalationRate <= 10 ? 'text-emerald-400' :
          agent.escalationRate <= 25 ? 'text-amber-400' :
          'text-red-400'
        }`}>
          {agent.escalationRate.toFixed(0)}%
        </div>
        <div className="text-xs text-slate-500">Escalation</div>
      </div>
      
      {/* Avg handling time */}
      <div className="text-right">
        <div className="text-sm font-bold text-white">
          {Math.floor(agent.avgHandlingTime / 60)}m
        </div>
        <div className="text-xs text-slate-500">Avg Time</div>
      </div>
    </div>
  </div>
);

// Main component
const PerformanceReports: React.FC = () => {
  const { allAgents, fetchAgents } = useAlertDistributionStore();
  const [isExpanded, setIsExpanded] = useState(true);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [performanceData, setPerformanceData] = useState<Record<string, PerformanceDay[]>>({});
  
  // Fetch performance data for all agents
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);
  
  useEffect(() => {
    const fetchPerformanceData = async () => {
      setLoading(true);
      const data: Record<string, PerformanceDay[]> = {};
      
      for (const agent of allAgents) {
        try {
          const response = await api.distribution.getPerformance(agent.user_id, days);
          if (response.success && response.data) {
            data[agent.user_id] = response.data as PerformanceDay[];
          }
        } catch (e) {
          // Ignore errors
        }
      }
      
      setPerformanceData(data);
      setLoading(false);
    };
    
    if (allAgents.length > 0) {
      fetchPerformanceData();
    }
  }, [allAgents, days]);
  
  // Calculate aggregated metrics
  const aggregatedMetrics = useMemo(() => {
    let totalReceived = 0;
    let totalResolved = 0;
    let totalEscalated = 0;
    let totalTimeout = 0;
    let totalHandlingTime = 0;
    
    Object.values(performanceData).forEach(agentData => {
      agentData.forEach(day => {
        totalReceived += day.alerts_received || 0;
        totalResolved += day.alerts_resolved || 0;
        totalEscalated += day.alerts_escalated || 0;
        totalTimeout += day.alerts_timeout || 0;
        totalHandlingTime += day.total_handling_time_seconds || 0;
      });
    });
    
    return {
      totalReceived,
      totalResolved,
      totalEscalated,
      totalTimeout,
      avgHandlingTime: totalResolved > 0 ? Math.floor(totalHandlingTime / totalResolved) : 0,
      resolutionRate: totalReceived > 0 ? (totalResolved / totalReceived) * 100 : 0,
    };
  }, [performanceData]);
  
  // Calculate daily trend data
  const dailyTrend = useMemo(() => {
    const trend: number[] = [];
    const dateLabels: string[] = [];
    
    for (let i = days - 1; i >= 0; i--) {
      const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
      dateLabels.push(format(subDays(new Date(), i), 'MMM d'));
      
      let dayTotal = 0;
      Object.values(performanceData).forEach(agentData => {
        const dayData = agentData.find(d => d.date === date);
        if (dayData) {
          dayTotal += dayData.alerts_resolved || 0;
        }
      });
      trend.push(dayTotal);
    }
    
    return { trend, dateLabels };
  }, [performanceData, days]);
  
  // Calculate agent leaderboard
  const agentLeaderboard = useMemo((): AgentPerformanceSummary[] => {
    return allAgents
      .map(agent => {
        const agentData = performanceData[agent.user_id] || [];
        
        const totals = agentData.reduce((acc, day) => ({
          received: acc.received + (day.alerts_received || 0),
          resolved: acc.resolved + (day.alerts_resolved || 0),
          escalated: acc.escalated + (day.alerts_escalated || 0),
          timeout: acc.timeout + (day.alerts_timeout || 0),
          handlingTime: acc.handlingTime + (day.total_handling_time_seconds || 0),
        }), { received: 0, resolved: 0, escalated: 0, timeout: 0, handlingTime: 0 });
        
        return {
          userId: agent.user_id,
          username: agent.username,
          totalReceived: totals.received,
          totalResolved: totals.resolved,
          totalEscalated: totals.escalated,
          totalTimeout: totals.timeout,
          avgHandlingTime: totals.resolved > 0 ? totals.handlingTime / totals.resolved : 0,
          resolutionRate: totals.received > 0 ? (totals.resolved / totals.received) * 100 : 0,
          escalationRate: totals.received > 0 ? (totals.escalated / totals.received) * 100 : 0,
          timeoutRate: totals.received > 0 ? (totals.timeout / totals.received) * 100 : 0,
        };
      })
      .sort((a, b) => b.totalResolved - a.totalResolved);
  }, [allAgents, performanceData]);
  
  const maxTrend = Math.max(...dailyTrend.trend, 1);
  
  return (
    <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-white/5"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-primary-400" />
          <span className="font-semibold text-white">Performance Reports</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Time period selector */}
          <select
            value={days}
            onChange={(e) => { e.stopPropagation(); setDays(parseInt(e.target.value)); }}
            onClick={(e) => e.stopPropagation()}
            className="px-2 py-1 text-xs bg-white/10 border border-white/10 rounded text-slate-300"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          
          <button
            onClick={(e) => { e.stopPropagation(); fetchAgents(); }}
            className="p-1.5 text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </div>
      
      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/10"
          >
            <div className="p-4 space-y-6">
              {/* Summary metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                  label="Total Received"
                  value={aggregatedMetrics.totalReceived}
                  icon={Target}
                  color="text-blue-400"
                  bgColor="bg-blue-500/10"
                />
                <MetricCard
                  label="Total Resolved"
                  value={aggregatedMetrics.totalResolved}
                  icon={CheckCircle}
                  color="text-emerald-400"
                  bgColor="bg-emerald-500/10"
                />
                <MetricCard
                  label="Resolution Rate"
                  value={`${aggregatedMetrics.resolutionRate.toFixed(0)}%`}
                  icon={TrendingUp}
                  color="text-purple-400"
                  bgColor="bg-purple-500/10"
                />
                <MetricCard
                  label="Avg Handling"
                  value={`${Math.floor(aggregatedMetrics.avgHandlingTime / 60)}m`}
                  icon={Timer}
                  color="text-amber-400"
                  bgColor="bg-amber-500/10"
                />
              </div>
              
              {/* Daily trend chart */}
              <div className="bg-white/5 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-white">Daily Resolved Alerts</h4>
                  <div className="text-xs text-slate-400">Last {days} days</div>
                </div>
                <MiniBarChart
                  data={dailyTrend.trend}
                  maxValue={maxTrend}
                  color="bg-primary-500"
                />
                <div className="flex justify-between mt-2">
                  <span className="text-[10px] text-slate-500">{dailyTrend.dateLabels[0]}</span>
                  <span className="text-[10px] text-slate-500">{dailyTrend.dateLabels[dailyTrend.dateLabels.length - 1]}</span>
                </div>
              </div>
              
              {/* Agent leaderboard */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Award className="w-4 h-4 text-yellow-400" />
                  <h4 className="text-sm font-medium text-white">Agent Leaderboard</h4>
                </div>
                
                <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {agentLeaderboard.length > 0 ? (
                    agentLeaderboard.map((agent, index) => (
                      <AgentPerformanceRow
                        key={agent.userId}
                        agent={agent}
                        rank={index + 1}
                        isTop={index === 0}
                      />
                    ))
                  ) : (
                    <div className="text-center py-6 text-slate-400">
                      <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No performance data available</p>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Escalation & Timeout summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-amber-400">
                    <ArrowUpCircle className="w-5 h-5" />
                    <span className="text-sm font-medium">Escalations</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">{aggregatedMetrics.totalEscalated}</div>
                  <div className="text-xs text-slate-400">
                    {aggregatedMetrics.totalReceived > 0
                      ? `${((aggregatedMetrics.totalEscalated / aggregatedMetrics.totalReceived) * 100).toFixed(1)}% of total`
                      : '0% of total'}
                  </div>
                </div>
                
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertTriangle className="w-5 h-5" />
                    <span className="text-sm font-medium">Timeouts</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white">{aggregatedMetrics.totalTimeout}</div>
                  <div className="text-xs text-slate-400">
                    {aggregatedMetrics.totalReceived > 0
                      ? `${((aggregatedMetrics.totalTimeout / aggregatedMetrics.totalReceived) * 100).toFixed(1)}% of total`
                      : '0% of total'}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PerformanceReports;
