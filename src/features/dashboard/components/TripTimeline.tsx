import { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  MapPin,
  Power,
  AlertTriangle,
  Fuel,
  Clock,
  Route,
  Flag,
  CircleDot,
  Gauge,
  ChevronDown,
  ChevronUp,
  List,
} from 'lucide-react';
import { useTrackStore } from '@store/trackStore';
import { analyzeTrackEvents, formatDurationShort } from '@utils/trackEvents';
import { batchReverseGeocode, getCachedAddress } from '@utils/geocoder';
import { format } from 'date-fns';
import { useVirtualizer } from '@tanstack/react-virtual';

type EntryType = 'start' | 'end' | 'stop' | 'ignition-on' | 'ignition-off' | 'speed-violation' | 'idle';

interface TimelineEntry {
  id: string;
  type: EntryType;
  time: Date;
  endTime?: Date;
  lat: number;
  lng: number;
  label: string;
  detail: string;
  subDetail?: string;
  color: string;
  dotColor: string;
  pointIndex?: number;
  endPointIndex?: number;
}

const TYPE_CONFIG: Record<EntryType, { dotColor: string; color: string }> = {
  start:            { dotColor: 'bg-emerald-500', color: 'text-emerald-400' },
  end:              { dotColor: 'bg-red-500',     color: 'text-red-400' },
  stop:             { dotColor: 'bg-amber-500',   color: 'text-amber-400' },
  'ignition-on':    { dotColor: 'bg-emerald-500', color: 'text-emerald-400' },
  'ignition-off':   { dotColor: 'bg-red-500',     color: 'text-red-400' },
  'speed-violation': { dotColor: 'bg-red-500',    color: 'text-red-400' },
  idle:             { dotColor: 'bg-indigo-500',  color: 'text-indigo-400' },
};

function EntryIcon({ type, className }: { type: EntryType; className?: string }) {
  switch (type) {
    case 'start':           return <Flag className={className} />;
    case 'end':             return <Flag className={className} />;
    case 'stop':            return <CircleDot className={className} />;
    case 'ignition-on':     return <Power className={className} />;
    case 'ignition-off':    return <Power className={className} />;
    case 'speed-violation':  return <AlertTriangle className={className} />;
    case 'idle':            return <Fuel className={className} />;
    default:                return <CircleDot className={className} />;
  }
}

export default function TripTimeline() {
  const currentTrack = useTrackStore((s) => s.currentTrack);
  const showTripDetails = useTrackStore((s) => s.showTripDetails);
  const toggleTripDetails = useTrackStore((s) => s.toggleTripDetails);
  const speedViolationThreshold = useTrackStore((s) => s.speedViolationThreshold);
  const setCurrentPointIndex = useTrackStore((s) => s.setCurrentPointIndex);
  const pause = useTrackStore((s) => s.pause);
  const focusTrackPoint = useTrackStore((s) => s.focusTrackPoint);

  const [addresses, setAddresses] = useState<Map<string, string>>(new Map());
  const [geocoding, setGeocoding] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'packets' | 'events'>('packets');
  const [selectedPacketIndex, setSelectedPacketIndex] = useState<number>(0);
  const packetsParentRef = useRef<HTMLDivElement | null>(null);

  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!currentTrack?.points?.length) return [];

    const points = currentTrack.points;
    const events = analyzeTrackEvents(points, speedViolationThreshold);
    const entries: TimelineEntry[] = [];

    const nearestPointIndex = (t: Date): number => {
      const target = t.getTime();
      let lo = 0;
      let hi = points.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const tm = new Date(points[mid].gpsTime).getTime();
        if (tm < target) lo = mid + 1;
        else hi = mid;
      }
      const i = lo;
      if (i <= 0) return 0;
      const t0 = new Date(points[i - 1].gpsTime).getTime();
      const t1 = new Date(points[i].gpsTime).getTime();
      return Math.abs(t1 - target) < Math.abs(target - t0) ? i : i - 1;
    };

    const start = points[0];
    entries.push({
      id: 'start',
      type: 'start',
      time: new Date(start.gpsTime),
      lat: start.latitude,
      lng: start.longitude,
      label: 'Journey Start',
      detail: `Ignition ${start.ignition ? 'ON' : 'OFF'} · ${start.speed || 0} km/h`,
      pointIndex: 0,
      ...TYPE_CONFIG.start,
    });

    const end = points[points.length - 1];
    entries.push({
      id: 'end',
      type: 'end',
      time: new Date(end.gpsTime),
      lat: end.latitude,
      lng: end.longitude,
      label: 'Journey End',
      detail: `${currentTrack.totalDistance.toFixed(1)} km traveled`,
      pointIndex: points.length - 1,
      ...TYPE_CONFIG.end,
    });

    currentTrack.stops.forEach((stop, i) => {
      const pi = nearestPointIndex(new Date(stop.startTime));
      const ei = nearestPointIndex(new Date(stop.endTime));
      entries.push({
        id: `stop-${i}`,
        type: 'stop',
        time: new Date(stop.startTime),
        endTime: new Date(stop.endTime),
        lat: stop.latitude,
        lng: stop.longitude,
        label: `Stop #${i + 1}`,
        detail: formatDurationShort(stop.duration),
        subDetail: `${format(new Date(stop.startTime), 'dd MMM HH:mm')} → ${format(new Date(stop.endTime), 'dd MMM HH:mm')}`,
        pointIndex: pi,
        endPointIndex: ei,
        ...TYPE_CONFIG.stop,
      });
    });

    events.ignitionEvents.forEach((evt, i) => {
      const isOn = evt.type === 'on';
      const cfg = isOn ? TYPE_CONFIG['ignition-on'] : TYPE_CONFIG['ignition-off'];
      entries.push({
        id: `ign-${i}`,
        type: isOn ? 'ignition-on' : 'ignition-off',
        time: evt.timestamp,
        lat: evt.latitude,
        lng: evt.longitude,
        label: isOn ? 'Ignition ON' : 'Ignition OFF',
        detail: `${isOn ? 'Was OFF' : 'Was ON'} for ${formatDurationShort(evt.prevStateDuration)}`,
        pointIndex: evt.pointIndex,
        ...cfg,
      });
    });

    events.speedViolations.forEach((viol, i) => {
      entries.push({
        id: `speed-${i}`,
        type: 'speed-violation',
        time: viol.startTime,
        endTime: viol.endTime,
        lat: viol.latitude,
        lng: viol.longitude,
        label: 'Speed Violation',
        detail: `Peak ${Math.round(viol.peakSpeed)} km/h`,
        subDetail: `${formatDurationShort(viol.duration)} above ${speedViolationThreshold} km/h`,
        pointIndex: viol.peakIndex,
        endPointIndex: viol.endIndex,
        ...TYPE_CONFIG['speed-violation'],
      });
    });

    events.idleEvents.forEach((idle, i) => {
      entries.push({
        id: `idle-${i}`,
        type: 'idle',
        time: idle.startTime,
        endTime: idle.endTime,
        lat: idle.latitude,
        lng: idle.longitude,
        label: 'Vehicle Idle',
        detail: formatDurationShort(idle.duration),
        subDetail: 'Engine ON, stationary',
        pointIndex: idle.startIndex,
        endPointIndex: idle.endIndex,
        ...TYPE_CONFIG.idle,
      });
    });

    entries.sort((a, b) => a.time.getTime() - b.time.getTime());
    return entries;
  }, [currentTrack, speedViolationThreshold]);

  useEffect(() => {
    if (!showTripDetails || timeline.length === 0) return;

    setGeocoding(true);
    const coords = timeline.map((e) => ({ lat: e.lat, lng: e.lng }));
    batchReverseGeocode(coords).then(() => {
      const m = new Map<string, string>();
      for (const e of timeline) {
        const a = getCachedAddress(e.lat, e.lng);
        if (a) m.set(e.id, a);
      }
      setAddresses(m);
      setGeocoding(false);
    });
  }, [showTripDetails, timeline]);

  // Keep selected packet in range when track changes
  useEffect(() => {
    if (!currentTrack?.points?.length) return;
    setSelectedPacketIndex((prev) => Math.max(0, Math.min(currentTrack.points.length - 1, prev)));
  }, [currentTrack?.points?.length]);

  const packetRowVirtualizer = useVirtualizer({
    count: currentTrack?.points?.length || 0,
    getScrollElement: () => packetsParentRef.current,
    estimateSize: () => 74,
    overscan: 12,
  });

  const summaryStats = useMemo(() => {
    if (!currentTrack?.points?.length) return null;
    const pts = currentTrack.points;
    const dur = new Date(pts[pts.length - 1].gpsTime).getTime() - new Date(pts[0].gpsTime).getTime();
    const events = analyzeTrackEvents(pts, speedViolationThreshold);
    return {
      duration: dur,
      distance: currentTrack.totalDistance,
      stops: currentTrack.stops.length,
      ignitions: events.ignitionEvents.length,
      violations: events.speedViolations.length,
      idles: events.idleEvents.length,
      totalEvents: timeline.length,
    };
  }, [currentTrack, speedViolationThreshold, timeline]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <AnimatePresence>
      {showTripDetails && currentTrack && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="absolute top-4 left-16 bottom-4 z-map-panel w-[370px] flex flex-col"
          style={{
            background: 'rgba(15, 23, 42, 0.94)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px',
            boxShadow:
              '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)',
          }}
        >
          {/* Header */}
          <div className="flex-shrink-0 px-4 pt-3.5 pb-3 border-b border-white/8">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center">
                  <Route className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white leading-none">
                    Trip Details
                  </h3>
                  <span className="text-[10px] text-slate-500">
                    {currentTrack.vehicleName} ·{' '}
                    {format(
                      new Date(currentTrack.points[0].gpsTime),
                      'dd MMM yyyy',
                    )}
                  </span>
                </div>
              </div>
              <button
                onClick={toggleTripDetails}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Summary chips */}
            {summaryStats && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Chip icon={<Clock className="w-3 h-3" />} label={formatDurationShort(summaryStats.duration)} color="text-purple-400" bg="bg-purple-500/10" />
                <Chip icon={<Route className="w-3 h-3" />} label={`${summaryStats.distance.toFixed(1)} km`} color="text-blue-400" bg="bg-blue-500/10" />
                <Chip icon={<MapPin className="w-3 h-3" />} label={`${summaryStats.stops} stop${summaryStats.stops !== 1 ? 's' : ''}`} color="text-amber-400" bg="bg-amber-500/10" />
                {summaryStats.violations > 0 && (
                  <Chip icon={<AlertTriangle className="w-3 h-3" />} label={`${summaryStats.violations} violation${summaryStats.violations !== 1 ? 's' : ''}`} color="text-red-400" bg="bg-red-500/10" />
                )}
                {summaryStats.idles > 0 && (
                  <Chip icon={<Fuel className="w-3 h-3" />} label={`${summaryStats.idles} idle`} color="text-indigo-400" bg="bg-indigo-500/10" />
                )}
              </div>
            )}
          </div>

          {/* Mode switch */}
          <div className="px-4 pt-2">
            <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('packets')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  viewMode === 'packets' ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white'
                }`}
                title="Raw packets (every GPS row)"
              >
                <List className="w-3.5 h-3.5" />
                Packets
              </button>
              <button
                type="button"
                onClick={() => setViewMode('events')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  viewMode === 'events' ? 'bg-purple-500/20 text-purple-300' : 'text-slate-400 hover:text-white'
                }`}
                title="Events (start/stop/ignition/violations/idles)"
              >
                <Route className="w-3.5 h-3.5" />
                Events
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
            <div className="px-4 py-3">
              <div className="relative">
                {viewMode === 'events' && (
                  <>
                    {/* Connecting line */}
                    <div
                      className="absolute left-[10px] top-[14px] bottom-[14px] w-px"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(16,185,129,0.5) 0%, rgba(148,163,184,0.15) 20%, rgba(148,163,184,0.15) 80%, rgba(239,68,68,0.5) 100%)',
                      }}
                    />

                    {timeline.map((entry, idx) => {
                  const addr = addresses.get(entry.id);
                  const isExpanded = !collapsed.has(entry.id);
                  const coordsStr = `${entry.lat.toFixed(5)}, ${entry.lng.toFixed(5)}`;
                  const gmapsUrl = `https://www.google.com/maps?q=${entry.lat},${entry.lng}`;
                  const p = currentTrack?.points?.length && typeof entry.pointIndex === 'number'
                    ? currentTrack.points[entry.pointIndex]
                    : null;

                  return (
                    <div
                      key={entry.id}
                      className="relative flex gap-3 group"
                      style={{ paddingBottom: idx < timeline.length - 1 ? 4 : 0 }}
                    >
                      {/* Dot */}
                      <div className="relative z-10 flex-shrink-0 mt-1">
                        <div
                          className={`w-[22px] h-[22px] rounded-full flex items-center justify-center border-2 border-slate-900 ${entry.dotColor}`}
                          style={{
                            boxShadow: `0 0 8px ${entry.dotColor.replace('bg-', '').includes('emerald') ? 'rgba(16,185,129,0.3)' : entry.dotColor.includes('red') ? 'rgba(239,68,68,0.3)' : entry.dotColor.includes('amber') ? 'rgba(245,158,11,0.3)' : entry.dotColor.includes('indigo') ? 'rgba(99,102,241,0.3)' : 'rgba(100,116,139,0.2)'}`,
                          }}
                        >
                          <EntryIcon
                            type={entry.type}
                            className="w-[10px] h-[10px] text-white"
                          />
                        </div>
                      </div>

                      {/* Card */}
                      <div
                        className="flex-1 min-w-0 rounded-lg px-3 py-2 mb-1.5 transition-colors cursor-pointer hover:bg-white/[0.03] border border-transparent hover:border-white/5"
                        onClick={() => toggleCollapse(entry.id)}
                      >
                        {/* Row 1: Label + Time */}
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-[12px] font-semibold ${entry.color} leading-none`}
                          >
                            {entry.label}
                          </span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div className="flex flex-col items-end leading-none">
                              <span className="text-[9px] text-slate-600 tabular-nums">
                                {format(entry.time, 'dd MMM')}
                              </span>
                              <span className="text-[10px] text-slate-500 tabular-nums">
                                {format(entry.time, 'HH:mm:ss')}
                              </span>
                            </div>
                            {(addr || entry.subDetail) && (
                              isExpanded
                                ? <ChevronUp className="w-3 h-3 text-slate-600" />
                                : <ChevronDown className="w-3 h-3 text-slate-600" />
                            )}
                          </div>
                        </div>

                        {/* Row 2: Detail */}
                        <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          {entry.detail}
                          {entry.endTime && (
                            <span className="text-slate-600">
                              {' '}
                              · until {format(entry.endTime, 'dd MMM HH:mm:ss')}
                            </span>
                          )}
                        </div>

                        {/* Row 3: Expanded details */}
                        {isExpanded && (
                          <>
                            {addr && (
                              <div className="flex items-start gap-1.5 mt-1.5">
                                <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0 mt-[1px]" />
                                <span className="text-[11px] text-slate-300 leading-snug">
                                  {addr}
                                </span>
                              </div>
                            )}
                            {!addr && geocoding && (
                              <div className="text-[11px] text-slate-600 mt-1.5 flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full border-2 border-slate-600 border-t-slate-400 animate-spin" />
                                Resolving address...
                              </div>
                            )}
                            {!addr && !geocoding && (
                              <div className="flex items-start gap-1.5 mt-1.5">
                                <MapPin className="w-3 h-3 text-slate-600 flex-shrink-0 mt-[1px]" />
                                <span className="text-[11px] text-slate-500 leading-snug">
                                  Address unavailable
                                </span>
                              </div>
                            )}

                            <div className="mt-1 text-[10px] text-slate-600 font-mono">
                              <a
                                href={gmapsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:text-slate-400 underline underline-offset-2"
                                title="Open in Google Maps"
                              >
                                {coordsStr}
                              </a>
                            </div>

                            {p && (
                              <div className="mt-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2">
                                <div className="text-[10px] text-slate-500 uppercase mb-1 flex items-center gap-1.5">
                                  <Gauge className="w-3 h-3" />
                                  Packet details
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                                  <div className="col-span-2 flex items-center justify-between gap-2">
                                    <span className="text-slate-600">GPS Time</span>
                                    <span className="text-slate-300 font-mono break-words text-right">
                                      {format(new Date(p.gpsTime), 'dd MMM yyyy HH:mm:ss')}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-600">Speed</span>
                                    <span className="text-slate-300 font-mono">{Math.round(p.speed)} km/h</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-600">Ignition</span>
                                    <span className="text-slate-300 font-mono">{p.ignition ? 'ON' : 'OFF'}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-600">Sat</span>
                                    <span className="text-slate-300 font-mono">{p.satellites ?? '—'}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-600">Heading</span>
                                    <span className="text-slate-300 font-mono">{Math.round(p.angle)}°</span>
                                  </div>
                                  {typeof p.gsmSignal === 'number' && (
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-600">GSM</span>
                                      <span className="text-slate-300 font-mono">{p.gsmSignal}</span>
                                    </div>
                                  )}
                                  {typeof p.battery === 'number' && (
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-600">Battery</span>
                                      <span className="text-slate-300 font-mono">{p.battery}</span>
                                    </div>
                                  )}
                                  {typeof p.latency === 'number' && (
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-600">Latency</span>
                                      <span className="text-slate-300 font-mono">{p.latency}s</span>
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-600">GPS Valid</span>
                                    <span className="text-slate-300 font-mono">{p.gpsValid ? 'Yes' : 'No'}</span>
                                  </div>
                                </div>
                              </div>
                            )}
                            {entry.subDetail && (
                              <div className="text-[10px] text-slate-500 mt-1">
                                {entry.subDetail}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                    })}
                  </>
                )}

                {viewMode === 'packets' && (
                  <div className="space-y-2">
                    <div className="text-[10px] text-slate-500 flex items-center justify-between">
                      <span>{currentTrack.points.length} packets</span>
                      <span className="font-mono">
                        {format(new Date(currentTrack.points[0].gpsTime), 'dd MMM HH:mm')} →{' '}
                        {format(new Date(currentTrack.points[currentTrack.points.length - 1].gpsTime), 'dd MMM HH:mm')}
                      </span>
                    </div>

                    {/* Virtualized list (keeps browser light even for 10k+ packets) */}
                    <div ref={packetsParentRef} className="max-h-[38vh] overflow-auto pr-1">
                      <div
                        style={{
                          height: `${packetRowVirtualizer.getTotalSize()}px`,
                          width: '100%',
                          position: 'relative',
                        }}
                      >
                        {packetRowVirtualizer.getVirtualItems().map((virtualRow) => {
                          const idx = virtualRow.index;
                          const pt = currentTrack.points[idx];
                          const active = idx === selectedPacketIndex;
                          const speed = Math.round(pt.speed || 0);
                          const coordsStr = `${pt.latitude.toFixed(5)}, ${pt.longitude.toFixed(5)}`;
                          return (
                            <div
                              key={virtualRow.key}
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  pause();
                                  setSelectedPacketIndex(idx);
                                  setCurrentPointIndex(idx);
                                  focusTrackPoint(pt.latitude, pt.longitude, 16);
                                }}
                                className={`w-full text-left rounded-lg px-3 py-2 border transition-colors ${
                                  active
                                    ? 'bg-purple-500/10 border-purple-500/30'
                                    : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-[11px] text-white/80 font-mono tabular-nums">
                                      {format(new Date(pt.gpsTime), 'dd MMM yyyy HH:mm:ss')}
                                    </div>
                                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                      {coordsStr}
                                    </div>
                                  </div>
                                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                      speed > 0 ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-slate-500/10 text-slate-300 border-slate-500/20'
                                    }`}>
                                      {speed} km/h
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                      pt.ignition ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' : 'bg-slate-500/10 text-slate-300 border-slate-500/20'
                                    }`}>
                                      {pt.ignition ? 'IGN ON' : 'IGN OFF'}
                                    </span>
                                  </div>
                                </div>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Selected packet bubble */}
                    {currentTrack.points[selectedPacketIndex] && (
                      <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="text-[10px] text-slate-500 uppercase mb-2 flex items-center gap-2">
                          <Gauge className="w-3.5 h-3.5" />
                          Selected packet
                          <span className="ml-auto text-slate-600 font-mono">#{selectedPacketIndex + 1}</span>
                        </div>
                        {(() => {
                          const p = currentTrack.points[selectedPacketIndex];
                          const coordsStr = `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
                          const gmapsUrl = `https://www.google.com/maps?q=${p.latitude},${p.longitude}`;
                          return (
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                              <div className="col-span-2 flex items-center justify-between gap-2">
                                <span className="text-slate-600">GPS Time</span>
                                <span className="text-slate-300 font-mono text-right">
                                  {format(new Date(p.gpsTime), 'dd MMM yyyy HH:mm:ss')}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-600">Speed</span>
                                <span className="text-slate-300 font-mono">{Math.round(p.speed)} km/h</span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-600">Ignition</span>
                                <span className="text-slate-300 font-mono">{p.ignition ? 'ON' : 'OFF'}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-600">Sat</span>
                                <span className="text-slate-300 font-mono">{p.satellites ?? '—'}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-600">Heading</span>
                                <span className="text-slate-300 font-mono">{Math.round(p.angle)}°</span>
                              </div>
                              {typeof (p as any).gsmSignal === 'number' && (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-600">GSM</span>
                                  <span className="text-slate-300 font-mono">{(p as any).gsmSignal}</span>
                                </div>
                              )}
                              {typeof (p as any).battery === 'number' && (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-600">Battery</span>
                                  <span className="text-slate-300 font-mono">{(p as any).battery}</span>
                                </div>
                              )}
                              {typeof (p as any).latency === 'number' && (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-600">Latency</span>
                                  <span className="text-slate-300 font-mono">{(p as any).latency}s</span>
                                </div>
                              )}
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-600">GPS Valid</span>
                                <span className="text-slate-300 font-mono">{(p as any).gpsValid ? 'Yes' : 'No'}</span>
                              </div>
                              <div className="col-span-2 mt-1 text-[10px] text-slate-600 font-mono">
                                <a
                                  href={gmapsUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:text-slate-400 underline underline-offset-2"
                                  title="Open in Google Maps"
                                >
                                  {coordsStr}
                                </a>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 px-4 py-2 border-t border-white/6 text-[10px] text-slate-500 flex items-center justify-between">
            <span>{timeline.length} events</span>
            {geocoding && (
              <span className="flex items-center gap-1 text-slate-400">
                <div className="w-2.5 h-2.5 rounded-full border-2 border-slate-600 border-t-slate-400 animate-spin" />
                Geocoding...
              </span>
            )}
            {!geocoding && addresses.size > 0 && (
              <span className="text-emerald-500/60">
                {addresses.size} locations resolved
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Chip({
  icon,
  label,
  color,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${color} ${bg}`}
    >
      {icon}
      {label}
    </span>
  );
}
