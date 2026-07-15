/**
 * VehicleLogsPanel - Displays vehicle history/logs from ERP_Tracking
 * Professional tabbed interface with category grouping
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Calendar,
  Activity,
  MinusCircle,
  ClipboardList,
  AlertOctagon,
  RefreshCw,
  MessageSquare,
  AlertCircle,
  Shield,
  MessageCircle,
  Star,
  PhoneCall,
  WifiOff,
  DollarSign,
  RotateCw,
  Loader2,
  ChevronRight,
  Clock,
  User,
  Phone,
  MapPin,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Search,
  X,
} from 'lucide-react';
import { api } from '@services/api';
import { formatDistanceToNow, format } from 'date-fns';

// Log type icons mapping
const LOG_ICONS: Record<string, React.ElementType> = {
  FileText,
  Calendar,
  Activity,
  MinusCircle,
  ClipboardList,
  AlertOctagon,
  RefreshCw,
  MessageSquare,
  AlertCircle,
  Shield,
  MessageCircle,
  Star,
  PhoneCall,
  WifiOff,
  DollarSign,
  RotateCw,
};

// Category colors
const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Communication: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' },
  Events: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30' },
  Service: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  Critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
  Complaints: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30' },
  Technical: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  Finance: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  Other: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/30' },
};

// Status badge colors
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  OPEN: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  'IN PROCESS': { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  DISPATCHED: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  RESOLVED: { bg: 'bg-green-500/20', text: 'text-green-400' },
  'RE OPEN': { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  'PENDING AT CUSTOMER': { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  COMPLETED: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  CLOSED: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
};

interface LogSummary {
  logType: string;
  originalType: string;
  count: number;
  label: string;
  icon: string;
  category: string;
}

interface VehicleLogsPanelProps {
  vehicleId: number;
  vehicleReg: string;
}

export default function VehicleLogsPanel({ vehicleId, vehicleReg }: VehicleLogsPanelProps) {
  const [logSummary, setLogSummary] = useState<LogSummary[]>([]);
  const [selectedLogType, setSelectedLogType] = useState<string | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  /**
   * CRM log datetime columns are SQL Server `datetime` (no timezone).
   * When serialized through Node (often running in UTC), they can arrive as ISO `...Z`,
   * which makes the browser add +5 hours (PKT). For Vehicle History we want the
   * exact wall-clock time stored in the table, so we parse "timezone-less".
   */
  const parseCrmDateTime = (value: any): Date | null => {
    if (!value) return null;

    // If we already have a Date, use UTC components to preserve "wall time"
    // from an ISO `...Z` serialization path.
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return null;
      return new Date(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        value.getUTCHours(),
        value.getUTCMinutes(),
        value.getUTCSeconds(),
        value.getUTCMilliseconds()
      );
    }

    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) return null;

      // SQL-ish local datetime: "YYYY-MM-DD HH:mm:ss" (or with "T")
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        const [, yy, mo, dd, hh, mm, ss] = m;
        return new Date(
          Number(yy),
          Number(mo) - 1,
          Number(dd),
          Number(hh),
          Number(mm),
          Number(ss || '0')
        );
      }

      // ISO with explicit timezone (Z or +/- offset): preserve wall time by using UTC parts
      const hasExplicitTz = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
      if (hasExplicitTz) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
          return new Date(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            d.getUTCHours(),
            d.getUTCMinutes(),
            d.getUTCSeconds(),
            d.getUTCMilliseconds()
          );
        }
      }

      // Fallback: let JS try to parse (may still be ok for non-ISO strings)
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }

    if (typeof value === 'number') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  };

  // Fetch log summary on mount
  useEffect(() => {
    const fetchSummary = async () => {
      setSummaryLoading(true);
      try {
        const response = await api.crm.getLogSummary(vehicleId);
        if (response.success && response.data) {
          const data = response.data as LogSummary[];
          setLogSummary(data);
          // Auto-select first log type if available
          if (data.length > 0) {
            setSelectedLogType(data[0].logType);
          }
        }
      } catch (error) {
        console.error('Failed to fetch log summary:', error);
      } finally {
        setSummaryLoading(false);
      }
    };

    if (vehicleId) {
      fetchSummary();
    }
  }, [vehicleId]);

  // Fetch logs when type changes
  useEffect(() => {
    const fetchLogs = async () => {
      if (!selectedLogType) return;
      
      setLoading(true);
      setLogs([]);
      
      try {
        const response = await api.crm.getLogs(vehicleId, selectedLogType);
        if (response.success && response.data) {
          setLogs(response.data as any[]);
        }
      } catch (error) {
        console.error('Failed to fetch logs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [vehicleId, selectedLogType]);

  // Group summary by category
  const groupedSummary = logSummary.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, LogSummary[]>);

  // Filter logs by search term
  const filteredLogs = logs.filter(log => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return Object.values(log).some(value => 
      String(value || '').toLowerCase().includes(searchLower)
    );
  });

  // Format date value
  const formatDate = (value: any): string => {
    if (!value) return '-';
    try {
      const date = parseCrmDateTime(value);
      if (!date) return String(value);
      return format(date, 'dd MMM yyyy, hh:mm a');
    } catch {
      return String(value);
    }
  };

  // Format relative time
  const formatRelative = (value: any): string => {
    if (!value) return '';
    try {
      const date = parseCrmDateTime(value);
      if (!date) return '';
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return '';
    }
  };

  // Format status display
  const formatStatus = (status: any): string => {
    if (!status) return '';
    if (typeof status === 'string') return status;
    switch (status) {
      case 1: return 'Open';
      case 2: return 'In Process';
      case 3: return 'Dispatched';
      case 4: return 'Resolved';
      case 5: return 'Re-Open';
      case 6: return 'Pending';
      case 7: return 'Completed';
      default: return String(status);
    }
  };

  // Fields to exclude from "other fields" display
  const EXCLUDED_FIELDS = new Set([
    'COMMENTS', 'Comments', 'Description', 'Resolution',
    'STATUS', 'ComplainStatus', 'StatusId',
    'DATE', 'CREATION_DATE', 'CALLING DATE TIME', 'INCIDENT DATE', 'ComplainDate', 'LOG_DATE',
    'CREATED BY', 'CreatedByName', 'LOG_BY', 'AGENT NAME',
    'SPOKE TO', 'CALLING NO', 'CUSTOMER NUMBER', 'CallingNo',
  ]);

  // Render log entry based on type
  const renderLogEntry = useCallback((log: any, index: number) => {
    const logId = `${selectedLogType}-${index}`;
    const isExpanded = expandedLogId === logId;
    
    // Extract common fields
    const date = log['DATE'] || log['CREATION_DATE'] || log['CALLING DATE TIME'] || log['INCIDENT DATE'] || log['ComplainDate'] || log['LOG_DATE'];
    const status = log['STATUS'] || log['ComplainStatus'];
    const comments = log['COMMENTS'] || log['Comments'] || log['Description'] || log['Resolution'];
    const createdBy = log['CREATED BY'] || log['CreatedByName'] || log['LOG_BY'] || log['AGENT NAME'];
    const spokeTo = log['SPOKE TO'];
    const callingNo = log['CALLING NO'] || log['CUSTOMER NUMBER'] || log['CallingNo'];
    
    // Get other fields (excluding common ones)
    const otherFields = Object.entries(log)
      .filter(([key]) => !EXCLUDED_FIELDS.has(key))
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '' && String(value) !== '-');
    
    // Get status color
    const statusStr = formatStatus(status);
    const statusColor = STATUS_COLORS[statusStr.toUpperCase()] || STATUS_COLORS.OPEN;

    return (
      <motion.div
        key={logId}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index * 0.02, 0.3) }}
        className={`rounded-lg overflow-hidden transition-colors ${
          isExpanded ? 'lg-card lg-card-cyan' : 'lg-card hover:border-white/12'
        }`}
      >
        {/* Header - Always Visible */}
        <button
          onClick={() => setExpandedLogId(isExpanded ? null : logId)}
          className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
        >
          <ChevronRight className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-slate-400">{formatDate(date)}</span>
              {statusStr && (
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${statusColor.bg} ${statusColor.text}`}>
                  {statusStr}
                </span>
              )}
            </div>
            {createdBy && (
              <div className="text-[10px] text-slate-500 mt-0.5">by {createdBy}</div>
            )}
          </div>
        </button>
        
        {/* Expanded Content */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 space-y-2 text-xs">
                {/* Contact Info */}
                {(spokeTo || callingNo) && (
                  <div className="flex flex-wrap gap-3 py-1.5 border-t border-slate-700/30">
                    {spokeTo && (
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3 text-blue-400" />
                        <span className="text-slate-300">{spokeTo}</span>
                      </div>
                    )}
                    {callingNo && (
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-green-400" />
                        <span className="text-slate-300">{callingNo}</span>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Other Fields - Clean Table Layout */}
                {otherFields.length > 0 && (
                  <div className="py-2 border-t border-slate-700/30 space-y-1">
                    {otherFields.map(([key, value]) => {
                      const displayValue = key.toLowerCase().includes('date') || key.toLowerCase().includes('time')
                        ? formatDate(value)
                        : String(value);
                      
                      return (
                        <div key={key} className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] text-slate-500 uppercase whitespace-nowrap flex-shrink-0">
                            {key.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[11px] text-slate-300 text-right break-all leading-snug" title={displayValue}>
                            {displayValue}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {/* Comments */}
                {comments && (
                  <div className="py-1.5 border-t border-slate-700/30">
                    <div className="text-[10px] text-slate-500 uppercase mb-1">Comments</div>
                    <div className="text-slate-300 bg-slate-800/50 rounded p-2 whitespace-pre-wrap">
                      {comments}
                    </div>
                  </div>
                )}
                
                {/* Relative Time Footer */}
                {date && (
                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-700/30">
                    {formatRelative(date)}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }, [selectedLogType, expandedLogId]);

  // Calculate total logs
  const totalLogs = logSummary.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats Header */}
      {!summaryLoading && totalLogs > 0 && (
        <div className="px-4 py-2 border-b border-white/6 lg-tab-bar">
          <span className="text-xs text-slate-400">
            {totalLogs.toLocaleString()} total records across {logSummary.length} categories
          </span>
        </div>
      )}

      {summaryLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
        </div>
      ) : logSummary.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
          <FileText className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm">No history found for this vehicle</p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Left: Category Navigation */}
          <div className="w-48 shrink-0 border-r border-white/6 overflow-y-auto lg-sidebar" style={{ borderLeft: 'none' }}>
            <div className="p-2 space-y-3">
              {Object.entries(groupedSummary).map(([category, items]) => {
                const categoryColor = CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
                const categoryCount = items.reduce((sum, i) => sum + i.count, 0);
                
                return (
                  <div key={category}>
                    <div className={`px-2 py-1 rounded text-[10px] font-medium uppercase ${categoryColor.bg} ${categoryColor.text} mb-1`}>
                      {category} ({categoryCount.toLocaleString()})
                    </div>
                    
                    <div className="space-y-0.5">
                      {items.map(item => {
                        const IconComponent = LOG_ICONS[item.icon] || FileText;
                        const isSelected = selectedLogType === item.logType;
                        
                        return (
                          <button
                            key={item.logType}
                            onClick={() => setSelectedLogType(item.logType)}
                            className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[11px] transition-colors ${
                              isSelected 
                                ? `${categoryColor.bg} ${categoryColor.text} border ${categoryColor.border}` 
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                            }`}
                          >
                            <IconComponent className="w-3 h-3 shrink-0" />
                            <span className="truncate flex-1">{item.label}</span>
                            <span className={`text-[9px] ${isSelected ? categoryColor.text : 'text-slate-500'}`}>
                              {item.count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Log Content */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Search Bar */}
            {selectedLogType && logs.length > 0 && (
              <div className="px-3 py-2 border-b border-white/6">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search logs..."
                    className="w-full pl-8 pr-8 py-1.5 liquid-input rounded text-xs text-white placeholder-white/20"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Log Entries */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                  {searchTerm ? (
                    <>
                      <Search className="w-6 h-6 mb-2 opacity-50" />
                      <p className="text-xs">No matching logs found</p>
                    </>
                  ) : (
                    <>
                      <FileText className="w-6 h-6 mb-2 opacity-50" />
                      <p className="text-xs">No logs available</p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {/* Results count */}
                  {searchTerm && (
                    <div className="text-[10px] text-slate-500 mb-2">
                      Showing {filteredLogs.length} of {logs.length} records
                    </div>
                  )}
                  
                  {filteredLogs.map((log, index) => renderLogEntry(log, index))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
