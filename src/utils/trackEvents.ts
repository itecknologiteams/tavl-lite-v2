import type { TrackPoint } from '@apptypes/vehicle';

export interface IgnitionEvent {
  type: 'on' | 'off';
  pointIndex: number;
  latitude: number;
  longitude: number;
  timestamp: Date;
  prevStateDuration: number;
}

export interface SpeedViolation {
  startIndex: number;
  endIndex: number;
  peakSpeed: number;
  peakIndex: number;
  latitude: number;
  longitude: number;
  startTime: Date;
  endTime: Date;
  duration: number;
}

export interface IdleEvent {
  startIndex: number;
  endIndex: number;
  latitude: number;
  longitude: number;
  startTime: Date;
  endTime: Date;
  duration: number;
}

export interface JourneySummary {
  ignitionEvents: IgnitionEvent[];
  speedViolations: SpeedViolation[];
  idleEvents: IdleEvent[];
  stats: {
    movingTime: number;
    stoppedTime: number;
    idleTime: number;
    avgMovingSpeed: number;
    maxSpeed: number;
    maxSpeedIndex: number;
    movingPercentage: number;
  };
}

const MIN_IDLE_MS = 2 * 60_000;

export function analyzeTrackEvents(
  points: TrackPoint[],
  speedThreshold = 80,
): JourneySummary {
  const ignitionEvents: IgnitionEvent[] = [];
  const speedViolations: SpeedViolation[] = [];
  const idleEvents: IdleEvent[] = [];

  const empty: JourneySummary = {
    ignitionEvents, speedViolations, idleEvents,
    stats: { movingTime: 0, stoppedTime: 0, idleTime: 0, avgMovingSpeed: 0, maxSpeed: 0, maxSpeedIndex: 0, movingPercentage: 0 },
  };
  if (points.length < 2) return empty;

  let maxSpeed = 0;
  let maxSpeedIndex = 0;
  let movingTime = 0;
  let stoppedTime = 0;
  let speedSum = 0;
  let movingCount = 0;

  let lastIgnChangeIdx = 0;
  let inViolation = false;
  let violStart = 0;
  let violPeak = 0;
  let violPeakIdx = 0;
  let inIdle = false;
  let idleStart = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = i > 0 ? points[i - 1] : null;

    if (p.speed > maxSpeed) { maxSpeed = p.speed; maxSpeedIndex = i; }
    if (p.speed > 0) { speedSum += p.speed; movingCount++; }

    if (prev) {
      const dt = new Date(p.gpsTime).getTime() - new Date(prev.gpsTime).getTime();
      if (p.speed > 0) movingTime += dt; else stoppedTime += dt;
    }

    // --- Ignition changes ---
    if (prev && p.ignition !== prev.ignition) {
      const dur = new Date(p.gpsTime).getTime() - new Date(points[lastIgnChangeIdx].gpsTime).getTime();
      ignitionEvents.push({
        type: p.ignition ? 'on' : 'off',
        pointIndex: i,
        latitude: p.latitude,
        longitude: p.longitude,
        timestamp: new Date(p.gpsTime),
        prevStateDuration: dur,
      });
      lastIgnChangeIdx = i;
    }

    // --- Speed violations ---
    if (p.speed > speedThreshold) {
      if (!inViolation) {
        inViolation = true; violStart = i; violPeak = p.speed; violPeakIdx = i;
      } else if (p.speed > violPeak) {
        violPeak = p.speed; violPeakIdx = i;
      }
    } else if (inViolation) {
      pushViolation(points, violStart, i - 1, violPeak, violPeakIdx, speedViolations);
      inViolation = false;
    }

    // --- Idle detection (ignition ON, speed 0) ---
    if (p.ignition && p.speed === 0) {
      if (!inIdle) { inIdle = true; idleStart = i; }
    } else if (inIdle) {
      pushIdleIfLong(points, idleStart, i - 1, idleEvents);
      inIdle = false;
    }
  }

  if (inViolation) pushViolation(points, violStart, points.length - 1, violPeak, violPeakIdx, speedViolations);
  if (inIdle) pushIdleIfLong(points, idleStart, points.length - 1, idleEvents);

  const totalTime = movingTime + stoppedTime;
  const idleTime = idleEvents.reduce((s, e) => s + e.duration, 0);

  return {
    ignitionEvents,
    speedViolations,
    idleEvents,
    stats: {
      movingTime,
      stoppedTime,
      idleTime,
      avgMovingSpeed: movingCount > 0 ? Math.round(speedSum / movingCount) : 0,
      maxSpeed: Math.round(maxSpeed),
      maxSpeedIndex,
      movingPercentage: totalTime > 0 ? Math.round((movingTime / totalTime) * 100) : 0,
    },
  };
}

function pushViolation(
  pts: TrackPoint[], startIdx: number, endIdx: number,
  peak: number, peakIdx: number, out: SpeedViolation[],
) {
  const sp = pts[startIdx], ep = pts[endIdx], pp = pts[peakIdx];
  out.push({
    startIndex: startIdx, endIndex: endIdx, peakSpeed: peak, peakIndex: peakIdx,
    latitude: pp.latitude, longitude: pp.longitude,
    startTime: new Date(sp.gpsTime), endTime: new Date(ep.gpsTime),
    duration: new Date(ep.gpsTime).getTime() - new Date(sp.gpsTime).getTime(),
  });
}

function pushIdleIfLong(pts: TrackPoint[], startIdx: number, endIdx: number, out: IdleEvent[]) {
  const sp = pts[startIdx], ep = pts[endIdx];
  const dur = new Date(ep.gpsTime).getTime() - new Date(sp.gpsTime).getTime();
  if (dur >= MIN_IDLE_MS) {
    out.push({
      startIndex: startIdx, endIndex: endIdx,
      latitude: sp.latitude, longitude: sp.longitude,
      startTime: new Date(sp.gpsTime), endTime: new Date(ep.gpsTime), duration: dur,
    });
  }
}

export function formatDurationShort(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${totalSec}s`;
}
