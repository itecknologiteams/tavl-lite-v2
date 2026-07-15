import { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  X,
  Route,
  Gauge,
  Navigation,
  MapPin,
  ChevronUp,
  ChevronDown,
  Battery,
  Zap,
  Power,
  Signal,
  BarChart3,
  Clock,
  Timer,
  AlertTriangle,
  Sparkles,
  Car,
  Fuel,
  ScrollText,
} from 'lucide-react';
import { useTrackStore } from '@store/trackStore';
import { useLayoutStore } from '@store/layoutStore';
import { analyzeTrackEvents, formatDurationShort } from '@utils/trackEvents';
import type { JourneySummary } from '@utils/trackEvents';
import { format } from 'date-fns';

const PLAYBACK_SPEEDS = [1, 2, 4, 8, 16];

// Mini chart component for telemetry data
interface MiniChartProps {
  data: number[];
  currentIndex: number;
  color: string;
  label: string;
  unit: string;
  min?: number;
  max?: number;
  icon: React.ReactNode;
}

function MiniChart({ data, currentIndex, color, label, unit, min, max, icon }: MiniChartProps) {
  const chartData = useMemo(() => {
    if (data.length === 0) return [];
    // Sample data to max 100 points for performance
    const step = Math.max(1, Math.floor(data.length / 100));
    return data.filter((_, i) => i % step === 0);
  }, [data]);

  const dataMin = min ?? Math.min(...chartData.filter(v => v > 0));
  const dataMax = max ?? Math.max(...chartData);
  const range = dataMax - dataMin || 1;
  const currentValue = data[currentIndex] ?? 0;
  
  // Calculate path
  const width = 200;
  const height = 40;
  const points = chartData.map((v, i) => {
    const x = (i / (chartData.length - 1)) * width;
    const y = height - ((v - dataMin) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  // Current position indicator
  const currentX = (currentIndex / (data.length - 1)) * width;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <span className={`${color}`}>{icon}</span>
        <span className="text-[10px] text-slate-400 uppercase">{label}</span>
        <span className={`text-sm font-bold ml-auto ${color}`}>
          {currentValue.toFixed(1)} {unit}
        </span>
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        {/* Grid lines */}
        <line x1="0" y1={height/2} x2={width} y2={height/2} stroke="rgba(255,255,255,0.1)" strokeDasharray="2,2" />
        {/* Data line */}
        {chartData.length > 1 && (
          <polyline
            points={points}
            fill="none"
            stroke={color.includes('emerald') ? '#10b981' : color.includes('amber') ? '#f59e0b' : color.includes('blue') ? '#3b82f6' : '#8b5cf6'}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {/* Current position */}
        <line x1={currentX} y1="0" x2={currentX} y2={height} stroke="white" strokeWidth="1" opacity="0.5" />
        <circle cx={currentX} cy={height - ((currentValue - dataMin) / range) * height} r="3" fill="white" />
      </svg>
      <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
        <span>{dataMin.toFixed(1)}</span>
        <span>{dataMax.toFixed(1)}</span>
      </div>
    </div>
  );
}

interface InsightCardProps {
  icon: React.ReactNode;
  value: string;
  label: string;
  color: string;
  sub?: string;
  onClick?: () => void;
  active?: boolean;
}

function InsightCard({ icon, value, label, color, sub, onClick, active }: InsightCardProps) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 rounded-lg px-1.5 py-1.5 transition-colors ${
        onClick ? 'cursor-pointer hover:bg-white/5' : ''
      } ${active ? 'bg-white/5 ring-1 ring-white/10' : ''}`}
    >
      <span className={color}>{icon}</span>
      <span className={`text-sm font-bold ${color} leading-none`}>{value}</span>
      <span className="text-[9px] text-slate-500 leading-none">{label}</span>
      {sub && <span className="text-[8px] text-slate-600 leading-none">{sub}</span>}
    </Wrapper>
  );
}

export default function TrackPlaybackControls() {
  const {
    currentTrack,
    isPlaying,
    playbackSpeed,
    currentPointIndex,
    trackMode,
    osrmRoute,
    showGsmMarkers,
    showLatencyMarkers,
    showIgnitionEvents,
    showSpeedEvents,
    showIdleEvents,
    speedViolationThreshold,
    play,
    pause,
    stop,
    setPlaybackSpeed,
    setCurrentPointIndex,
    advancePlayback,
    clearTrack,
    toggleGsmMarkers,
    toggleLatencyMarkers,
    toggleIgnitionEvents,
    toggleSpeedEvents,
    toggleIdleEvents,
    showTripDetails,
    toggleTripDetails,
  } = useTrackStore();

  const setTrackBarHeight = useLayoutStore(s => s.setTrackBarHeight);
  const contentRef = useRef<HTMLDivElement>(null);
  const [showGraphs, setShowGraphs] = useState(false);
  const [showInsights, setShowInsights] = useState(false);

  const hasTrack = !!(currentTrack?.points?.length);

  const journeySummary = useMemo<JourneySummary | null>(() => {
    if (!currentTrack?.points?.length) return null;
    return analyzeTrackEvents(currentTrack.points, speedViolationThreshold);
  }, [currentTrack, speedViolationThreshold]);

  useEffect(() => {
    if (!hasTrack) {
      setTrackBarHeight(0);
      return;
    }

    const el = contentRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      setTrackBarHeight(el.offsetHeight);
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      setTrackBarHeight(0);
    };
  }, [hasTrack, setTrackBarHeight]);

  // Playback effect
  useEffect(() => {
    if (!isPlaying || !currentTrack || currentTrack.points.length === 0) return;

    const interval = setInterval(() => {
      advancePlayback();
    }, 100 / playbackSpeed);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, currentTrack, advancePlayback]);

  // Extract telemetry arrays for charts
  const telemetryData = useMemo(() => {
    if (!currentTrack || !currentTrack.points) return null;
    const latencyData = currentTrack.points.map(p => p.latency || 0);
    const avgLatency = latencyData.reduce((a, b) => a + b, 0) / latencyData.length;
    const maxLatency = Math.max(...latencyData);
    return {
      speed: currentTrack.points.map(p => p.speed || 0),
      battery: currentTrack.points.map(p => p.battery || 0),
      powerVolt: currentTrack.points.map(p => p.powerVolt || 0),
      ignition: currentTrack.points.map(p => p.ignition ? 1 : 0),
      gsmSignal: currentTrack.points.map(p => p.gsmSignal || 0),
      latency: latencyData,
      avgLatency: Math.round(avgLatency),
      maxLatency,
    };
  }, [currentTrack]);

  if (!currentTrack || !currentTrack.points || currentTrack.points.length === 0) return null;

  const pointsCount = currentTrack.points.length;
  const safeIndex = Math.min(currentPointIndex, pointsCount - 1);
  const currentPoint = currentTrack.points[safeIndex];
  const progress = ((safeIndex + 1) / pointsCount) * 100;

  // Format duration
  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="flex-shrink-0 relative z-20"
      >
        {/* Main Bar - Full Width */}
        <div ref={contentRef} className="lg-header border-t border-white/8" style={{ borderBottom: 'none' }}>
          {/* Single Row: All controls in one compact line */}
          <div className="flex items-center gap-3 px-3 py-2">
            {/* Left: Vehicle Info + Close */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {trackMode === 'osrm' && osrmRoute ? (
                <Navigation className="w-4 h-4 text-emerald-400" />
              ) : (
                <MapPin className="w-4 h-4 text-purple-400" />
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-white">{currentTrack.vehicleName}</span>
                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${
                  trackMode === 'osrm' && osrmRoute
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-purple-500/20 text-purple-400'
                }`}>
                  {trackMode === 'osrm' && osrmRoute ? 'OSRM' : 'RAW'}
                </span>
              </div>
              <button
                onClick={clearTrack}
                className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-white/10 transition-colors ml-1"
                title="Close track"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Divider */}
            <div className="w-px h-6 bg-white/10" />

            {/* Playback Controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={stop}
                className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Stop"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setCurrentPointIndex(Math.max(0, safeIndex - 10))}
                className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Skip back"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => (isPlaying ? pause() : play())}
                className="p-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white transition-colors"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setCurrentPointIndex(Math.min(pointsCount - 1, safeIndex + 10))}
                className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Skip forward"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Timeline/Progress - Flexible width */}
            <div className="flex-1 min-w-[200px] max-w-[500px]">
              <div 
                className="relative h-2 bg-white/10 rounded-full overflow-hidden cursor-pointer group"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const percent = x / rect.width;
                  const index = Math.floor(percent * pointsCount);
                  setCurrentPointIndex(Math.max(0, Math.min(pointsCount - 1, index)));
                }}
              >
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-purple-400 rounded-full"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ left: `calc(${progress}% - 6px)` }}
                />
              </div>
              <div className="flex justify-between mt-0.5 text-[9px] text-slate-500">
                <span>{currentPoint?.gpsTime ? format(new Date(currentPoint.gpsTime), 'HH:mm:ss') : '--:--:--'}</span>
                <span>{safeIndex + 1}/{pointsCount}</span>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-3 text-xs flex-shrink-0">
              <div className="flex items-center gap-1">
                <Gauge className={`w-3.5 h-3.5 ${currentPoint && currentPoint.speed > 0 ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span className={currentPoint && currentPoint.speed > 0 ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                  {currentPoint?.speed || 0} km/h
                </span>
              </div>
              <div className="flex items-center gap-1 text-purple-300">
                <Route className="w-3.5 h-3.5" />
                <span className="font-medium">{currentTrack.totalDistance.toFixed(1)} km</span>
              </div>
              {/* Latency indicator */}
              <div className="flex items-center gap-1" title={`Transmission latency: ${currentPoint?.latency || 0}s`}>
                <Timer className={`w-3.5 h-3.5 ${
                  (currentPoint?.latency || 0) <= 5 ? 'text-emerald-400' :
                  (currentPoint?.latency || 0) <= 30 ? 'text-amber-400' :
                  'text-red-400'
                }`} />
                <span className={`font-medium ${
                  (currentPoint?.latency || 0) <= 5 ? 'text-emerald-400' :
                  (currentPoint?.latency || 0) <= 30 ? 'text-amber-400' :
                  'text-red-400'
                }`}>
                  {currentPoint?.latency || 0}s
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="w-px h-6 bg-white/10" />

            {/* Speed Controls */}
            <div className="flex items-center gap-0.5 bg-white/5 rounded p-0.5 flex-shrink-0">
              {PLAYBACK_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  onClick={() => setPlaybackSpeed(speed)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                    playbackSpeed === speed
                      ? 'bg-purple-500 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>

            {/* GSM Signal Toggle */}
            <button
              onClick={toggleGsmMarkers}
              className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                showGsmMarkers
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
              title="Show GSM coverage halos on track"
            >
              <Signal className="w-4 h-4" />
            </button>

            {/* Latency Markers Toggle */}
            <button
              onClick={toggleLatencyMarkers}
              className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                showLatencyMarkers
                  ? 'bg-rose-500/20 text-rose-400'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
              title="Show transmission latency markers on track"
            >
              <Timer className="w-4 h-4" />
            </button>

            {/* Graphs Toggle */}
            <button
              onClick={() => setShowGraphs(!showGraphs)}
              className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                showGraphs
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
              title="Toggle telemetry graphs"
            >
              <BarChart3 className="w-4 h-4" />
            </button>

            {/* Divider */}
            <div className="w-px h-6 bg-white/10" />

            {/* Event Layer Toggles */}
            <button
              onClick={toggleIgnitionEvents}
              className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                showIgnitionEvents
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
              title="Show ignition ON/OFF events"
            >
              <Power className="w-4 h-4" />
            </button>

            <button
              onClick={toggleSpeedEvents}
              className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                showSpeedEvents
                  ? 'bg-red-500/20 text-red-400'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
              title={`Show speed violations (>${speedViolationThreshold} km/h)`}
            >
              <AlertTriangle className="w-4 h-4" />
            </button>

            <button
              onClick={toggleIdleEvents}
              className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                showIdleEvents
                  ? 'bg-indigo-500/20 text-indigo-400'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
              title="Show idle zones (engine on, not moving)"
            >
              <Fuel className="w-4 h-4" />
            </button>

            {/* Journey Insights Toggle */}
            <button
              onClick={() => setShowInsights(!showInsights)}
              className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                showInsights
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
              title="Journey insights & summary"
            >
              <Sparkles className="w-4 h-4" />
            </button>

            {/* Trip Details Timeline */}
            <button
              onClick={toggleTripDetails}
              className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                showTripDetails
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
              title="Trip details timeline"
            >
              <ScrollText className="w-4 h-4" />
            </button>
          </div>

          {/* Expandable Graphs Panel */}
          <AnimatePresence>
            {showGraphs && telemetryData && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-t border-white/10"
              >
                <div className="px-3 py-2 flex items-start gap-4">
                  <div className="flex-1 grid grid-cols-5 gap-3">
                    <MiniChart
                      data={telemetryData.speed}
                      currentIndex={safeIndex}
                      color="text-emerald-400"
                      label="Speed"
                      unit="km/h"
                      min={0}
                      icon={<Gauge className="w-3 h-3" />}
                    />
                    <MiniChart
                      data={telemetryData.battery}
                      currentIndex={safeIndex}
                      color="text-amber-400"
                      label="Battery"
                      unit="V"
                      min={10}
                      max={15}
                      icon={<Battery className="w-3 h-3" />}
                    />
                    <MiniChart
                      data={telemetryData.powerVolt}
                      currentIndex={safeIndex}
                      color="text-blue-400"
                      label="Power Volt"
                      unit="V"
                      min={10}
                      max={15}
                      icon={<Zap className="w-3 h-3" />}
                    />
                    <MiniChart
                      data={telemetryData.gsmSignal}
                      currentIndex={safeIndex}
                      color="text-cyan-400"
                      label="GSM Signal"
                      unit=""
                      min={0}
                      max={5}
                      icon={<Signal className="w-3 h-3" />}
                    />
                    <MiniChart
                      data={telemetryData.latency}
                      currentIndex={safeIndex}
                      color="text-rose-400"
                      label="Latency"
                      unit="s"
                      min={0}
                      icon={<Timer className="w-3 h-3" />}
                    />
                  </div>

                  <div className="flex flex-col gap-1 text-[10px] border-l border-white/10 pl-3 flex-shrink-0">
                    <div className="flex items-center gap-1">
                      <Battery className="w-3 h-3 text-amber-400" />
                      <span className="text-amber-400 font-medium">{currentPoint?.battery?.toFixed(2) || '0.00'}V</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Zap className="w-3 h-3 text-blue-400" />
                      <span className="text-blue-400 font-medium">{currentPoint?.powerVolt?.toFixed(2) || '0.00'}V</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Power className="w-3 h-3 text-purple-400" />
                      <span className={`font-medium ${currentPoint?.ignition ? 'text-emerald-400' : 'text-red-400'}`}>
                        {currentPoint?.ignition ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Signal className="w-3 h-3 text-cyan-400" />
                      <span className="text-cyan-400 font-medium">GSM {currentPoint?.gsmSignal || 0}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Timer className={`w-3 h-3 ${
                        (currentPoint?.latency || 0) <= 5 ? 'text-emerald-400' :
                        (currentPoint?.latency || 0) <= 30 ? 'text-amber-400' :
                        'text-rose-400'
                      }`} />
                      <span className={`font-medium ${
                        (currentPoint?.latency || 0) <= 5 ? 'text-emerald-400' :
                        (currentPoint?.latency || 0) <= 30 ? 'text-amber-400' :
                        'text-rose-400'
                      }`}>
                        {currentPoint?.latency || 0}s (avg: {telemetryData.avgLatency}s)
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Journey Insights Panel */}
          <AnimatePresence>
            {showInsights && journeySummary && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-t border-white/10"
              >
                <div className="px-3 py-2.5">
                  {/* Stats Row */}
                  <div className="grid grid-cols-8 gap-2">
                    <InsightCard
                      icon={<Car className="w-3.5 h-3.5" />}
                      value={`${journeySummary.stats.movingPercentage}%`}
                      label="Moving"
                      color="text-emerald-400"
                      sub={formatDurationShort(journeySummary.stats.movingTime)}
                    />
                    <InsightCard
                      icon={<Square className="w-3 h-3" />}
                      value={formatDurationShort(journeySummary.stats.stoppedTime)}
                      label="Stopped"
                      color="text-slate-400"
                    />
                    <InsightCard
                      icon={<Gauge className="w-3.5 h-3.5" />}
                      value={`${journeySummary.stats.avgMovingSpeed}`}
                      label="Avg km/h"
                      color="text-blue-400"
                    />
                    <InsightCard
                      icon={<Gauge className="w-3.5 h-3.5" />}
                      value={`${journeySummary.stats.maxSpeed}`}
                      label="Max km/h"
                      color={journeySummary.stats.maxSpeed > speedViolationThreshold ? 'text-red-400' : 'text-amber-400'}
                    />
                    <InsightCard
                      icon={<Power className="w-3.5 h-3.5" />}
                      value={`${journeySummary.ignitionEvents.length}`}
                      label="Ign. Events"
                      color="text-emerald-400"
                      onClick={journeySummary.ignitionEvents.length > 0 ? toggleIgnitionEvents : undefined}
                      active={showIgnitionEvents}
                    />
                    <InsightCard
                      icon={<AlertTriangle className="w-3.5 h-3.5" />}
                      value={`${journeySummary.speedViolations.length}`}
                      label={`>${speedViolationThreshold} km/h`}
                      color="text-red-400"
                      onClick={journeySummary.speedViolations.length > 0 ? toggleSpeedEvents : undefined}
                      active={showSpeedEvents}
                    />
                    <InsightCard
                      icon={<Fuel className="w-3.5 h-3.5" />}
                      value={journeySummary.idleEvents.length > 0 ? formatDurationShort(journeySummary.stats.idleTime) : '0'}
                      label={`${journeySummary.idleEvents.length} Idle`}
                      color="text-indigo-400"
                      onClick={journeySummary.idleEvents.length > 0 ? toggleIdleEvents : undefined}
                      active={showIdleEvents}
                    />
                    <InsightCard
                      icon={<MapPin className="w-3.5 h-3.5" />}
                      value={`${currentTrack?.stops?.length || 0}`}
                      label="Stops"
                      color="text-amber-400"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
  );
}
