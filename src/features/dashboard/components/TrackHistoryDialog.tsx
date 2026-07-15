import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Route,
  Loader2,
  AlertCircle,
  Calendar,
  MapPin,
  Navigation,
} from 'lucide-react';
import { useTrackStore, TrackMode } from '@store/trackStore';
import { format } from 'date-fns';
import { api } from '@services/api';

// Quick date presets - smaller initial ranges for faster loading
const DATE_PRESETS = [
  { label: '30 min', getValue: () => ({ start: new Date(Date.now() - 30 * 60 * 1000), end: new Date() }) },
  { label: '1 hour', getValue: () => ({ start: new Date(Date.now() - 60 * 60 * 1000), end: new Date() }) },
  { label: '2 hours', getValue: () => ({ start: new Date(Date.now() - 2 * 60 * 60 * 1000), end: new Date() }) },
  { label: '6 hours', getValue: () => ({ start: new Date(Date.now() - 6 * 60 * 60 * 1000), end: new Date() }) },
];

// Maximum points per query - keep small to avoid query plan issues
const MAX_POINTS_PER_QUERY = 5000;

export default function TrackHistoryDialog() {
  const {
    isDialogOpen,
    selectedVehicle,
    isLoading,
    error,
    trackMode,
    closeDialog,
    setLoading,
    setError,
    setCurrentTrack,
    setTrackMode,
    setOsrmRoute,
  } = useTrackStore();

  // Date/time selection - default to last 1 hour for fast initial load
  const [startDate, setStartDate] = useState(() => new Date(Date.now() - 60 * 60 * 1000));
  const [endDate, setEndDate] = useState(() => new Date());
  const [activePreset, setActivePreset] = useState<string | null>('1 hour');
  const [osrmLoading, setOsrmLoading] = useState(false);

  // Apply preset
  const applyPreset = useCallback((preset: typeof DATE_PRESETS[0]) => {
    const { start, end } = preset.getValue();
    setStartDate(start);
    setEndDate(end);
    setActivePreset(preset.label);
  }, []);

  // Handle date change
  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStartDate(new Date(e.target.value));
    setActivePreset(null);
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEndDate(new Date(e.target.value));
    setActivePreset(null);
  };

  // Fetch OSRM matched route via server proxy (avoids CORS)
  const fetchOsrmRoute = async (points: any[]): Promise<[number, number][] | null> => {
    if (points.length < 2) return null;
    
    setOsrmLoading(true);
    try {
      // Prepare coordinates for server
      const coordinates = points.map(p => ({
        lat: p.latitude,
        lon: p.longitude,
      }));
      
      console.log(`🗺️ Fetching OSRM route match for ${coordinates.length} points...`);
      
      // Use server proxy to avoid CORS
      const response = await fetch('/api/track/osrm-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates }),
      });
      
      if (!response.ok) {
        throw new Error(`OSRM request failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.success || !data.route) {
        console.warn('⚠️ OSRM could not find route:', data.error);
        return null;
      }
      
      const distKm = data.distance ? (data.distance / 1000).toFixed(2) : '?';
      const durationMin = data.duration ? Math.round(data.duration / 60) : '?';
      console.log(`✅ OSRM route: ${data.route.length} points, ${distKm} km, ${durationMin} min`);
      return data.route;
      
    } catch (err: any) {
      console.error('❌ OSRM error:', err.message);
      return null;
    } finally {
      setOsrmLoading(false);
    }
  };

  // Fetch track data
  const handleFetchTrack = async () => {
    if (!selectedVehicle) return;

    setLoading(true);
    setError(null);

    try {
      const objectId = selectedVehicle.objectId;
      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      
      console.log(`📍 Fetching track for ObjectId ${objectId} from ${startStr} to ${endStr}`);
      
      // Use the track API endpoint
      const result = await api.track.getHistory(parseInt(objectId), startStr, endStr, MAX_POINTS_PER_QUERY) as any;

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch track data');
      }

      const rawPoints: any[] = result.data || [];
      console.log(`✅ Fetched ${rawPoints.length} track points`);

      if (rawPoints.length === 0) {
        setError('No track data found for the selected time range. Try a different time period.');
        return;
      }

      // Info if track was limited
      if (result.sampled) {
        console.warn(`⚠️ Track was sampled from ${result.totalPoints} points. Select a smaller date range for complete data.`);
      }

      // Process points from API response - include telemetry for graphs
      const points = rawPoints.map((p: any) => ({
        latitude: parseFloat(p.latitude) || 0,
        longitude: parseFloat(p.longitude) || 0,
        angle: parseInt(p.angle) || 0,
        speed: parseInt(p.speed) || 0,
        altitude: parseFloat(p.altitude) || 0,
        satellites: parseInt(p.satellites) || 0,
        gpsTime: new Date(p.gpsTime),
        serverTime: p.serverTime ? new Date(p.serverTime) : undefined,
        ignition: p.ignition ?? true,
        gpsValid: p.valid === true || p.valid === 1,
        // Telemetry for graphs
        engineCut: p.engineCut ?? false,
        battery: parseFloat(p.battery) || 0,
        backupBattery: parseFloat(p.backupBattery) || 0,
        powerVolt: parseFloat(p.powerVolt) || 0,
        gsmSignal: parseInt(p.gsmSignal) || 0,
        fuelLevel: p.fuelLevel ? parseFloat(p.fuelLevel) : null,
        latency: parseInt(p.latency) || 0, // Transmission latency in seconds
      }));

      // Filter out invalid points (0,0 coordinates)
      const validPoints = points.filter((p: any) => 
        p.latitude !== 0 && p.longitude !== 0 && 
        Math.abs(p.latitude) > 0.1 && Math.abs(p.longitude) > 0.1
      );

      if (validPoints.length === 0) {
        setError('No valid GPS points found. The vehicle may not have valid GPS data for this period.');
        return;
      }

      // Calculate distance
      let totalDistance = 0;
      for (let i = 1; i < validPoints.length; i++) {
        const prev = validPoints[i - 1];
        const curr = validPoints[i];
        totalDistance += calculateDistance(
          prev.latitude, prev.longitude,
          curr.latitude, curr.longitude
        );
      }

      // Calculate duration
      const totalDuration = validPoints.length > 0
        ? validPoints[validPoints.length - 1].gpsTime.getTime() - validPoints[0].gpsTime.getTime()
        : 0;

      // Detect stops
      const stops = detectStops(validPoints);

      setCurrentTrack({
        vehicleId: selectedVehicle.objectId,
        vehicleName: selectedVehicle.name,
        startTime: startDate,
        endTime: endDate,
        points: validPoints,
        totalDistance,
        totalDuration,
        stops,
      });

      // If OSRM mode, fetch road-matched route
      if (trackMode === 'osrm') {
        const osrmRoute = await fetchOsrmRoute(validPoints);
        setOsrmRoute(osrmRoute);
      } else {
        setOsrmRoute(null);
      }

      // Auto-close dialog after loading track so user can see the map
      closeDialog(true); // Keep track data visible on map

    } catch (err: any) {
      console.error('❌ Error fetching track:', err);
      setError(err.message || 'Failed to fetch track history');
    } finally {
      setLoading(false);
    }
  };

  if (!isDialogOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-dialog flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => closeDialog()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md overflow-hidden liquid-glass rounded-2xl shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 lg-header">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-xl">
                <Route className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Track History</h2>
                <p className="text-sm text-slate-400">{selectedVehicle?.name}</p>
              </div>
            </div>
            <button
              onClick={() => closeDialog()}
              className="lg-icon-btn p-2 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Date Selection */}
          <div className="px-6 py-5 space-y-4">
            {/* Track Mode Selection */}
            <div>
              <label className="block text-xs text-slate-500 mb-2">Track Display Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTrackMode('raw')}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    trackMode === 'raw'
                      ? 'bg-purple-500/20 text-purple-400 border-2 border-purple-500/50'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  <MapPin className="w-4 h-4" />
                  <div className="text-left">
                    <div className="font-medium">Raw GPS</div>
                    <div className="text-[10px] opacity-70">Direct points</div>
                  </div>
                </button>
                <button
                  onClick={() => setTrackMode('osrm')}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    trackMode === 'osrm'
                      ? 'bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/50'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  <Navigation className="w-4 h-4" />
                  <div className="text-left">
                    <div className="font-medium">Road Snap</div>
                    <div className="text-[10px] opacity-70">OSRM matched</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Presets */}
            <div>
              <label className="block text-xs text-slate-500 mb-2">Quick Select</label>
              <div className="flex gap-2">
                {DATE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      activePreset === preset.label
                        ? 'lg-tab-active text-purple-400'
                        : 'lg-chip text-slate-400 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date/Time Inputs */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">
                  <Calendar className="w-3 h-3 inline mr-1" />
                  Start
                </label>
                <input
                  type="datetime-local"
                  value={format(startDate, "yyyy-MM-dd'T'HH:mm")}
                  onChange={handleStartDateChange}
                  className="w-full px-3 py-2.5 liquid-input rounded-xl text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">
                  <Calendar className="w-3 h-3 inline mr-1" />
                  End
                </label>
                <input
                  type="datetime-local"
                  value={format(endDate, "yyyy-MM-dd'T'HH:mm")}
                  onChange={handleEndDateChange}
                  className="w-full px-3 py-2.5 liquid-input rounded-xl text-white text-sm"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="px-4 py-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Fetch Button */}
            <button
              onClick={handleFetchTrack}
              disabled={isLoading || osrmLoading}
              className={`liquid-button w-full flex items-center justify-center gap-2 px-4 py-3 text-white rounded-xl font-medium transition-colors ${
                trackMode === 'osrm' 
                  ? 'bg-emerald-500/80 hover:bg-emerald-500 disabled:bg-emerald-500/30'
                  : 'bg-purple-500/80 hover:bg-purple-500 disabled:bg-purple-500/30'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading track...
                </>
              ) : osrmLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Matching to roads...
                </>
              ) : (
                <>
                  {trackMode === 'osrm' ? <Navigation className="w-4 h-4" /> : <Route className="w-4 h-4" />}
                  Load {trackMode === 'osrm' ? 'Road-Snapped' : 'Raw'} Track
                </>
              )}
            </button>

            <p className="text-center text-xs text-slate-500">
              {trackMode === 'osrm' ? (
                <>
                  OSRM matches GPS points to actual roads.
                  <br />
                  Best for cleaner route visualization.
                </>
              ) : (
                <>
                  Shows exact GPS coordinates as recorded.
                  <br />
                  May show off-road paths due to GPS drift.
                </>
              )}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Helper functions
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function detectStops(points: any[]) {
  const stops: any[] = [];
  const MIN_STOP_DURATION = 2 * 60 * 1000;
  let stopStart: any = null;
  
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point.speed === 0) {
      if (!stopStart) stopStart = point;
    } else {
      if (stopStart) {
        const duration = point.gpsTime.getTime() - stopStart.gpsTime.getTime();
        if (duration >= MIN_STOP_DURATION) {
          stops.push({
            latitude: stopStart.latitude,
            longitude: stopStart.longitude,
            startTime: stopStart.gpsTime,
            endTime: point.gpsTime,
            duration,
          });
        }
        stopStart = null;
      }
    }
  }
  
  return stops;
}
