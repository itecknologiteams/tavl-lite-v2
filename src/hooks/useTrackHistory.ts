import { useState, useCallback } from 'react';
import { api, isElectron } from '@services/api';
import type { TrackPoint, TrackHistory } from '@apptypes/vehicle';

interface UseTrackHistoryResult {
  loading: boolean;
  error: string | null;
  trackData: TrackHistory | null;
  fetchTrack: (objectId: string, vehicleName: string, startTime: Date, endTime: Date) => Promise<void>;
  clearTrack: () => void;
}

/**
 * Hook to fetch vehicle track history from the TAVL database
 * 
 * The Message table stores all GPS points:
 * - MessageId, ObjectId, X (lon), Y (lat), VectorSpeed, VectorAngle, 
 *   GpsTime, TimeStamp, Valid, VisibleSatelites, Altitude
 */
export const useTrackHistory = (): UseTrackHistoryResult => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackData, setTrackData] = useState<TrackHistory | null>(null);

  const fetchTrack = useCallback(async (
    objectId: string,
    vehicleName: string,
    startTime: Date,
    endTime: Date
  ) => {
    setLoading(true);
    setError(null);
    setTrackData(null);

    try {
      console.log(`📍 Fetching track for ${vehicleName} (${objectId}) from ${startTime.toISOString()} to ${endTime.toISOString()}`);

      let rawPoints: any[] = [];

      if (isElectron()) {
        // Use Electron IPC with raw query
        const startStr = startTime.toISOString().slice(0, 19).replace('T', ' ');
        const endStr = endTime.toISOString().slice(0, 19).replace('T', ' ');

        const result = await (window as any).electron.db.query(
          `SELECT 
             M.[MessageId],
             M.[Y] as Latitude,
             M.[X] as Longitude,
             M.[VectorSpeed] as Speed,
             M.[VectorAngle] as Angle,
             M.[GpsTime],
             M.[TimeStamp] as ServerTime,
             M.[Valid],
             M.[VisibleSatelites] as Satellites,
             M.[Altitude]
           FROM [tavl2].[tavl].[Message] M WITH (NOLOCK)
           WHERE M.[ObjectId] = ${objectId}
             AND M.[GpsTime] >= '${startStr}'
             AND M.[GpsTime] <= '${endStr}'
           ORDER BY M.[GpsTime] ASC`
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to fetch track data');
        }

        rawPoints = (result.data as any[]) || [];
      } else {
        // Use REST API
        const result = await api.track.getHistory(
          parseInt(objectId),
          startTime.toISOString(),
          endTime.toISOString()
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to fetch track data');
        }

        rawPoints = (result.data as any[]) || [];
      }

      console.log(`✅ Fetched ${rawPoints.length} track points`);

      if (rawPoints.length === 0) {
        setTrackData({
          vehicleId: objectId,
          vehicleName,
          startTime,
          endTime,
          points: [],
          totalDistance: 0,
          totalDuration: 0,
          stops: [],
        });
        return;
      }

      // Process track points - handle both formats
      const points: TrackPoint[] = rawPoints.map((p: any) => ({
        latitude: parseFloat(p.Latitude || p.latitude) || 0,
        longitude: parseFloat(p.Longitude || p.longitude) || 0,
        angle: parseInt(p.Angle || p.angle) || 0,
        speed: parseInt(p.Speed || p.speed) || 0,
        altitude: parseInt(p.Altitude || p.altitude) || 0,
        satellites: parseInt(p.Satellites || p.satellites) || 0,
        gpsTime: new Date(p.GpsTime || p.gpsTime),
        ignition: true, // Not available in Message table
        gpsValid: p.Valid === true || p.Valid === 1 || p.valid === true,
      }));

      // Calculate total distance using Haversine formula
      let totalDistance = 0;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        totalDistance += calculateDistance(
          prev.latitude, prev.longitude,
          curr.latitude, curr.longitude
        );
      }

      // Calculate total duration
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      const totalDuration = lastPoint.gpsTime.getTime() - firstPoint.gpsTime.getTime();

      // Detect stops (speed = 0 for more than 2 minutes)
      const stops = detectStops(points);

      setTrackData({
        vehicleId: objectId,
        vehicleName,
        startTime,
        endTime,
        points,
        totalDistance,
        totalDuration,
        stops,
      });

    } catch (err: any) {
      console.error('❌ Error fetching track:', err);
      setError(err.message || 'Failed to fetch track history');
    } finally {
      setLoading(false);
    }
  }, []);

  const clearTrack = useCallback(() => {
    setTrackData(null);
    setError(null);
  }, []);

  return {
    loading,
    error,
    trackData,
    fetchTrack,
    clearTrack,
  };
};

/**
 * Calculate distance between two GPS points using Haversine formula
 * Returns distance in kilometers
 */
function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Detect stops in track (speed = 0 for more than 2 minutes)
 */
function detectStops(points: TrackPoint[]) {
  const stops: any[] = [];
  const MIN_STOP_DURATION = 2 * 60 * 1000; // 2 minutes in ms
  
  let stopStart: TrackPoint | null = null;
  
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    
    if (point.speed === 0) {
      if (!stopStart) {
        stopStart = point;
      }
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
  
  // Check if track ends with a stop
  if (stopStart && points.length > 0) {
    const lastPoint = points[points.length - 1];
    const duration = lastPoint.gpsTime.getTime() - stopStart.gpsTime.getTime();
    if (duration >= MIN_STOP_DURATION) {
      stops.push({
        latitude: stopStart.latitude,
        longitude: stopStart.longitude,
        startTime: stopStart.gpsTime,
        endTime: lastPoint.gpsTime,
        duration,
      });
    }
  }
  
  return stops;
}
