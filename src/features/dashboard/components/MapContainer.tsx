import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useVehicleStore } from '@store/vehicleStore';
import { useTrackStore } from '@store/trackStore';
import { useLayoutStore } from '@store/layoutStore';
import { useCallStore } from '@store/callStore';
import { api } from '@services/api';
import { analyzeTrackEvents, formatDurationShort } from '@utils/trackEvents';
import { reverseGeocodeFull, batchReverseGeocode, getCachedAddress, getCachedAddressFull } from '@utils/geocoder';
import type { Vehicle } from '@apptypes/vehicle';
import GlobalClosurePanel from './GlobalClosurePanel';
import {
  Maximize2,
  Minimize2,
  History,
  ShieldAlert,
  Crosshair,
  Trash2,
  Pin,
  Navigation,
  Ruler,
  X,
  Layers,
  Map as MapIcon,
  Satellite,
  Grid3X3,
  Hexagon,
  Eye,
  EyeOff,
  MapPin,
  Phone,
  type LucideIcon,
} from 'lucide-react';
import { geofences, ZONE_COLORS, ZONE_LABELS, type Geofence } from '@data/geofences';

// Map layer configurations
type MapLayerId = 'dark' | 'light' | 'street' | 'satellite' | 'hybrid';

interface MapLayerConfig {
  id: MapLayerId;
  name: string;
  url: string;
  subdomains?: string;
  maxZoom: number;
  attribution?: string;
  icon: LucideIcon;
}

const MAP_LAYERS: MapLayerConfig[] = [
  {
    id: 'dark',
    name: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 19,
    icon: MapIcon,
  },
  {
    id: 'light',
    name: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 19,
    icon: MapIcon,
  },
  {
    id: 'street',
    name: 'Street',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 19,
    icon: MapIcon,
  },
  {
    id: 'satellite',
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 18,
    icon: Satellite,
  },
  {
    id: 'hybrid',
    name: 'Hybrid',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 18,
    icon: Satellite,
  },
];

// Get saved layer from localStorage
const getSavedLayer = (): MapLayerId => {
  try {
    const saved = localStorage.getItem('tavl-map-layer');
    if (saved && MAP_LAYERS.some(l => l.id === saved)) {
      return saved as MapLayerId;
    }
  } catch {}
  return 'dark';
};

const STATUS_COLORS: Record<string, string> = {
  moving: '#10B981',
  idle: '#F59E0B',
  parked: '#3B82F6',
  offline: '#6B7280',
  'gps-invalid': '#EC4899',
  alarm: '#EF4444',
};

const STATUS_LABELS: Record<string, string> = {
  moving: 'Moving',
  idle: 'Idle',
  parked: 'Parked',
  offline: 'Offline',
  'gps-invalid': 'No GPS',
  alarm: 'Alarm',
};

const toDMS = (decimal: number, isLat: boolean): string => {
  const abs = Math.abs(decimal);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  const dir = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
  return `${d}° ${m}' ${s}" ${dir}`;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatDateTime24 = (raw: any): string => {
  if (!raw) return 'N/A';
  if (typeof raw === 'string') {
    const s = raw.trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (m) return `${m[1]} ${m[2]}`;
  }
  try {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(d.getTime())) return 'N/A';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  } catch {
    return 'N/A';
  }
};

// Build the vehicle popup HTML from the *current* vehicle data. Module-level so
// the marker-update loop can rebuild on every telemetry tick.
function buildVehiclePopupHtml(vehicle: any, addrNow?: string, addrSnap?: string): string {
  const lat = vehicle.gpsData.latitude;
  const lng = vehicle.gpsData.longitude;
  const color = STATUS_COLORS[vehicle.status] || STATUS_COLORS.offline;
  const speed = vehicle.gpsData.speed || 0;
  const angle = vehicle.gpsData.angle || 0;
  const sats = vehicle.gpsData.satellites || 0;
  const time = vehicle.gpsData.gpsTime ? formatDateTime24(vehicle.gpsData.gpsTime) : 'N/A';
  const statusLabel = STATUS_LABELS[vehicle.status] || vehicle.status;
  const coords = `${toDMS(lat, true)}, ${toDMS(lng, false)}`;
  const ign = vehicle.gpsData.Ignition ?? vehicle.ioStatus?.ignition;
  const batt = vehicle.gpsData.Battery ?? vehicle.ioStatus?.battery;
  const gsm = vehicle.gpsData.GsmSignal ?? vehicle.ioStatus?.gsmSignal;
  const satsColor = sats >= 6 ? '#10B981' : sats >= 3 ? '#F59E0B' : '#EF4444';

  const snap = vehicle.meta?.alertSnapshot;
  const snapLat = snap?.latitude;
  const snapLng = snap?.longitude;
  const hasSnap = !!(snap && typeof snapLat === 'number' && typeof snapLng === 'number' && !isNaN(snapLat) && !isNaN(snapLng) && (snapLat !== 0 || snapLng !== 0));

  return `
      <div style="min-width:270px;max-width:310px;font-family:system-ui,-apple-system,sans-serif;background:rgba(15,23,42,0.97);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:14px;color:white;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.03);">
        <div style="padding:12px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="width:36px;height:36px;background:${color}15;border:1px solid ${color}30;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="${color}"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${vehicle.name}</div>
            <div style="font-size:11px;color:rgba(148,163,184,0.7);">${vehicle.registrationNumber || 'Unregistered'}</div>
          </div>
          <div style="padding:3px 10px;background:${color}18;border:1px solid ${color}35;border-radius:20px;font-size:10px;font-weight:700;color:${color};text-transform:uppercase;white-space:nowrap;letter-spacing:0.5px;">
            ${statusLabel}
          </div>
        </div>
        ${hasSnap ? `
        <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;">
            <div style="font-size:10px;color:rgba(148,163,184,0.55);text-transform:uppercase;letter-spacing:0.6px;">
              Alert snapshot (row values at GPS time)
            </div>
            ${vehicle.meta?.source === 'alert_inbox' ? `
              <button
                data-action="open-info"
                data-object-id="${vehicle.objectId}"
                style="cursor:pointer;border:1px solid rgba(99,102,241,0.35);background:rgba(99,102,241,0.12);color:#A5B4FC;font-size:10px;font-weight:700;padding:4px 8px;border-radius:8px;white-space:nowrap;"
              >
                Information
              </button>
            ` : ''}
          </div>
          <div style="display:grid;grid-template-columns:88px 1fr;gap:4px 10px;font-size:12px;line-height:1.35;">
            <div style="color:rgba(148,163,184,0.55);">Name</div>
            <div style="color:rgba(255,255,255,0.92);font-weight:600;">${vehicle.registrationNumber || vehicle.name}</div>
            <div style="color:rgba(148,163,184,0.55);">Speed</div>
            <div style="color:rgba(255,255,255,0.92);">${Number(snap?.speed ?? 0).toFixed(0)} Km/h</div>
            <div style="color:rgba(148,163,184,0.55);">GPS Time</div>
            <div style="color:rgba(255,255,255,0.92);font-family:ui-monospace,SFMono-Regular,monospace;">${formatDateTime24(snap?.gpsTimeRaw)}</div>
            <div style="color:rgba(148,163,184,0.55);">Coordinates</div>
            <div style="color:rgba(255,255,255,0.92);font-family:ui-monospace,SFMono-Regular,monospace;">${Number(snapLat).toFixed(6)}, ${Number(snapLng).toFixed(6)}</div>
            <div style="color:rgba(148,163,184,0.55);">Satellites</div>
            <div style="color:rgba(255,255,255,0.92);">${snap?.satellites ? snap.satellites : '—'}</div>
            <div style="color:rgba(148,163,184,0.55);">Location</div>
            <div style="color:rgba(255,255,255,0.85);">
              ${addrSnap || '<span style="color:rgba(148,163,184,0.4);font-style:italic;">Resolving address…</span>'}
            </div>
          </div>
        </div>
        ` : ''}
        <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex;align-items:flex-start;gap:6px;min-height:18px;">
            <span style="flex-shrink:0;margin-top:1px;font-size:12px;">📍</span>
            <span style="font-size:12px;color:rgba(255,255,255,0.85);line-height:1.4;">
              ${addrNow || '<span style="color:rgba(148,163,184,0.4);font-style:italic;">Resolving address…</span>'}
            </span>
          </div>
          <div style="font-size:10px;color:rgba(148,163,184,0.4);font-family:ui-monospace,SFMono-Regular,monospace;letter-spacing:0.4px;padding-left:22px;margin-top:3px;">
            ${coords}
          </div>
        </div>
        <div style="padding:8px 14px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="background:rgba(255,255,255,0.04);padding:6px;border-radius:8px;text-align:center;">
            <div style="font-size:8px;color:rgba(148,163,184,0.45);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Speed</div>
            <div style="font-size:16px;font-weight:800;color:${speed > 0 ? '#10B981' : 'rgba(255,255,255,0.3)'};">${speed.toFixed(0)}<span style="font-size:9px;font-weight:500;color:rgba(148,163,184,0.4);"> km/h</span></div>
          </div>
          <div style="background:rgba(255,255,255,0.04);padding:6px;border-radius:8px;text-align:center;">
            <div style="font-size:8px;color:rgba(148,163,184,0.45);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Heading</div>
            <div style="font-size:16px;font-weight:800;color:rgba(255,255,255,0.6);">${angle}<span style="font-size:9px;font-weight:500;color:rgba(148,163,184,0.4);">°</span></div>
          </div>
          <div style="background:rgba(255,255,255,0.04);padding:6px;border-radius:8px;text-align:center;">
            <div style="font-size:8px;color:rgba(148,163,184,0.45);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Satellites</div>
            <div style="font-size:16px;font-weight:800;color:${satsColor};">${sats}</div>
          </div>
        </div>
        <div style="padding:8px 14px;background:rgba(0,0,0,0.12);display:flex;align-items:center;gap:8px;font-size:10px;flex-wrap:wrap;">
          ${ign !== undefined ? `<span style="display:inline-flex;align-items:center;gap:3px;color:${ign ? '#10B981' : '#EF4444'};font-weight:600;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>${ign ? 'ON' : 'OFF'}</span><span style="color:rgba(255,255,255,0.08);">|</span>` : ''}
          ${batt !== undefined && batt > 0 ? `<span style="color:rgba(148,163,184,0.55);">🔋 ${batt.toFixed(1)}V</span><span style="color:rgba(255,255,255,0.08);">|</span>` : ''}
          ${gsm !== undefined && gsm > 0 ? `<span style="color:rgba(148,163,184,0.55);">📡 ${gsm}</span><span style="color:rgba(255,255,255,0.08);">|</span>` : ''}
          <span style="color:rgba(148,163,184,0.55);margin-left:auto;font-weight:500;">⏱ ${time}</span>
        </div>
      </div>`;
}

// Wire the "Information" button inside the alert-inbox popup. Called both
// on initial popupopen and whenever popup content is rebuilt with fresh
// telemetry so the click handler doesn't go stale.
function wireInfoButton(marker: L.Marker, vehicleObjectId: string, fallbackVehicle: any) {
  const popupEl = marker.getPopup()?.getElement?.() as HTMLElement | null;
  if (!popupEl) return;
  const btn = popupEl.querySelector('button[data-action="open-info"]') as HTMLButtonElement | null;
  if (!btn) return;
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const st = useVehicleStore.getState();
    const best =
      st.pinnedVehicleData?.get?.(vehicleObjectId) ||
      st.vehicles?.get?.(vehicleObjectId) ||
      fallbackVehicle;
    st.selectVehicle(best);
    setTimeout(() => { try { marker.openPopup(); } catch {} }, 0);
  };
}

// Speed-based color gradient for track
const getSpeedColor = (speed: number): string => {
  if (speed === 0) return '#6B7280'; // Gray - stopped
  if (speed < 20) return '#3B82F6'; // Blue - slow
  if (speed < 40) return '#10B981'; // Green - normal
  if (speed < 60) return '#F59E0B'; // Amber - moderate
  if (speed < 80) return '#F97316'; // Orange - fast
  return '#EF4444'; // Red - very fast
};

// GSM signal strength color - auto-detects scale (1-5 or 0-31 CSQ)
const getGsmColor = (signal: number, maxSignal: number): { color: string; label: string } => {
  // Normalize to percentage based on detected scale
  const percentage = maxSignal <= 5 
    ? (signal / 5) * 100   // 1-5 scale
    : (signal / 31) * 100; // 0-31 CSQ scale
  
  if (percentage <= 20) return { color: '#EF4444', label: 'Poor' };     // Red
  if (percentage <= 40) return { color: '#F97316', label: 'Weak' };     // Orange
  if (percentage <= 60) return { color: '#F59E0B', label: 'Fair' };     // Amber
  if (percentage <= 80) return { color: '#84CC16', label: 'Good' };     // Lime
  return { color: '#10B981', label: 'Excellent' };                       // Green
};

// GSM signal to coverage halo radius (in meters) based on CSQ signal propagation
const getGsmHaloRadius = (signal: number, maxSignal: number): number => {
  // Normalize to percentage based on detected scale
  const percentage = maxSignal <= 5 
    ? (signal / 5) * 100   // 1-5 scale
    : (signal / 31) * 100; // 0-31 CSQ scale
  
  // Map percentage to radius (50m minimum, 1500m maximum)
  // Based on rough cellular signal propagation estimates
  const minRadius = 50;   // Poor signal - minimal coverage
  const maxRadius = 1500; // Excellent signal - wide coverage
  
  return minRadius + (percentage / 100) * (maxRadius - minRadius);
};

// Latency color based on transmission delay (seconds)
const getLatencyColor = (latency: number): { color: string; label: string } => {
  if (latency <= 3) return { color: '#10B981', label: 'Excellent' };   // Green - Real-time
  if (latency <= 10) return { color: '#84CC16', label: 'Good' };        // Lime
  if (latency <= 30) return { color: '#F59E0B', label: 'Fair' };        // Amber
  if (latency <= 60) return { color: '#F97316', label: 'Delayed' };     // Orange
  if (latency <= 120) return { color: '#EF4444', label: 'Slow' };       // Red
  return { color: '#DC2626', label: 'Very Slow' };                      // Dark Red
};

// Calculate distance between two points using Haversine formula (returns meters)
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Format distance for display
const formatDistance = (meters: number): string => {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
};

// ─── POI LAYER ────────────────────────────────────────────────────────────────

interface POIItem {
  name: string;
  category: string;
  lat: number;
  lng: number;
  distance: number;
}

// Category → { color, emoji, label, overpass filter }
const POI_CATEGORIES: Record<string, { color: string; emoji: string; label: string }> = {
  hospital:   { color: '#ef4444', emoji: '🏥', label: 'Hospital / Clinic' },
  pharmacy:   { color: '#ec4899', emoji: '💊', label: 'Pharmacy' },
  police:     { color: '#3b82f6', emoji: '🚔', label: 'Police' },
  fuel:       { color: '#f59e0b', emoji: '⛽', label: 'Fuel / CNG' },
  bank:       { color: '#10b981', emoji: '🏦', label: 'Bank / ATM' },
  restaurant: { color: '#f97316', emoji: '🍽️', label: 'Restaurant / Food' },
  mosque:     { color: '#8b5cf6', emoji: '🕌', label: 'Mosque' },
  school:     { color: '#84cc16', emoji: '🏫', label: 'School / University' },
  shop:       { color: '#06b6d4', emoji: '🛒', label: 'Shop / Market' },
  hotel:      { color: '#6366f1', emoji: '🏨', label: 'Hotel' },
};

// Classify an Overpass element's tags into one of our categories
const classifyPOI = (tags: Record<string, string>): string | null => {
  const a = tags.amenity || '';
  const s = tags.shop || '';
  const t = tags.tourism || '';
  if (/hospital|clinic|doctors/.test(a)) return 'hospital';
  if (a === 'pharmacy') return 'pharmacy';
  if (a === 'police') return 'police';
  if (a === 'fuel' || a === 'compressed_natural_gas') return 'fuel';
  if (/bank|atm/.test(a)) return 'bank';
  if (/restaurant|fast_food|cafe|food_court|juice_bar/.test(a)) return 'restaurant';
  if (a === 'place_of_worship' || a === 'mosque' || tags.religion === 'muslim') return 'mosque';
  if (/school|university|college|kindergarten/.test(a)) return 'school';
  if (/supermarket|convenience|mall|marketplace|general|department_store/.test(s)) return 'shop';
  if (/hotel|motel|guest_house/.test(t)) return 'hotel';
  return null;
};

// Cache keyed by "lat3,lng3" (~111m grid cell) → POIItem[]
const poiLayerCache = new Map<string, POIItem[]>();

const fetchPOIsNear = async (lat: number, lng: number): Promise<POIItem[]> => {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (poiLayerCache.has(key)) return poiLayerCache.get(key)!;

  const query = `
    [out:json][timeout:20];
    (
      nwr["amenity"~"hospital|clinic|doctors|pharmacy|police|bank|atm|restaurant|fast_food|cafe|fuel|compressed_natural_gas|school|university|college|place_of_worship|mosque"](around:1000,${lat},${lng});
      nwr["shop"~"supermarket|convenience|mall|marketplace|general|department_store"](around:1000,${lat},${lng});
      nwr["tourism"~"hotel|motel|guest_house"](around:1000,${lat},${lng});
    );
    out center 120;
  `;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) { poiLayerCache.set(key, []); return []; }

    const data = await res.json();
    const items: POIItem[] = [];

    for (const el of (data.elements || [])) {
      const name = el.tags?.name;
      if (!name) continue;
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      if (!elLat || !elLng) continue;
      const category = classifyPOI(el.tags || {});
      if (!category) continue;
      const distance = Math.round(calculateDistance(lat, lng, elLat, elLng));
      items.push({ name, category, lat: elLat, lng: elLng, distance });
    }

    // Sort by distance, keep top 10 per category
    const byCategory: Record<string, POIItem[]> = {};
    for (const item of items) {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    }
    const result: POIItem[] = [];
    for (const cat of Object.keys(byCategory)) {
      byCategory[cat].sort((a, b) => a.distance - b.distance);
      result.push(...byCategory[cat].slice(0, 10));
    }

    poiLayerCache.set(key, result);
    return result;
  } catch {
    poiLayerCache.set(key, []);
    return [];
  }
};

const createPOIMarker = (item: POIItem): L.Marker => {
  const cfg = POI_CATEGORIES[item.category] || { color: '#94a3b8', emoji: '📍', label: item.category };
  const icon = L.divIcon({
    className: '',
    html: `
      <div style="
        width:34px;height:34px;border-radius:50%;
        background:${cfg.color};
        border:2.5px solid rgba(255,255,255,0.85);
        box-shadow:0 2px 8px rgba(0,0,0,0.45);
        display:flex;align-items:center;justify-content:center;
        font-size:16px;line-height:1;
        cursor:pointer;
      ">${cfg.emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });

  const marker = L.marker([item.lat, item.lng], { icon, zIndexOffset: 500 });
  marker.bindPopup(`
    <div style="font-family:Inter,sans-serif;min-width:140px">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">${item.name}</div>
      <div style="font-size:11px;color:#94a3b8">${cfg.label} &nbsp;·&nbsp; ${item.distance < 1000 ? item.distance + 'm' : (item.distance / 1000).toFixed(1) + 'km'}</div>
    </div>
  `, { maxWidth: 220, className: 'poi-popup' });

  return marker;
};

// Format duration for display
const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

export default function MapContainer() {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const markerClusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const initialFitDone = useRef(false);
  const [clusteringEnabled, setClusteringEnabled] = useState(true);
  
  // Track refs
  const trackPolylineRef = useRef<L.Polyline | null>(null);
  const trackMarkersRef = useRef<L.Marker[]>([]);
  const stopMarkersRef = useRef<L.Marker[]>([]);
  const playbackMarkerRef = useRef<L.Marker | null>(null);
  const gsmMarkersRef = useRef<L.Marker[]>([]);
  const latencyMarkersRef = useRef<L.Marker[]>([]);
  const ignitionMarkersRef = useRef<L.Marker[]>([]);
  const speedEventMarkersRef = useRef<L.Marker[]>([]);
  const idleMarkersRef = useRef<L.Marker[]>([]);
  
  // Vehicle trail refs (for moving vehicles) - stores array of polyline segments per vehicle
  const vehicleTrailsRef = useRef<Map<string, L.Polyline[]>>(new Map());
  
  // Alert locate refs (incident scene reconstruction)
  const alertOriginMarkerRef = useRef<L.Marker | null>(null);
  const alertTrackSegmentsRef = useRef<L.Polyline[]>([]);
  const alertInfoMarkerRef = useRef<L.Marker | null>(null);
  const alertDashedLineRef = useRef<L.Polyline | null>(null);

  // Distance measurement state and refs
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Array<{ lat: number; lng: number }>>([]);
  const measureMarkersRef = useRef<L.Marker[]>([]);
  const measurePolylinesRef = useRef<L.Polyline[]>([]);
  const measureLabelsRef = useRef<L.Marker[]>([]);

  // POI layer state
  const [showPOI, setShowPOI] = useState(false);
  const [poiLoading, setPoiLoading] = useState(false);
  const poiMarkersRef = useRef<L.Marker[]>([]);
  const poiCircleRef = useRef<L.Circle | null>(null);

  // Map layer state
  const [selectedLayer, setSelectedLayer] = useState<MapLayerId>(getSavedLayer);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);
  
  // Geofence state
  const [showGeofences, setShowGeofences] = useState(false);
  const [showGeofenceMenu, setShowGeofenceMenu] = useState(false);
  const [geofenceFilters, setGeofenceFilters] = useState<Record<Geofence['type'], boolean>>({
    customer: true,
    operational: true,
    alert: true,
    restricted: true,
  });
  const geofencePolygonsRef = useRef<Map<string, L.Polygon>>(new Map());
  const geofenceLabelsRef = useRef<Map<string, L.Marker>>(new Map());
  
  const vehicles = useVehicleStore((state) => state.vehicles);
  const pinnedVehicles = useVehicleStore((state) => state.pinnedVehicles);
  const pinnedVehicleData = useVehicleStore((state) => state.pinnedVehicleData);
  const selectedVehicle = useVehicleStore((state) => state.selectedVehicle);
  const focusedVehicle = useVehicleStore((state) => state.focusedVehicle);
  const mapExpanded = useVehicleStore((state) => state.mapExpanded);
  const vehicleTrails = useVehicleStore((state) => state.vehicleTrails);
  const showTrails = useVehicleStore((state) => state.showTrails);
  
  const rightPanelWidth = useLayoutStore((s) => s.rightPanelWidth);
  const prevRightPanelRef = useRef(0);

  // Softphone toggle lives in the map control rail (avoids the floating phone
  // overlapping these buttons). The button mirrors live call/registration state.
  const softphoneVisible = useCallStore((s) => s.softphoneVisible);
  const toggleSoftphone = useCallStore((s) => s.toggleSoftphone);
  const callMode = useCallStore((s) => s.callMode);
  const registrationState = useCallStore((s) => s.registrationState);
  const amiConnected = useCallStore((s) => s.amiConnected);
  const incomingCallPopup = useCallStore((s) => s.incomingCallPopup);
  const currentCall = useCallStore((s) => s.currentCall);
  const phoneConnected = callMode === 'ami' ? amiConnected : registrationState === 'registered';
  const phoneRinging = incomingCallPopup || currentCall?.state === 'ringing';
  const phoneOnCall = currentCall?.state === 'answered' || currentCall?.state === 'on_hold';

  const selectVehicle = useVehicleStore((state) => state.selectVehicle);
  const unpinVehicle = useVehicleStore((state) => state.unpinVehicle);
  const toggleMapExpanded = useVehicleStore((state) => state.toggleMapExpanded);
  const clearPinnedVehicles = useVehicleStore((state) => state.clearPinnedVehicles);
  const focusOnVehicle = useVehicleStore((state) => state.focusOnVehicle);
  const toggleShowTrails = useVehicleStore((state) => state.toggleShowTrails);
  const clearAllTrails = useVehicleStore((state) => state.clearAllTrails);
  const alertLocate = useVehicleStore((state) => state.alertLocate);
  
  // Track store
  const currentTrack = useTrackStore((state) => state.currentTrack);
  const currentPointIndex = useTrackStore((state) => state.currentPointIndex);
  const focusedTrackPoint = useTrackStore((state) => state.focusedTrackPoint);
  const clearFocusedTrackPoint = useTrackStore((state) => state.clearFocusedTrackPoint);
  const showStops = useTrackStore((state) => state.showStops);
  const showSpeedColors = useTrackStore((state) => state.showSpeedColors);
  const showGsmMarkers = useTrackStore((state) => state.showGsmMarkers);
  const showLatencyMarkers = useTrackStore((state) => state.showLatencyMarkers);
  const showIgnitionEvents = useTrackStore((state) => state.showIgnitionEvents);
  const showSpeedEvents = useTrackStore((state) => state.showSpeedEvents);
  const showIdleEvents = useTrackStore((state) => state.showIdleEvents);
  const speedViolationThreshold = useTrackStore((state) => state.speedViolationThreshold);
  const trackMode = useTrackStore((state) => state.trackMode);
  const osrmRoute = useTrackStore((state) => state.osrmRoute);

  // Get vehicles to display on map:
  // - pinned vehicles (persisted)
  // - plus a focused Alert Inbox locate vehicle (no auto-pin)
  const displayVehicles = useMemo(() => {
    const pinned: Vehicle[] = [];
    let skipped = 0;
    
    pinnedVehicles.forEach((id) => {
      // First check pinnedVehicleData (persisted), then vehicles map (from search)
      const fromPinnedData = pinnedVehicleData.get(id);
      const fromVehicles = vehicles.get(id);
      const vehicle = fromPinnedData || fromVehicles;
      
      if (!vehicle) {
        console.warn(`⚠️ Vehicle ${id} not found in either store`);
        skipped++;
        return;
      }
      
      if (!vehicle.gpsData) {
        console.warn(`⚠️ Vehicle ${vehicle.name || id} has no gpsData`);
        skipped++;
        return;
      }
      
      const lat = vehicle.gpsData.latitude;
      const lng = vehicle.gpsData.longitude;
      
      // Ensure vehicle has valid GPS coordinates
      if (typeof lat !== 'number' || typeof lng !== 'number' ||
          isNaN(lat) || isNaN(lng) ||
          (lat === 0 && lng === 0)) {
        console.warn(`⚠️ Vehicle ${vehicle.name || id} has invalid coords: ${lat}, ${lng}`);
        skipped++;
        return;
      }
      
      pinned.push(vehicle);
    });
    
    // If Alert Inbox "Locate" focuses a synthetic vehicle snapshot, show it without pinning.
    if (focusedVehicle?.meta?.source === 'alert_inbox' && focusedVehicle?.gpsData) {
      const id = focusedVehicle.objectId;
      const lat = focusedVehicle.gpsData.latitude;
      const lng = focusedVehicle.gpsData.longitude;
      const valid =
        typeof lat === 'number' && typeof lng === 'number' &&
        !isNaN(lat) && !isNaN(lng) &&
        !(lat === 0 && lng === 0);

      if (id && valid) {
        const idx = pinned.findIndex(v => v.objectId === id);
        if (idx >= 0) {
          // Prefer the focused version so the popup includes the alert snapshot + "Information" button.
          pinned[idx] = { ...pinned[idx], ...focusedVehicle, meta: focusedVehicle.meta };
        } else {
          pinned.push(focusedVehicle);
        }
      }
    }

    console.log(`📍 Display vehicles: ${pinned.length} valid, ${skipped} skipped, ${pinnedVehicles.size} total pinned`);
    console.log(`📍 pinnedVehicleData has ${pinnedVehicleData.size} entries, vehicles has ${vehicles.size} entries`);
    
    return pinned;
  }, [vehicles, pinnedVehicles, pinnedVehicleData, focusedVehicle]);

  // Calculate trail statistics for all vehicles
  const trailStats = useMemo(() => {
    let totalDistance = 0;
    let oldestTimestamp = Date.now();
    let newestTimestamp = 0;
    let totalPoints = 0;
    let maxSpeed = 0;
    let avgSpeed = 0;
    let speedSum = 0;
    let speedCount = 0;

    vehicleTrails.forEach((trail) => {
      if (trail.length < 2) return;
      
      totalPoints += trail.length;
      
      for (let i = 0; i < trail.length; i++) {
        const point = trail[i];
        
        // Track timestamps
        if (point.timestamp < oldestTimestamp) oldestTimestamp = point.timestamp;
        if (point.timestamp > newestTimestamp) newestTimestamp = point.timestamp;
        
        // Track speed
        if (point.speed > 0) {
          speedSum += point.speed;
          speedCount++;
          if (point.speed > maxSpeed) maxSpeed = point.speed;
        }
        
        // Calculate distance to next point
        if (i < trail.length - 1) {
          const nextPoint = trail[i + 1];
          totalDistance += calculateDistance(point.lat, point.lng, nextPoint.lat, nextPoint.lng);
        }
      }
    });

    avgSpeed = speedCount > 0 ? Math.round(speedSum / speedCount) : 0;
    const duration = newestTimestamp > oldestTimestamp ? newestTimestamp - oldestTimestamp : 0;

    return {
      totalDistance,
      duration,
      totalPoints,
      maxSpeed: Math.round(maxSpeed),
      avgSpeed,
      vehicleCount: vehicleTrails.size,
    };
  }, [vehicleTrails]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [33.6844, 73.0479], // Islamabad default
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
    });

    // Add initial tile layer based on saved preference
    const initialLayer = MAP_LAYERS.find(l => l.id === getSavedLayer()) || MAP_LAYERS[0];
    const tileLayer = L.tileLayer(initialLayer.url, {
      maxZoom: initialLayer.maxZoom,
      subdomains: initialLayer.subdomains || '',
    }).addTo(map);
    tileLayerRef.current = tileLayer;
    
    // Add labels for hybrid mode
    if (initialLayer.id === 'hybrid') {
      const labels = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        pane: 'overlayPane',
      }).addTo(map);
      labelLayerRef.current = labels;
    }

    mapRef.current = map;
    
    // Initialize marker cluster group with custom styling
    const clusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 50,
      disableClusteringAtZoom: 16,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        let size = 'small';
        let sizeClass = 'w-10 h-10 text-sm';
        
        if (count > 100) {
          size = 'large';
          sizeClass = 'w-14 h-14 text-base';
        } else if (count > 50) {
          size = 'medium';
          sizeClass = 'w-12 h-12 text-sm';
        }
        
        return L.divIcon({
          html: `<div class="cluster-marker ${sizeClass} flex items-center justify-center rounded-full bg-cyan-500/90 text-white font-bold border-2 border-white shadow-lg">${count}</div>`,
          className: `custom-cluster-${size}`,
          iconSize: L.point(40, 40),
        });
      },
    });
    clusterGroup.addTo(map);
    markerClusterRef.current = clusterGroup;
    
    // Clear any stale marker references
    markersRef.current.clear();
    initialFitDone.current = false;
    
    console.log('🗺️ Map initialized with layer:', initialLayer.name);

    return () => {
      if (markerClusterRef.current) {
        markerClusterRef.current.clearLayers();
        markerClusterRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Close layer menu when clicking outside
  useEffect(() => {
    if (!showLayerMenu) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.layer-selector')) {
        setShowLayerMenu(false);
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showLayerMenu]);

  // Close geofence menu on click outside
  useEffect(() => {
    if (!showGeofenceMenu) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.geofence-selector')) {
        setShowGeofenceMenu(false);
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showGeofenceMenu]);

  // Handle layer switching
  const switchLayer = useCallback((layerId: MapLayerId) => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    const layerConfig = MAP_LAYERS.find(l => l.id === layerId);
    if (!layerConfig) return;
    
    // Remove existing tile layer
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }
    
    // Remove label layer if exists
    if (labelLayerRef.current) {
      map.removeLayer(labelLayerRef.current);
      labelLayerRef.current = null;
    }
    
    // Add new tile layer
    const newTileLayer = L.tileLayer(layerConfig.url, {
      maxZoom: layerConfig.maxZoom,
      subdomains: layerConfig.subdomains || '',
    }).addTo(map);
    tileLayerRef.current = newTileLayer;
    
    // Add labels for hybrid mode
    if (layerId === 'hybrid') {
      const labels = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        pane: 'overlayPane',
      }).addTo(map);
      labelLayerRef.current = labels;
    }
    
    // Save preference
    try {
      localStorage.setItem('tavl-map-layer', layerId);
    } catch {}
    
    setSelectedLayer(layerId);
    setShowLayerMenu(false);
    console.log('🗺️ Switched to layer:', layerConfig.name);
  }, []);

  // Create marker for vehicle
  const createMarker = useCallback((vehicle: Vehicle, isSelected: boolean) => {
    if (!vehicle.gpsData) {
      console.warn(`⚠️ No GPS data for vehicle ${vehicle.name}`);
      return null;
    }
    
    const lat = vehicle.gpsData.latitude;
    const lng = vehicle.gpsData.longitude;
    
    // Validate coordinates
    if (typeof lat !== 'number' || typeof lng !== 'number' || 
        isNaN(lat) || isNaN(lng) || 
        (lat === 0 && lng === 0)) {
      console.warn(`⚠️ Invalid coordinates for ${vehicle.name}: ${lat}, ${lng}`);
      return null;
    }

    const color = STATUS_COLORS[vehicle.status] || STATUS_COLORS.offline;
    const size = isSelected ? 40 : 32;

    const marker = L.marker(
      [vehicle.gpsData.latitude, vehicle.gpsData.longitude],
      {
        icon: L.divIcon({
          className: 'vehicle-marker',
          html: `
            <div class="marker-wrapper" style="transform: rotate(${vehicle.gpsData.angle}deg)">
              <div class="marker-inner" style="
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                border: ${isSelected ? '3px solid white' : '2px solid rgba(255,255,255,0.5)'};
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 20px ${color}40;
                transition: all 0.3s ease;
              ">
                <svg width="${size * 0.5}" height="${size * 0.5}" viewBox="0 0 24 24" fill="white">
                  <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
                </svg>
              </div>
              ${isSelected ? `<div class="marker-ring" style="
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: ${size + 16}px;
                height: ${size + 16}px;
                border: 2px solid ${color};
                border-radius: 50%;
                animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
              "></div>` : ''}
            </div>
          `,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        zIndexOffset: isSelected ? 1000 : 0,
      }
    );

    // Popup — built from current vehicle telemetry. Module-level helper so
    // the update loop can rebuild this on every GPS tick (see displayVehicles
    // useEffect below) and keep the popup data in sync with the live panel.
    const snap = vehicle.meta?.alertSnapshot;
    const snapLat = snap?.latitude;
    const snapLng = snap?.longitude;
    const hasSnap = !!(snap && typeof snapLat === 'number' && typeof snapLng === 'number' && !isNaN(snapLat) && !isNaN(snapLng) && (snapLat !== 0 || snapLng !== 0));
    const cachedNow = getCachedAddressFull(lat, lng);
    const cachedSnap = hasSnap ? getCachedAddressFull(Number(snapLat), Number(snapLng)) : undefined;
    marker.bindPopup(buildVehiclePopupHtml(vehicle, cachedNow, cachedSnap), {
      className: 'custom-popup',
      closeButton: true,
      autoClose: false,
      closeOnClick: false,
      closeOnEscapeKey: false,
      maxWidth: 320,
    });
    // Track snapshot/meta on marker for update comparisons
    (marker as any).__metaSource = vehicle.meta?.source;
    (marker as any).__hasAlertSnapshot = !!vehicle.meta?.alertSnapshot;

    // Attach a rebuild function so the displayVehicles update loop can refresh
    // the popup body (speed/heading/sats/battery/GPS time…) on every telemetry
    // tick — otherwise the popup stays frozen at the values from when it was
    // first bound. Uses the latest vehicle data passed in by the caller.
    (marker as any).__rebuildPopup = (freshVehicle: any) => {
      const v = freshVehicle || vehicle;
      const flat = v.gpsData?.latitude;
      const flng = v.gpsData?.longitude;
      const nowAddr = (typeof flat === 'number' && typeof flng === 'number') ? getCachedAddressFull(flat, flng) : undefined;
      const fsnap = v.meta?.alertSnapshot;
      const snapAddr = (fsnap && typeof fsnap.latitude === 'number' && typeof fsnap.longitude === 'number')
        ? getCachedAddressFull(fsnap.latitude, fsnap.longitude)
        : undefined;
      marker.setPopupContent(buildVehiclePopupHtml(v, nowAddr, snapAddr));
      // setPopupContent replaces inner HTML — re-wire the Info button if open.
      wireInfoButton(marker, v.objectId, v);
    };

    marker.on('popupopen', () => {
      wireInfoButton(marker, vehicle.objectId, vehicle);
      const nowMissing = !getCachedAddressFull(lat, lng);
      const snapMissing = hasSnap && snapLat != null && snapLng != null && !getCachedAddressFull(Number(snapLat), Number(snapLng));

      if (!nowMissing && !snapMissing) return;

      if (nowMissing) {
        reverseGeocodeFull(lat, lng).then(() => {
          (marker as any).__rebuildPopup?.(vehicle);
        });
      }

      if (snapMissing && snapLat != null && snapLng != null) {
        reverseGeocodeFull(Number(snapLat), Number(snapLng)).then(() => {
          (marker as any).__rebuildPopup?.(vehicle);
        });
      }
    });

    marker.on('click', () => {
      // For Alert Inbox locate pins, don't auto-open details panel.
      if (vehicle.meta?.source === 'alert_inbox') {
        marker.openPopup();
        return;
      }
      selectVehicle(vehicle);
    });

    // Distinguish user-clicked-X close from programmatic close (marker being
    // removed by the reconciliation loop, marker recreated due to selection
    // change, etc.). Leaflet fires `popupclose` in BOTH cases — without the
    // __removing guard, any reconciliation would clear focusedVehicle here
    // and rip the locate overlay off the map for no reason.
    marker.on('popupclose', () => {
      if (vehicle.meta?.source !== 'alert_inbox') return;
      if ((marker as any).__removing) return;
      const st = useVehicleStore.getState();
      if (st.focusedVehicle?.objectId === vehicle.objectId) st.focusOnVehicle(null);
      if (st.alertLocate?.objectId === vehicle.objectId) st.setAlertLocate(null);
    });

    return marker;
  }, [selectVehicle]);

  // Update markers when pinned vehicles change
  useEffect(() => {
    if (!mapRef.current) {
      console.log('❌ Map not ready yet');
      return;
    }

    const map = mapRef.current;
    const clusterGroup = markerClusterRef.current;
    const existingMarkers = markersRef.current;

    console.log(`🗺️ Updating markers: ${displayVehicles.length} vehicles to display, ${existingMarkers.size} existing markers, clustering: ${clusteringEnabled}`);

    // Create set of vehicle IDs that should be displayed
    const shouldDisplay = new Set(displayVehicles.map(v => v.objectId));

    // Remove markers for vehicles no longer pinned
    existingMarkers.forEach((marker, vehicleId) => {
      if (!shouldDisplay.has(vehicleId)) {
        (marker as any).__removing = true;
        if (clusteringEnabled && clusterGroup) {
          clusterGroup.removeLayer(marker);
        } else {
          map.removeLayer(marker);
        }
        existingMarkers.delete(vehicleId);
      }
    });

    // Add/update markers for pinned vehicles
    displayVehicles.forEach((vehicle) => {
      const isSelected = selectedVehicle?.objectId === vehicle.objectId;
      const existingMarker = existingMarkers.get(vehicle.objectId);
      
      // Debug log for each vehicle
      if (!existingMarker) {
        console.log(`📍 Creating marker for ${vehicle.name} at ${vehicle.gpsData?.latitude}, ${vehicle.gpsData?.longitude}`);
      }

      if (existingMarker) {
        // Update position
        if (vehicle.gpsData) {
          existingMarker.setLatLng([
            vehicle.gpsData.latitude,
            vehicle.gpsData.longitude,
          ]);
        }
        const prevSource = (existingMarker as any).__metaSource;
        const prevHasSnap = (existingMarker as any).__hasAlertSnapshot;
        const nextSource = vehicle.meta?.source;
        const nextHasSnap = !!vehicle.meta?.alertSnapshot;

        // Recreate marker if selection or snapshot/meta changed (so popup updates)
        if (
          isSelected !== (existingMarker.options.zIndexOffset === 1000) ||
          prevSource !== nextSource ||
          prevHasSnap !== nextHasSnap
        ) {
          const wasPopupOpen = (existingMarker as any).isPopupOpen?.();
          (existingMarker as any).__removing = true;
          if (clusteringEnabled && clusterGroup) {
            clusterGroup.removeLayer(existingMarker);
          } else {
            map.removeLayer(existingMarker);
          }
          existingMarkers.delete(vehicle.objectId);
          const newMarker = createMarker(vehicle, isSelected);
          if (newMarker) {
            if (clusteringEnabled && clusterGroup) {
              clusterGroup.addLayer(newMarker);
            } else {
              newMarker.addTo(map);
            }
            existingMarkers.set(vehicle.objectId, newMarker);
            // Preserve popup visibility across recreations so live data updates
            // / selection toggles don't visually dismiss a popup the user opened.
            if (wasPopupOpen) {
              setTimeout(() => { try { newMarker.openPopup(); } catch {} }, 0);
            }
          }
        } else {
          // Marker reused — refresh popup with the latest telemetry so speed,
          // heading, satellites, battery, GPS time and ignition stay in sync
          // with the live detail panel instead of frozen at first-bind values.
          (existingMarker as any).__rebuildPopup?.(vehicle);
        }
      } else {
        // Create new marker
        const marker = createMarker(vehicle, isSelected);
        if (marker) {
          if (clusteringEnabled && clusterGroup) {
            clusterGroup.addLayer(marker);
          } else {
            marker.addTo(map);
          }
          existingMarkers.set(vehicle.objectId, marker);
        }
      }
    });

    console.log(`🗺️ Markers after update: ${existingMarkers.size} on map`);

    // Fit bounds on first load if there are vehicles
    if (!initialFitDone.current && displayVehicles.length > 0) {
      const validVehicles = displayVehicles.filter(v => v.gpsData);
      console.log(`🗺️ Fitting bounds to ${validVehicles.length} vehicles`);
      
      if (validVehicles.length > 0) {
        const bounds = L.latLngBounds(
          validVehicles.map(v => [v.gpsData!.latitude, v.gpsData!.longitude])
        );
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
          initialFitDone.current = true;
          console.log(`✅ Fitted to bounds`);
        } else {
          console.warn(`⚠️ Invalid bounds`);
        }
      }
    }
  }, [displayVehicles, selectedVehicle, createMarker, clusteringEnabled]);

  // Handle clustering toggle - move markers between cluster group and map
  useEffect(() => {
    if (!mapRef.current || !markerClusterRef.current) return;
    
    const map = mapRef.current;
    const clusterGroup = markerClusterRef.current;
    const existingMarkers = markersRef.current;
    
    if (clusteringEnabled) {
      // Move markers from map to cluster group
      existingMarkers.forEach((marker) => {
        if (map.hasLayer(marker)) {
          map.removeLayer(marker);
          clusterGroup.addLayer(marker);
        }
      });
    } else {
      // Move markers from cluster group to map
      existingMarkers.forEach((marker) => {
        if (clusterGroup.hasLayer(marker)) {
          clusterGroup.removeLayer(marker);
          marker.addTo(map);
        }
      });
    }
    
    console.log(`🗺️ Clustering ${clusteringEnabled ? 'enabled' : 'disabled'}, ${existingMarkers.size} markers`);
  }, [clusteringEnabled]);

  // Render geofence polygons
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const existingPolygons = geofencePolygonsRef.current;
    const existingLabels = geofenceLabelsRef.current;

    // Clear existing polygons if geofences are hidden
    if (!showGeofences) {
      existingPolygons.forEach((polygon) => map.removeLayer(polygon));
      existingLabels.forEach((label) => map.removeLayer(label));
      existingPolygons.clear();
      existingLabels.clear();
      return;
    }

    // Update polygons based on filters
    geofences.forEach((geofence) => {
      const isVisible = geofenceFilters[geofence.type];
      const existingPolygon = existingPolygons.get(geofence.id);
      const existingLabel = existingLabels.get(geofence.id);

      if (!isVisible) {
        // Remove if exists and shouldn't be visible
        if (existingPolygon) {
          map.removeLayer(existingPolygon);
          existingPolygons.delete(geofence.id);
        }
        if (existingLabel) {
          map.removeLayer(existingLabel);
          existingLabels.delete(geofence.id);
        }
        return;
      }

      // Skip if already rendered
      if (existingPolygon) return;

      // Create polygon
      const polygon = L.polygon(
        geofence.coordinates.map(([lat, lng]) => [lat, lng] as L.LatLngTuple),
        {
          color: geofence.color,
          fillColor: geofence.color,
          fillOpacity: 0.15,
          weight: 2,
          opacity: 0.7,
        }
      );

      // Add popup with zone info
      polygon.bindPopup(`
        <div class="p-2">
          <div class="font-semibold text-sm">${geofence.name}</div>
          <div class="text-xs text-slate-500 mt-1">${ZONE_LABELS[geofence.type]}</div>
        </div>
      `);

      // Add tooltip on hover
      polygon.bindTooltip(geofence.name, {
        permanent: false,
        direction: 'center',
        className: 'geofence-tooltip',
      });

      polygon.addTo(map);
      existingPolygons.set(geofence.id, polygon);

      // Calculate center for label
      const bounds = polygon.getBounds();
      const center = bounds.getCenter();

      // Create label marker
      const label = L.marker(center, {
        icon: L.divIcon({
          className: 'geofence-label',
          html: `<div class="px-2 py-1 text-[10px] font-medium rounded bg-slate-800/80 text-white border border-white/20 whitespace-nowrap">${geofence.name}</div>`,
          iconSize: [100, 20],
          iconAnchor: [50, 10],
        }),
        interactive: false,
      });

      // Only show labels at higher zoom levels
      const updateLabelVisibility = () => {
        const zoom = map.getZoom();
        if (zoom >= 10) {
          if (!map.hasLayer(label)) label.addTo(map);
        } else {
          if (map.hasLayer(label)) map.removeLayer(label);
        }
      };

      updateLabelVisibility();
      map.on('zoomend', updateLabelVisibility);
      existingLabels.set(geofence.id, label);
    });

    console.log(`🗺️ Geofences: ${existingPolygons.size} visible`);
  }, [showGeofences, geofenceFilters]);

  // Offset flyTo so the marker lands in the visible (non-panel) area
  const panToWithOffset = useCallback((lat: number, lng: number, zoom: number, duration = 1) => {
    const map = mapRef.current;
    if (!map) return;
    const panelW = useLayoutStore.getState().rightPanelWidth;
    if (panelW <= 0) {
      map.flyTo([lat, lng], zoom, { duration });
      return;
    }
    // Shift center rightward by half the panel width so the marker sits in the visible area
    const targetPoint = map.project([lat, lng], zoom);
    const offsetCenter = map.unproject(
      targetPoint.add(L.point(panelW / 2, 0)),
      zoom
    );
    map.flyTo(offsetCenter, zoom, { duration });
  }, []);

  // Focus on vehicle when focusedVehicle changes
  useEffect(() => {
    if (!mapRef.current || !focusedVehicle?.gpsData) return;

    panToWithOffset(
      focusedVehicle.gpsData.latitude,
      focusedVehicle.gpsData.longitude,
      16,
      1
    );

    // Auto-open popup for located vehicles (Alert Locate / Search Locate)
    const id = focusedVehicle.objectId;
    let tries = 0;
    const openInterval = setInterval(() => {
      tries += 1;
      const marker = markersRef.current.get(id);
      if (marker) {
        marker.openPopup();
        clearInterval(openInterval);
      } else if (tries >= 10) {
        clearInterval(openInterval);
      }
    }, 150);

    // Clear focus after flying — but for Alert-Inbox locate, keep focus alive
    // so the vehicle stays in displayVehicles and the popup-bearing marker
    // isn't ripped off the map. Marker dismissal happens on popupclose.
    const isAlertLocate = focusedVehicle.meta?.source === 'alert_inbox';
    const timeout = isAlertLocate ? null : setTimeout(() => {
      focusOnVehicle(null);
    }, 1500);

    return () => {
      if (timeout) clearTimeout(timeout);
      clearInterval(openInterval);
    };
  }, [focusedVehicle, focusOnVehicle, panToWithOffset]);

  // Auto-pan when right panel width changes (e.g. history panel opens/closes)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = prevRightPanelRef.current;
    prevRightPanelRef.current = rightPanelWidth;
    if (prev === rightPanelWidth) return;

    const diff = rightPanelWidth - prev; // positive = panel grew
    if (diff === 0) return;

    // Shift the map so existing content stays in the visible area
    map.panBy([diff / 2, 0], { duration: 0.3, easeLinearity: 0.5 });
  }, [rightPanelWidth]);

  // Focus on a specific track point (one-shot) when user clicks a raw packet row
  useEffect(() => {
    if (!mapRef.current || !focusedTrackPoint) return;
    const map = mapRef.current;
    map.flyTo([focusedTrackPoint.lat, focusedTrackPoint.lng], focusedTrackPoint.zoom ?? 16, { duration: 0.8 });
    const t = setTimeout(() => clearFocusedTrackPoint(), 900);
    return () => clearTimeout(t);
  }, [focusedTrackPoint, clearFocusedTrackPoint]);

  // ==========================================
  // Alert Locate — incident scene with OSRM road-matched track
  // ==========================================
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const clearAlertLayers = () => {
      if (alertOriginMarkerRef.current) { try { map.removeLayer(alertOriginMarkerRef.current); } catch {} alertOriginMarkerRef.current = null; }
      alertTrackSegmentsRef.current.forEach(s => { try { map.removeLayer(s); } catch {} });
      alertTrackSegmentsRef.current = [];
      if (alertInfoMarkerRef.current) { try { map.removeLayer(alertInfoMarkerRef.current); } catch {} alertInfoMarkerRef.current = null; }
      if (alertDashedLineRef.current) { try { map.removeLayer(alertDashedLineRef.current); } catch {} alertDashedLineRef.current = null; }
    };

    clearAlertLayers();
    if (!alertLocate) return;

    const { lat, lng, alertType, vehicleReg, gpsTime } = alertLocate;
    const alertColor = alertType?.toLowerCase().includes('sos') ? '#EF4444'
      : alertType?.toLowerCase().includes('geofence') ? '#F59E0B'
      : alertType?.toLowerCase().includes('speed') ? '#F97316'
      : alertType?.toLowerCase().includes('tow') ? '#8B5CF6'
      : '#6366F1';

    const timeStr = (() => {
      if (!gpsTime) return '';
      const s = String(gpsTime).trim();
      if (!s) return '';

      // Prefer the wall-clock time embedded in the string (no TZ conversion).
      // Examples:
      // - 2026-04-07 03:48:29
      // - 2026-04-07T03:48:29.000Z
      // - 2026-04-07T03:48:29
      const m =
        s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/) ||
        s.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        const hh = m[m.length - 3];
        const mm = m[m.length - 2];
        const ss = m[m.length - 1] || '00';
        return `${hh}:${mm}:${ss}`;
      }

      // Fallback: parse Date but preserve wall time for explicit TZ strings.
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return '';
      const useUtc = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
      const pad2 = (n: number) => String(n).padStart(2, '0');
      const hh = useUtc ? d.getUTCHours() : d.getHours();
      const mm = useUtc ? d.getUTCMinutes() : d.getMinutes();
      const ss = useUtc ? d.getUTCSeconds() : d.getSeconds();
      return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
    })();

    // 1) Alert origin marker (static, stays for the lifetime of the locate)
    const originIcon = L.divIcon({
      className: 'alert-origin-marker',
      html: `
        <div style="position:relative; width:48px; height:48px;">
          <div style="position:absolute;inset:0;border:2px solid ${alertColor};border-radius:50%;animation:ping 2s cubic-bezier(0,0,0.2,1) infinite;opacity:0.4;"></div>
          <div style="position:absolute;inset:6px;background:${alertColor}22;border:2px solid ${alertColor};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px ${alertColor}60,0 4px 12px rgba(0,0,0,0.5);backdrop-filter:blur(4px);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${alertColor}" stroke="${alertColor}" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13" stroke="white" stroke-width="2"/>
              <line x1="12" y1="17" x2="12.01" y2="17" stroke="white" stroke-width="2"/>
            </svg>
          </div>
          <div style="position:absolute;top:52px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:10px;font-weight:600;color:${alertColor};text-shadow:0 1px 4px rgba(0,0,0,0.8);background:rgba(0,0,0,0.7);padding:2px 6px;border-radius:4px;border:1px solid ${alertColor}40;">${vehicleReg} · ${timeStr}</div>
        </div>
      `,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });
    alertOriginMarkerRef.current = L.marker([lat, lng], { icon: originIcon, zIndexOffset: 2000 }).addTo(map);

    // Resolve TAVL objectId from locate payload / pinned vehicle (alert inbox locate may not set selectedVehicle)
    const st0 = useVehicleStore.getState();
    const trackObjectId = parseInt(st0.selectedVehicle?.objectId || alertLocate.objectId);
    if (!trackObjectId || isNaN(trackObjectId)) return;

    // Parse alert time to ISO
    const normalized = gpsTime.replace(' ', 'T');
    const alertDate = new Date(normalized.includes('Z') || normalized.includes('+') ? normalized : normalized + 'Z');
    const fromDateISO = isNaN(alertDate.getTime()) ? new Date(gpsTime).toISOString() : alertDate.toISOString();
    const alertMs = alertDate.getTime() || Date.now();

    let firstFit = false;

    // 2) Fetch GPS points → OSRM road-match → draw track + badge. Repeats every 15s.
    const buildScene = async () => {
      const map = mapRef.current;
      if (!map || !useVehicleStore.getState().alertLocate) return;

      // Clear dynamic layers (keep origin marker)
      alertTrackSegmentsRef.current.forEach(s => { try { map.removeLayer(s); } catch {} });
      alertTrackSegmentsRef.current = [];
      if (alertInfoMarkerRef.current) { try { map.removeLayer(alertInfoMarkerRef.current); } catch {} alertInfoMarkerRef.current = null; }
      if (alertDashedLineRef.current) { try { map.removeLayer(alertDashedLineRef.current); } catch {} alertDashedLineRef.current = null; }

      try {
        // a) Fetch raw GPS track from alert time to now
        const toDateISO = new Date().toISOString();
        const result: any = await api.track.getHistory(trackObjectId, fromDateISO, toDateISO, 3000);
        const rawPoints: Array<{ latitude: number; longitude: number; speed: number }> = result?.data || [];
        console.log(`🔍 Alert scene: ${rawPoints.length} GPS points for obj ${trackObjectId}`);

        // Current live vehicle position (prefer selectedVehicle, then pinned/vehicles map)
        const st = useVehicleStore.getState();
        const curV =
          st.selectedVehicle ||
          st.pinnedVehicleData?.get?.(String(trackObjectId)) ||
          st.vehicles?.get?.(String(trackObjectId));
        const curLat = (curV as any)?.gpsData?.latitude ?? lat;
        const curLng = (curV as any)?.gpsData?.longitude ?? lng;
        const curSpeed = (curV as any)?.gpsData?.speed ?? 0;

        // Build coordinate list: alert origin + GPS points + current position
        const coords: Array<{ lat: number; lon: number }> = [{ lat, lon: lng }];
        for (const p of rawPoints) {
          if (p.latitude && p.longitude) coords.push({ lat: p.latitude, lon: p.longitude });
        }
        coords.push({ lat: curLat, lon: curLng });

        // Deduplicate near-identical consecutive coords (within ~5m)
        const dedupCoords = [coords[0]];
        for (let i = 1; i < coords.length; i++) {
          const prev = dedupCoords[dedupCoords.length - 1];
          const dx = Math.abs(coords[i].lat - prev.lat);
          const dy = Math.abs(coords[i].lon - prev.lon);
          if (dx > 0.00005 || dy > 0.00005) dedupCoords.push(coords[i]);
        }
        if (dedupCoords.length < 2) dedupCoords.push(coords[coords.length - 1]);

        // b) Send to OSRM for road-matched route
        let routeCoords: [number, number][] = [];
        let routeDistMeters = 0;

        if (dedupCoords.length >= 2) {
          try {
            const osrmRes = await fetch('/api/track/osrm-match', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ coordinates: dedupCoords }),
            });
            if (osrmRes.ok) {
              const osrmData = await osrmRes.json();
              if (osrmData.success && osrmData.route?.length > 0) {
                routeCoords = osrmData.route; // [[lat,lng], ...]
                routeDistMeters = osrmData.distance || 0;
                console.log(`✅ Alert OSRM: ${routeCoords.length} pts, ${(routeDistMeters / 1000).toFixed(1)} km`);
              }
            }
          } catch (e: any) {
            console.warn('⚠️ Alert OSRM failed, falling back to raw GPS:', e.message);
          }
        }

        // c) Draw the route
        if (routeCoords.length > 1) {
          // OSRM road-matched polyline (smooth, single color)
          const routeLine = L.polyline(routeCoords, {
            color: '#10B981',
            weight: 5,
            opacity: 0.9,
            lineJoin: 'round',
            lineCap: 'round',
          }).addTo(map);
          alertTrackSegmentsRef.current.push(routeLine);
        } else if (rawPoints.length > 1) {
          // Fallback: raw GPS speed-colored segments
          for (let i = 0; i < rawPoints.length - 1; i++) {
            const p1 = rawPoints[i];
            const p2 = rawPoints[i + 1];
            const seg = L.polyline(
              [[p1.latitude, p1.longitude], [p2.latitude, p2.longitude]],
              { color: getSpeedColor(p1.speed), weight: 4, opacity: 0.85 }
            ).addTo(map);
            alertTrackSegmentsRef.current.push(seg);
          }
        }

        // If no OSRM distance, calculate from raw points
        if (!routeDistMeters && rawPoints.length > 0) {
          for (let i = 0; i < rawPoints.length - 1; i++) {
            routeDistMeters += map.distance(
              [rawPoints[i].latitude, rawPoints[i].longitude],
              [rawPoints[i + 1].latitude, rawPoints[i + 1].longitude]
            );
          }
          // Add gap from last GPS point to current position
          const last = rawPoints[rawPoints.length - 1];
          routeDistMeters += map.distance([last.latitude, last.longitude], [curLat, curLng]);
        }
        if (!routeDistMeters) {
          routeDistMeters = map.distance([lat, lng], [curLat, curLng]);
        }

        const distLabel = routeDistMeters >= 1000
          ? `${(routeDistMeters / 1000).toFixed(1)} km`
          : `${Math.round(routeDistMeters)} m`;

        // Time since alert
        const diffMin = Math.round((Date.now() - alertMs) / 60000);
        const timeAgo = diffMin < 1 ? 'just now'
          : diffMin < 60 ? `${diffMin}m ago`
          : `${Math.floor(diffMin / 60)}h ${diffMin % 60}m ago`;

        // d) Dashed straight line from alert origin to current (visual reference)
        alertDashedLineRef.current = L.polyline(
          [[lat, lng], [curLat, curLng]],
          { color: alertColor, weight: 2, opacity: 0.3, dashArray: '8 6' }
        ).addTo(map);

        // e) Info badge
        const midLat = (lat + curLat) / 2;
        const midLng = (lng + curLng) / 2;
        const infoIcon = L.divIcon({
          className: 'alert-info-badge',
          html: `
            <div style="
              white-space:nowrap;font-size:11px;font-weight:600;
              color:#fff;background:rgba(0,0,0,0.88);
              padding:5px 12px;border-radius:8px;
              border:1px solid ${alertColor}50;
              box-shadow:0 4px 16px rgba(0,0,0,0.6);
              backdrop-filter:blur(6px);
              display:flex;align-items:center;gap:8px;
            ">
              <span style="color:${alertColor};font-size:12px;">▲ ${distLabel}</span>
              <span style="color:rgba(255,255,255,0.25)">|</span>
              <span style="color:rgba(255,255,255,0.8)">${timeAgo}</span>
              <span style="color:rgba(255,255,255,0.25)">|</span>
              <span style="color:rgba(255,255,255,0.8)">${curSpeed} km/h</span>
            </div>
          `,
          iconSize: [0, 0],
          iconAnchor: [0, 16],
        });
        alertInfoMarkerRef.current = L.marker([midLat, midLng], {
          icon: infoIcon, zIndexOffset: 3000, interactive: false,
        }).addTo(map);

        // f) Fit bounds on first render only
        if (!firstFit) {
          firstFit = true;
          const boundsArr: [number, number][] = routeCoords.length > 0
            ? routeCoords
            : [[lat, lng], [curLat, curLng], ...rawPoints.map(p => [p.latitude, p.longitude] as [number, number])];
          const bounds = L.latLngBounds(boundsArr);
          if (bounds.isValid()) {
            const panelW = useLayoutStore.getState().rightPanelWidth;
            map.fitBounds(bounds, {
              paddingTopLeft: L.point(60, 60),
              paddingBottomRight: L.point(panelW + 60, 60),
              maxZoom: 16, animate: true, duration: 1,
            });
          }
        }
      } catch (err: any) {
        console.error('⚠️ Alert scene error:', err?.message || err);
      }
    };

    buildScene();
    const interval = setInterval(buildScene, 15_000);

    return () => {
      clearInterval(interval);
      clearAlertLayers();
    };
  }, [alertLocate]);

  // Render vehicle trails with speed-based colors
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const existingTrails = vehicleTrailsRef.current;

    // Get IDs of pinned vehicles that should show trails
    const pinnedIds = new Set(displayVehicles.map(v => v.objectId));

    // Remove trails for vehicles no longer pinned or if trails are hidden
    existingTrails.forEach((polylines, vehicleId) => {
      if (!pinnedIds.has(vehicleId) || !showTrails) {
        polylines.forEach(p => map.removeLayer(p));
        existingTrails.delete(vehicleId);
      }
    });

    // If trails are hidden, don't add new ones
    if (!showTrails) return;

    // Add/update trails for pinned vehicles
    displayVehicles.forEach((vehicle) => {
      const trail = vehicleTrails.get(vehicle.objectId);
      
      // Show trails for any pinned vehicle with enough trail points
      if (!trail || trail.length < 2) {
        // Remove trail if no data
        const existing = existingTrails.get(vehicle.objectId);
        if (existing) {
          existing.forEach(p => map.removeLayer(p));
          existingTrails.delete(vehicle.objectId);
        }
        return;
      }

      // Remove old segments
      const existingSegments = existingTrails.get(vehicle.objectId);
      if (existingSegments) {
        existingSegments.forEach(p => map.removeLayer(p));
      }

      // Create new speed-based segmented polylines
      const segments: L.Polyline[] = [];
      
      for (let i = 0; i < trail.length - 1; i++) {
        const p1 = trail[i];
        const p2 = trail[i + 1];
        const avgSpeed = (p1.speed + p2.speed) / 2;
        const color = getSpeedColor(avgSpeed);
        
        const segment = L.polyline(
          [[p1.lat, p1.lng], [p2.lat, p2.lng]],
          {
            color: color,
            weight: 4,
            opacity: 0.85,
            lineCap: 'round',
            lineJoin: 'round',
            className: 'vehicle-trail-segment',
          }
        ).addTo(map);
        
        // Add tooltip showing speed for this segment
        segment.bindTooltip(`${Math.round(avgSpeed)} km/h`, {
          permanent: false,
          direction: 'top',
          className: 'speed-tooltip',
        });
        
        segments.push(segment);
      }
      
      existingTrails.set(vehicle.objectId, segments);
    });
  }, [displayVehicles, vehicleTrails, showTrails]);

  // Render track polyline when currentTrack changes
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Clear previous track elements
    if (trackPolylineRef.current) {
      map.removeLayer(trackPolylineRef.current);
      trackPolylineRef.current = null;
    }
    trackMarkersRef.current.forEach(m => map.removeLayer(m));
    trackMarkersRef.current = [];
    stopMarkersRef.current.forEach(m => map.removeLayer(m));
    stopMarkersRef.current = [];
    gsmMarkersRef.current.forEach(m => map.removeLayer(m));
    gsmMarkersRef.current = [];
    latencyMarkersRef.current.forEach(m => map.removeLayer(m));
    latencyMarkersRef.current = [];
    ignitionMarkersRef.current.forEach(m => map.removeLayer(m));
    ignitionMarkersRef.current = [];
    speedEventMarkersRef.current.forEach(m => map.removeLayer(m));
    speedEventMarkersRef.current = [];
    idleMarkersRef.current.forEach(m => map.removeLayer(m));
    idleMarkersRef.current = [];
    if (playbackMarkerRef.current) {
      map.removeLayer(playbackMarkerRef.current);
      playbackMarkerRef.current = null;
    }

    if (!currentTrack || currentTrack.points.length === 0) return;

    const points = currentTrack.points;
    const useOsrm = trackMode === 'osrm' && osrmRoute && osrmRoute.length > 0;

    const TT = 'background:rgba(15,23,42,0.95);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 14px;box-shadow:0 4px 20px rgba(0,0,0,0.4);color:white;font-family:system-ui;min-width:150px;';
    const addrHtml = (a: string) => `<div style="font-size:11px;color:rgba(255,255,255,0.75);margin-bottom:4px;display:flex;align-items:flex-start;gap:4px;line-height:1.3">
      <span>📍</span>
      <span>${a || '<span style="color:rgba(148,163,184,0.55);font-style:italic;">Resolving address…</span>'}</span>
    </div>`;
    const geoTasks: Array<{ marker: L.Marker; lat: number; lng: number; build: (a: string) => string }> = [];

    // Render OSRM route if available and in OSRM mode
    if (useOsrm) {
      // OSRM matched route - single smooth polyline
      trackPolylineRef.current = L.polyline(osrmRoute, {
        color: '#10B981', // Green for OSRM route
        weight: 5,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(map);
      
      // Add a subtle raw GPS track underneath for reference
      const rawLatLngs = points.map(p => [p.latitude, p.longitude] as [number, number]);
      const rawPolyline = L.polyline(rawLatLngs, {
        color: '#6366F1',
        weight: 2,
        opacity: 0.3,
        dashArray: '5, 10',
      }).addTo(map);
      trackMarkersRef.current.push(rawPolyline as any);
      
    } else {
      // Raw GPS track
      // Create polyline with speed-based colors
      if (showSpeedColors && points.length > 1) {
        // Create multiple polyline segments with different colors
        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const color = getSpeedColor(p1.speed);
          
          const segment = L.polyline(
            [[p1.latitude, p1.longitude], [p2.latitude, p2.longitude]],
            { color, weight: 4, opacity: 0.8 }
          ).addTo(map);
          
          trackMarkersRef.current.push(segment as any);
        }
      } else {
        // Single color polyline
        const latLngs = points.map(p => [p.latitude, p.longitude] as [number, number]);
        trackPolylineRef.current = L.polyline(latLngs, {
          color: '#3B82F6',
          weight: 4,
          opacity: 0.8,
        }).addTo(map);
      }
    }

    // Add start marker
    const startPoint = points[0];
    const startTime = startPoint.gpsTime ? new Date(startPoint.gpsTime).toLocaleTimeString() : '--';
    const startMarker = L.marker([startPoint.latitude, startPoint.longitude], {
      icon: L.divIcon({
        className: 'track-marker',
        html: `<div style="
          width: 28px; height: 28px; background: #10B981; 
          border: 2px solid white; border-radius: 50%; 
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 12px rgba(16,185,129,0.4), 0 2px 8px rgba(0,0,0,0.3);
          font-size: 11px; font-weight: bold; color: white;
        ">S</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    }).addTo(map);
    const buildStart = (a: string) =>
      `<div style="${TT}">
        <div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
          <span style="color:#10B981">●</span> Journey Start
        </div>
        ${addrHtml(a)}
        <div style="font-size:11px;color:rgba(255,255,255,0.6);display:grid;gap:3px;">
          <div>⏱ ${startTime}</div>
        </div>
      </div>`;
    startMarker.bindTooltip(buildStart(''), { direction: 'top', offset: [0, -16], className: 'event-tooltip' });
    geoTasks.push({ marker: startMarker, lat: startPoint.latitude, lng: startPoint.longitude, build: buildStart });
    trackMarkersRef.current.push(startMarker);

    // Add end marker
    const endPoint = points[points.length - 1];
    const endTime = endPoint.gpsTime ? new Date(endPoint.gpsTime).toLocaleTimeString() : '--';
    const endMarker = L.marker([endPoint.latitude, endPoint.longitude], {
      icon: L.divIcon({
        className: 'track-marker',
        html: `<div style="
          width: 28px; height: 28px; background: #EF4444; 
          border: 2px solid white; border-radius: 50%; 
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 12px rgba(239,68,68,0.4), 0 2px 8px rgba(0,0,0,0.3);
          font-size: 11px; font-weight: bold; color: white;
        ">E</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    }).addTo(map);
    const buildEnd = (a: string) =>
      `<div style="${TT}">
        <div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
          <span style="color:#EF4444">●</span> Journey End
        </div>
        ${addrHtml(a)}
        <div style="font-size:11px;color:rgba(255,255,255,0.6);display:grid;gap:3px;">
          <div>⏱ ${endTime}</div>
        </div>
      </div>`;
    endMarker.bindTooltip(buildEnd(''), { direction: 'top', offset: [0, -16], className: 'event-tooltip' });
    geoTasks.push({ marker: endMarker, lat: endPoint.latitude, lng: endPoint.longitude, build: buildEnd });
    trackMarkersRef.current.push(endMarker);

    // Add stop markers
    if (showStops && currentTrack.stops.length > 0) {
      currentTrack.stops.forEach((stop, index) => {
        const durStr = formatDurationShort(stop.duration);
        const sStart = stop.startTime ? new Date(stop.startTime).toLocaleTimeString() : '';
        const sEnd = stop.endTime ? new Date(stop.endTime).toLocaleTimeString() : '';
        const stopMarker = L.marker([stop.latitude, stop.longitude], {
          icon: L.divIcon({
            className: 'stop-marker',
            html: `<div style="
              padding: 4px 8px; background: #F59E0B;
              border: 2px solid white; border-radius: 12px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              font-size: 10px; font-weight: 600; color: white; white-space: nowrap;
            ">${durStr}</div>`,
            iconSize: [40, 24],
            iconAnchor: [20, 12],
          }),
        }).addTo(map);

        const buildStop = (a: string) =>
          `<div style="${TT}">
            <div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
              <span style="color:#F59E0B">■</span> Stop #${index + 1}
            </div>
            ${addrHtml(a)}
            <div style="font-size:18px;font-weight:800;color:#F59E0B;margin-bottom:4px;">${durStr}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.6);display:grid;gap:3px;">
              ${sStart && sEnd ? `<div>⏱ ${sStart} → ${sEnd}</div>` : ''}
            </div>
          </div>`;
        stopMarker.bindTooltip(buildStop(''), { direction: 'top', offset: [0, -14], className: 'event-tooltip' });
        geoTasks.push({ marker: stopMarker, lat: stop.latitude, lng: stop.longitude, build: buildStop });
        stopMarkersRef.current.push(stopMarker);
      });
    }

    // Add GSM signal coverage halos along the track
    if (showGsmMarkers && points.length > 0) {
      // Detect scale: if max value <= 5, it's a 1-5 scale device, otherwise CSQ (0-31)
      const gsmValues = points.map(p => p.gsmSignal || 0).filter(v => v > 0);
      const maxGsmValue = gsmValues.length > 0 ? Math.max(...gsmValues) : 31;
      const isSimpleScale = maxGsmValue <= 5;
      const maxSignal = isSimpleScale ? 5 : 31;
      
      // Place halos at intervals (every ~500m or at least 10 halos)
      const totalPoints = points.length;
      const minHalos = 8;
      const maxHalos = 20;
      const interval = Math.max(1, Math.floor(totalPoints / Math.min(maxHalos, Math.max(minHalos, totalPoints))));
      
      for (let i = 0; i < totalPoints; i += interval) {
        const point = points[i];
        const signal = point.gsmSignal || 0;
        const { color, label } = getGsmColor(signal, maxSignal);
        const radius = getGsmHaloRadius(signal, maxSignal);
        
        // Create coverage halo circle
        const gsmHalo = L.circle([point.latitude, point.longitude], {
          radius: radius,
          color: color,
          weight: 1,
          opacity: 0.6,
          fillColor: color,
          fillOpacity: 0.12,
          className: 'gsm-halo',
        });
        
        // Add tooltip with details
        gsmHalo.bindTooltip(
          `<div style="text-align: center;">
            <strong>GSM Signal: ${signal}${isSimpleScale ? '/5' : ' CSQ'}</strong><br/>
            <span style="color: ${color}">● ${label}</span><br/>
            <small>Coverage: ~${Math.round(radius)}m radius</small>
          </div>`,
          {
            direction: 'top',
            className: 'gsm-tooltip',
          }
        );
        
        gsmHalo.addTo(map);
        gsmMarkersRef.current.push(gsmHalo as any);
        
        // Add small center dot for reference
        const centerDot = L.circleMarker([point.latitude, point.longitude], {
          radius: 4,
          color: color,
          weight: 2,
          opacity: 1,
          fillColor: color,
          fillOpacity: 0.8,
        });
        centerDot.addTo(map);
        gsmMarkersRef.current.push(centerDot as any);
      }
    }

    // Add latency markers along the track
    if (showLatencyMarkers && points.length > 0) {
      // Calculate average latency for comparison
      const latencyValues = points.map(p => p.latency || 0);
      const avgLatency = latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length;
      const maxLatency = Math.max(...latencyValues);
      
      // Place markers at intervals
      const totalPoints = points.length;
      const minMarkers = 10;
      const maxMarkers = 25;
      const interval = Math.max(1, Math.floor(totalPoints / Math.min(maxMarkers, Math.max(minMarkers, totalPoints))));
      
      for (let i = 0; i < totalPoints; i += interval) {
        const point = points[i];
        const latency = point.latency || 0;
        const { color, label } = getLatencyColor(latency);
        
        // Create a latency indicator marker with clock icon
        const latencyMarker = L.marker([point.latitude, point.longitude], {
          icon: L.divIcon({
            className: 'latency-marker',
            html: `<div style="
              width: 24px;
              height: 24px;
              background: ${color};
              border: 2px solid rgba(255,255,255,0.9);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 2px 8px rgba(0,0,0,0.4);
              font-size: 9px;
              font-weight: bold;
              color: white;
              cursor: pointer;
            " title="Latency: ${latency}s (${label})">
              ${latency}
            </div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
          zIndexOffset: -50,
        });
        
        // Add tooltip with details
        const gpsTimeStr = point.gpsTime ? new Date(point.gpsTime).toLocaleTimeString() : '--';
        latencyMarker.bindTooltip(
          `<div style="text-align: center;">
            <strong>Transmission Latency</strong><br/>
            <span style="color: ${color}; font-size: 16px; font-weight: bold;">${latency}s</span>
            <span style="color: ${color};"> ${label}</span><br/>
            <small>GPS Time: ${gpsTimeStr}</small><br/>
            <small>Avg: ${avgLatency.toFixed(0)}s | Max: ${maxLatency}s</small>
          </div>`,
          {
            direction: 'top',
            offset: [0, -12],
            className: 'latency-tooltip',
          }
        );
        
        latencyMarker.addTo(map);
        latencyMarkersRef.current.push(latencyMarker);
      }
    }

    // --- Journey Event Markers ---
    const needsEvents = showIgnitionEvents || showSpeedEvents || showIdleEvents;
    if (needsEvents) {
      const events = analyzeTrackEvents(points, speedViolationThreshold);

      if (showIgnitionEvents) {
        events.ignitionEvents.forEach((evt) => {
          const isOn = evt.type === 'on';
          const bg = isOn ? '#10B981' : '#EF4444';
          const glow = isOn ? 'rgba(16,185,129,0.55)' : 'rgba(239,68,68,0.55)';
          const label = isOn ? 'Ignition ON' : 'Ignition OFF';
          const prevLabel = isOn ? 'Engine was OFF' : 'Engine was ON';
          const timeStr = new Date(evt.timestamp).toLocaleTimeString();
          const durLabel = formatDurationShort(evt.prevStateDuration);

          const marker = L.marker([evt.latitude, evt.longitude], {
            icon: L.divIcon({
              className: 'track-marker',
              html: `<div style="
                width:24px;height:24px;background:${bg};
                border:2px solid white;border-radius:50%;
                display:flex;align-items:center;justify-content:center;
                box-shadow:0 0 10px ${glow},0 2px 8px rgba(0,0,0,0.35);
              "><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></div>`,
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            }),
            zIndexOffset: 100,
          });

          const buildIgn = (a: string) =>
            `<div style="${TT}">
              <div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                <span style="color:${bg}">●</span> ${label}
              </div>
              ${addrHtml(a)}
              <div style="font-size:11px;color:rgba(255,255,255,0.6);display:grid;gap:3px;">
                <div>⏱ ${timeStr}</div>
                <div>${prevLabel} for ${durLabel}</div>
              </div>
            </div>`;
          marker.bindTooltip(buildIgn(''), { direction: 'top', offset: [0, -14], className: 'event-tooltip' });
          geoTasks.push({ marker, lat: evt.latitude, lng: evt.longitude, build: buildIgn });
          marker.addTo(map);
          ignitionMarkersRef.current.push(marker);
        });
      }

      if (showSpeedEvents) {
        events.speedViolations.forEach((viol) => {
          const vStartStr = new Date(viol.startTime).toLocaleTimeString();
          const vEndStr = new Date(viol.endTime).toLocaleTimeString();
          const vDurStr = formatDurationShort(viol.duration);
          const peak = Math.round(viol.peakSpeed);

          const marker = L.marker([viol.latitude, viol.longitude], {
            icon: L.divIcon({
              className: 'track-marker',
              html: `<div style="
                padding:3px 8px;background:rgba(239,68,68,0.95);
                border:2px solid white;border-radius:14px;
                box-shadow:0 0 14px rgba(239,68,68,0.5),0 2px 8px rgba(0,0,0,0.35);
                font-size:10px;font-weight:700;color:white;white-space:nowrap;
                display:flex;align-items:center;gap:3px;
              "><svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>${peak}</div>`,
              iconSize: [52, 24],
              iconAnchor: [26, 12],
            }),
            zIndexOffset: 150,
          });

          const buildSpd = (a: string) =>
            `<div style="${TT}min-width:170px;">
              <div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                <span style="color:#EF4444">⚠</span> Speed Violation
              </div>
              ${addrHtml(a)}
              <div style="font-size:20px;font-weight:800;color:#EF4444;margin-bottom:6px;">${peak} km/h</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.6);display:grid;gap:3px;">
                <div>Threshold: ${speedViolationThreshold} km/h</div>
                <div>Duration: ${vDurStr}</div>
                <div>⏱ ${vStartStr} → ${vEndStr}</div>
              </div>
            </div>`;
          marker.bindTooltip(buildSpd(''), { direction: 'top', offset: [0, -14], className: 'event-tooltip' });
          geoTasks.push({ marker, lat: viol.latitude, lng: viol.longitude, build: buildSpd });

          const violSegment = L.polyline(
            points.slice(viol.startIndex, viol.endIndex + 1).map(p => [p.latitude, p.longitude] as [number, number]),
            { color: '#EF4444', weight: 7, opacity: 0.5, dashArray: '8, 4' }
          ).addTo(map);
          speedEventMarkersRef.current.push(violSegment as any);

          marker.addTo(map);
          speedEventMarkersRef.current.push(marker);
        });
      }

      if (showIdleEvents) {
        events.idleEvents.forEach((idle) => {
          const iStartStr = new Date(idle.startTime).toLocaleTimeString();
          const iEndStr = new Date(idle.endTime).toLocaleTimeString();
          const iDurStr = formatDurationShort(idle.duration);

          const marker = L.marker([idle.latitude, idle.longitude], {
            icon: L.divIcon({
              className: 'track-marker',
              html: `<div style="
                padding:3px 8px;background:rgba(99,102,241,0.9);
                border:2px solid white;border-radius:14px;
                box-shadow:0 2px 10px rgba(99,102,241,0.4),0 2px 8px rgba(0,0,0,0.3);
                font-size:10px;font-weight:600;color:white;white-space:nowrap;
                display:flex;align-items:center;gap:3px;
              "><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>${iDurStr}</div>`,
              iconSize: [52, 24],
              iconAnchor: [26, 12],
            }),
            zIndexOffset: 50,
          });

          const idleCircle = L.circle([idle.latitude, idle.longitude], {
            radius: 60,
            color: '#6366F1',
            weight: 1.5,
            opacity: 0.6,
            fillColor: '#6366F1',
            fillOpacity: 0.08,
          }).addTo(map);
          idleMarkersRef.current.push(idleCircle as any);

          const buildIdle = (a: string) =>
            `<div style="${TT}min-width:160px;">
              <div style="font-weight:700;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                <span style="color:#818CF8">⏸</span> Vehicle Idle
              </div>
              ${addrHtml(a)}
              <div style="font-size:18px;font-weight:800;color:#818CF8;margin-bottom:6px;">${iDurStr}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.6);display:grid;gap:3px;">
                <div>Engine ON, not moving</div>
                <div>⏱ ${iStartStr} → ${iEndStr}</div>
              </div>
            </div>`;
          marker.bindTooltip(buildIdle(''), { direction: 'top', offset: [0, -14], className: 'event-tooltip' });
          geoTasks.push({ marker, lat: idle.latitude, lng: idle.longitude, build: buildIdle });
          marker.addTo(map);
          idleMarkersRef.current.push(marker);
        });
      }
    }

    // Batch geocode all marker locations then update tooltips with addresses
    if (geoTasks.length > 0) {
      batchReverseGeocode(geoTasks.map(t => ({ lat: t.lat, lng: t.lng }))).then(() => {
        for (const t of geoTasks) {
          const addr = getCachedAddress(t.lat, t.lng);
          if (addr) t.marker.setTooltipContent(t.build(addr));
        }
      });
    }

    // Fit bounds to track (use OSRM route bounds if available)
    const boundsPoints = useOsrm 
      ? osrmRoute 
      : points.map(p => [p.latitude, p.longitude] as [number, number]);
    const bounds = L.latLngBounds(boundsPoints);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [currentTrack, showStops, showSpeedColors, showGsmMarkers, showLatencyMarkers, showIgnitionEvents, showSpeedEvents, showIdleEvents, speedViolationThreshold, trackMode, osrmRoute]);

  // Update playback marker position
  useEffect(() => {
    if (!mapRef.current || !currentTrack || currentTrack.points.length === 0) return;
    const map = mapRef.current;
    const point = currentTrack.points[currentPointIndex];
    
    if (!point) return;

    if (playbackMarkerRef.current) {
      playbackMarkerRef.current.setLatLng([point.latitude, point.longitude]);
      // Update rotation
      const icon = playbackMarkerRef.current.getElement();
      if (icon) {
        const wrapper = icon.querySelector('.playback-wrapper') as HTMLElement;
        if (wrapper) wrapper.style.transform = `rotate(${point.angle}deg)`;
      }
    } else {
      // Create playback marker
      playbackMarkerRef.current = L.marker([point.latitude, point.longitude], {
        icon: L.divIcon({
          className: 'playback-marker',
          html: `<div class="playback-wrapper" style="transform: rotate(${point.angle}deg)">
            <div style="
              width: 32px; height: 32px;
              background: #8B5CF6;
              border: 3px solid white;
              border-radius: 50%;
              display: flex; align-items: center; justify-content: center;
              box-shadow: 0 4px 12px rgba(139, 92, 246, 0.5);
            ">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
              </svg>
            </div>
          </div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
        zIndexOffset: 2000,
      }).addTo(map);
    }
  }, [currentTrack, currentPointIndex]);

  const [closurePanelOpen, setClosurePanelOpen] = useState(false);
  const [closureTab, setClosureTab] = useState<'history' | 'wc'>('history');

  const handleFitAll = () => {
    if (!mapRef.current || displayVehicles.length === 0) return;
    const bounds = L.latLngBounds(
      displayVehicles
        .filter(v => v.gpsData)
        .map(v => [v.gpsData!.latitude, v.gpsData!.longitude])
    );
    if (bounds.isValid()) {
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  };

  // Measurement tool functions
  const clearMeasurement = useCallback(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    
    // Remove markers
    measureMarkersRef.current.forEach(m => map.removeLayer(m));
    measureMarkersRef.current = [];
    
    // Remove polylines
    measurePolylinesRef.current.forEach(p => map.removeLayer(p));
    measurePolylinesRef.current = [];
    
    // Remove labels
    measureLabelsRef.current.forEach(l => map.removeLayer(l));
    measureLabelsRef.current = [];
    
    setMeasurePoints([]);
  }, []);

  const toggleMeasureMode = useCallback(() => {
    if (measureMode) {
      // Exiting measure mode - clear all
      clearMeasurement();
    }
    setMeasureMode(!measureMode);
  }, [measureMode, clearMeasurement]);

  // Calculate total measured distance
  const totalMeasuredDistance = useMemo(() => {
    if (measurePoints.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < measurePoints.length - 1; i++) {
      total += calculateDistance(
        measurePoints[i].lat, measurePoints[i].lng,
        measurePoints[i + 1].lat, measurePoints[i + 1].lng
      );
    }
    return total;
  }, [measurePoints]);

  // Handle measurement mode map clicks
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (!measureMode) return;
      
      const newPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
      
      // Create marker for this point
      const pointNumber = measurePoints.length + 1;
      const marker = L.marker([newPoint.lat, newPoint.lng], {
        icon: L.divIcon({
          className: 'measure-point-marker',
          html: `<div style="
            width: 24px; height: 24px;
            background: #F59E0B;
            border: 2px solid white;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 11px; font-weight: bold; color: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          ">${pointNumber}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
        zIndexOffset: 3000,
      }).addTo(map);
      measureMarkersRef.current.push(marker);

      // If we have a previous point, draw line and distance label
      if (measurePoints.length > 0) {
        const prevPoint = measurePoints[measurePoints.length - 1];
        
        // Draw polyline
        const polyline = L.polyline(
          [[prevPoint.lat, prevPoint.lng], [newPoint.lat, newPoint.lng]],
          {
            color: '#F59E0B',
            weight: 3,
            opacity: 0.9,
            dashArray: '8, 8',
            className: 'measure-line',
          }
        ).addTo(map);
        measurePolylinesRef.current.push(polyline);

        // Calculate segment distance
        const segmentDist = calculateDistance(prevPoint.lat, prevPoint.lng, newPoint.lat, newPoint.lng);
        
        // Create distance label at midpoint
        const midLat = (prevPoint.lat + newPoint.lat) / 2;
        const midLng = (prevPoint.lng + newPoint.lng) / 2;
        
        const label = L.marker([midLat, midLng], {
          icon: L.divIcon({
            className: 'measure-distance-label',
            html: `<div style="
              background: rgba(15, 23, 42, 0.95);
              border: 1px solid #F59E0B;
              border-radius: 4px;
              padding: 2px 6px;
              font-size: 11px;
              font-weight: 600;
              color: #F59E0B;
              white-space: nowrap;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            ">${formatDistance(segmentDist)}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          interactive: false,
          zIndexOffset: 3001,
        }).addTo(map);
        measureLabelsRef.current.push(label);
      }

      setMeasurePoints(prev => [...prev, newPoint]);
    };

    if (measureMode) {
      map.on('click', handleMapClick);
      map.getContainer().style.cursor = 'crosshair';
    } else {
      map.off('click', handleMapClick);
      map.getContainer().style.cursor = '';
    }

    return () => {
      map.off('click', handleMapClick);
      map.getContainer().style.cursor = '';
    };
  }, [measureMode, measurePoints]);

  // Undo last measurement point
  const undoLastPoint = useCallback(() => {
    if (!mapRef.current || measurePoints.length === 0) return;
    const map = mapRef.current;

    // Remove last marker
    const lastMarker = measureMarkersRef.current.pop();
    if (lastMarker) map.removeLayer(lastMarker);

    // Remove last polyline and label if they exist
    if (measurePoints.length > 1) {
      const lastPolyline = measurePolylinesRef.current.pop();
      if (lastPolyline) map.removeLayer(lastPolyline);
      
      const lastLabel = measureLabelsRef.current.pop();
      if (lastLabel) map.removeLayer(lastLabel);
    }

    setMeasurePoints(prev => prev.slice(0, -1));
  }, [measurePoints]);

  // ── POI layer: fetch and render when toggled on, clear when off ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing POI markers and circle
    poiMarkersRef.current.forEach(m => map.removeLayer(m));
    poiMarkersRef.current = [];
    if (poiCircleRef.current) { map.removeLayer(poiCircleRef.current); poiCircleRef.current = null; }

    if (!showPOI || !selectedVehicle?.gpsData) return;

    const lat = selectedVehicle.gpsData.latitude;
    const lng = selectedVehicle.gpsData.longitude;
    if (!lat || !lng) return;

    // Draw 1km radius circle
    poiCircleRef.current = L.circle([lat, lng], {
      radius: 1000,
      color: '#6366f1',
      fillColor: '#6366f1',
      fillOpacity: 0.05,
      weight: 1.5,
      dashArray: '6 4',
    }).addTo(map);

    setPoiLoading(true);
    fetchPOIsNear(lat, lng).then(items => {
      if (!mapRef.current) return;
      const markers = items.map(item => {
        const m = createPOIMarker(item);
        m.addTo(map);
        return m;
      });
      poiMarkersRef.current = markers;
      setPoiLoading(false);
    });
  }, [showPOI, selectedVehicle?.gpsData?.latitude, selectedVehicle?.gpsData?.longitude]);

  return (
    <div className="w-full h-full relative bg-slate-900">
      <div ref={mapContainerRef} className="w-full h-full" />
      
      {/* Map Controls - Left Center */}
      <div className="absolute top-1/2 -translate-y-1/2 left-4 z-map-overlay flex flex-col gap-2">
        {/* Softphone toggle — opens the phone panel (which docks to the right of
            this rail). Dot reflects ringing / on-call / registered / offline. */}
        <button
          onClick={toggleSoftphone}
          className={`relative p-2.5 border rounded-lg transition-all ${
            phoneRinging
              ? 'bg-red-500/20 border-red-500/50 text-red-400'
              : softphoneVisible || phoneOnCall
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                : 'bg-slate-800/90 border-white/10 text-slate-400 hover:bg-slate-700'
          }`}
          title={phoneRinging ? 'Incoming call' : phoneOnCall ? 'On call' : softphoneVisible ? 'Hide phone' : 'Show phone'}
        >
          <Phone className="w-4 h-4" />
          <span
            className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${
              phoneRinging
                ? 'bg-red-400 animate-pulse'
                : phoneOnCall
                  ? 'bg-emerald-400'
                  : phoneConnected
                    ? 'bg-emerald-500'
                    : 'bg-slate-500'
            }`}
          />
        </button>
        <button
          onClick={toggleShowTrails}
          className={`p-2.5 border rounded-lg transition-all ${
            showTrails 
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' 
              : 'bg-slate-800/90 border-white/10 text-slate-400 hover:bg-slate-700'
          }`}
          title={showTrails ? 'Hide vehicle trails' : 'Show vehicle trails'}
        >
          <Navigation className="w-4 h-4" />
        </button>
        {showTrails && vehicleTrails.size > 0 && (
          <button
            onClick={clearAllTrails}
            className="p-2.5 bg-slate-800/90 hover:bg-slate-700 border border-white/10 rounded-lg text-slate-400 hover:text-red-400 transition-all"
            title="Clear all trails"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        
        {/* Clustering Toggle */}
        <button
          onClick={() => setClusteringEnabled(!clusteringEnabled)}
          className={`p-2.5 border rounded-lg transition-all ${
            clusteringEnabled 
              ? 'bg-violet-500/20 border-violet-500/50 text-violet-400' 
              : 'bg-slate-800/90 border-white/10 text-slate-400 hover:bg-slate-700'
          }`}
          title={clusteringEnabled ? 'Disable clustering' : 'Enable clustering'}
        >
          <Grid3X3 className="w-4 h-4" />
        </button>
        
        {/* Map Layer Selector */}
        <div className="relative layer-selector">
          <button
            onClick={() => setShowLayerMenu(!showLayerMenu)}
            className={`p-2.5 border rounded-lg transition-all ${
              showLayerMenu 
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400' 
                : 'bg-slate-800/90 border-white/10 text-slate-400 hover:bg-slate-700'
            }`}
            title="Change map layer"
          >
            <Layers className="w-4 h-4" />
          </button>
          
          {showLayerMenu && (
            <div className="absolute left-full ml-2 top-0 bg-slate-800/95 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[140px]">
              <div className="px-3 py-2 border-b border-white/5 text-xs font-medium text-slate-400">
                Map Style
              </div>
              {MAP_LAYERS.map((layer) => {
                const Icon = layer.icon;
                const isSelected = selectedLayer === layer.id;
                return (
                  <button
                    key={layer.id}
                    onClick={() => switchLayer(layer.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      isSelected 
                        ? 'bg-cyan-500/20 text-cyan-400' 
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{layer.name}</span>
                    {isSelected && (
                      <span className="ml-auto text-[10px] text-cyan-400">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Geofence Controls */}
        <div className="relative geofence-selector">
          <button
            onClick={() => {
              if (!showGeofences) {
                setShowGeofences(true);
              }
              setShowGeofenceMenu(!showGeofenceMenu);
            }}
            className={`p-2.5 border rounded-lg transition-all ${
              showGeofences 
                ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' 
                : 'bg-slate-800/90 border-white/10 text-slate-400 hover:bg-slate-700'
            }`}
            title={showGeofences ? 'Geofence settings' : 'Show geofences'}
          >
            <Hexagon className="w-4 h-4" />
          </button>
          
          {showGeofenceMenu && (
            <div className="absolute left-full ml-2 top-0 bg-slate-800/95 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[180px]">
              <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">Geofences</span>
                <button
                  onClick={() => setShowGeofences(!showGeofences)}
                  className={`p-1 rounded transition-colors ${
                    showGeofences ? 'text-rose-400 hover:bg-rose-500/20' : 'text-slate-500 hover:bg-white/10'
                  }`}
                  title={showGeofences ? 'Hide all' : 'Show all'}
                >
                  {showGeofences ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>
              
              <div className="p-2 space-y-1">
                {(Object.keys(ZONE_COLORS) as Geofence['type'][]).map((type) => {
                  const isEnabled = geofenceFilters[type];
                  return (
                    <button
                      key={type}
                      onClick={() => setGeofenceFilters(prev => ({ ...prev, [type]: !prev[type] }))}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
                        isEnabled 
                          ? 'bg-white/5 text-white' 
                          : 'text-slate-500 hover:bg-white/5'
                      }`}
                    >
                      <div 
                        className="w-3 h-3 rounded-sm" 
                        style={{ 
                          backgroundColor: isEnabled ? ZONE_COLORS[type] : 'transparent',
                          border: `2px solid ${ZONE_COLORS[type]}`,
                        }} 
                      />
                      <span>{ZONE_LABELS[type]}</span>
                      {isEnabled && (
                        <span className="ml-auto text-[10px] opacity-60">
                          {geofences.filter(g => g.type === type).length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              
              <div className="px-3 py-2 border-t border-white/5 text-[10px] text-slate-500">
                {geofences.length} zones total
              </div>
            </div>
          )}
        </div>
        
        {/* POI Toggle */}
        <button
          onClick={() => setShowPOI(v => !v)}
          disabled={!selectedVehicle || poiLoading}
          className={`p-2.5 border rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            showPOI
              ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400'
              : 'bg-slate-800/90 border-white/10 text-slate-400 hover:bg-slate-700'
          }`}
          title={!selectedVehicle ? 'Select a vehicle first' : showPOI ? 'Hide nearby POIs (1km)' : 'Show nearby POIs (1km)'}
        >
          {poiLoading
            ? <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            : <MapPin className="w-4 h-4" />
          }
        </button>

        <button
          onClick={toggleMeasureMode}
          className={`p-2.5 border rounded-lg transition-all ${
            measureMode
              ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
              : 'bg-slate-800/90 border-white/10 text-slate-400 hover:bg-slate-700'
          }`}
          title={measureMode ? 'Exit measure mode' : 'Measure distance'}
        >
          <Ruler className="w-4 h-4" />
        </button>
        <div className="h-px bg-white/10 my-1" />
        <button
          onClick={() => { setClosureTab('history'); setClosurePanelOpen(true); }}
          className="p-2.5 bg-slate-800/90 hover:bg-slate-700 border border-white/10 rounded-lg text-white transition-all"
          title="History (Event Log Closure)"
        >
          <History className="w-4 h-4" />
        </button>
        <button
          onClick={() => { setClosureTab('wc'); setClosurePanelOpen(true); }}
          className="p-2.5 bg-slate-800/90 hover:bg-slate-700 border border-white/10 rounded-lg text-white transition-all"
          title="WC (Warning Console)"
        >
          <ShieldAlert className="w-4 h-4" />
        </button>
        <button
          onClick={handleFitAll}
          className="p-2.5 bg-slate-800/90 hover:bg-slate-700 border border-white/10 rounded-lg text-white transition-all"
          title="Fit all pinned vehicles"
        >
          <Crosshair className="w-4 h-4" />
        </button>
        <button
          onClick={toggleMapExpanded}
          className="p-2.5 bg-slate-800/90 hover:bg-slate-700 border border-white/10 rounded-lg text-white transition-all"
          title={mapExpanded ? 'Minimize' : 'Expand'}
        >
          {mapExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      <GlobalClosurePanel
        isOpen={closurePanelOpen}
        tab={closureTab}
        onClose={() => setClosurePanelOpen(false)}
        onChangeTab={(t) => { setClosureTab(t); setClosurePanelOpen(true); }}
      />

      {/* Pinned Vehicles Counter - Top Left */}
      <div className="absolute top-4 left-4 z-map-overlay space-y-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/90 border border-white/10 rounded-lg">
          <Pin className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-white">
            {displayVehicles.length} on map
          </span>
          {pinnedVehicles.size > displayVehicles.length && (
            <span className="text-[10px] text-amber-400" title="Some pinned vehicles have invalid GPS data">
              ({pinnedVehicles.size} pinned)
            </span>
          )}
          {displayVehicles.length > 0 && (
            <button
              onClick={clearPinnedVehicles}
              className="ml-1 p-1 hover:bg-white/10 rounded text-slate-400 hover:text-red-400 transition-colors"
              title="Clear all pinned"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
        
        {/* Enhanced Trail indicator */}
        {showTrails && vehicleTrails.size > 0 && (
          <div className="bg-slate-800/95 border border-white/10 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
              <Navigation className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-medium text-white">
                Live Trails
              </span>
              <span className="ml-auto text-[10px] text-slate-400 bg-white/5 px-1.5 py-0.5 rounded">
                {trailStats.vehicleCount} vehicle{trailStats.vehicleCount !== 1 ? 's' : ''}
              </span>
            </div>
            
            {/* Stats */}
            <div className="px-3 py-2 space-y-1.5">
              {/* Distance & Duration */}
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Distance</span>
                <span className="text-white font-medium">{formatDistance(trailStats.totalDistance)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Duration</span>
                <span className="text-white font-medium">{formatDuration(trailStats.duration)}</span>
              </div>
              
              {/* Speed info */}
              <div className="flex items-center gap-3 pt-1 border-t border-white/5">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">Avg</span>
                  <span className="text-[11px] text-emerald-400 font-medium">{trailStats.avgSpeed}</span>
                  <span className="text-[9px] text-slate-500">km/h</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">Max</span>
                  <span className="text-[11px] text-amber-400 font-medium">{trailStats.maxSpeed}</span>
                  <span className="text-[9px] text-slate-500">km/h</span>
                </div>
              </div>
              
              {/* Speed legend */}
              <div className="flex items-center gap-1 pt-1.5 border-t border-white/5">
                <div className="flex-1 h-1.5 rounded-full bg-gradient-to-r from-slate-500 via-blue-500 via-emerald-500 via-amber-500 via-orange-500 to-red-500" />
              </div>
              <div className="flex justify-between text-[9px] text-slate-500">
                <span>0</span>
                <span>20</span>
                <span>40</span>
                <span>60</span>
                <span>80+</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Measurement Info Panel */}
        {measureMode && (
          <div className="bg-slate-800/95 border border-amber-500/30 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-amber-500/10">
              <Ruler className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-medium text-amber-300">
                Measure Distance
              </span>
              <button
                onClick={toggleMeasureMode}
                className="ml-auto p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
                title="Exit measure mode"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            
            {/* Content */}
            <div className="px-3 py-2 space-y-2">
              {measurePoints.length === 0 ? (
                <p className="text-[11px] text-slate-400">
                  Click on the map to start measuring
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Points</span>
                    <span className="text-white font-medium">{measurePoints.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Total Distance</span>
                    <span className="text-amber-400 font-bold text-sm">{formatDistance(totalMeasuredDistance)}</span>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex gap-2 pt-2 border-t border-white/5">
                    <button
                      onClick={undoLastPoint}
                      disabled={measurePoints.length === 0}
                      className="flex-1 px-2 py-1.5 text-[10px] font-medium bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed rounded text-slate-300 transition-colors"
                    >
                      Undo
                    </button>
                    <button
                      onClick={clearMeasurement}
                      disabled={measurePoints.length === 0}
                      className="flex-1 px-2 py-1.5 text-[10px] font-medium bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed rounded text-red-400 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Empty State */}
      {displayVehicles.length === 0 && !currentTrack && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center p-8 bg-slate-800/80 rounded-2xl border border-white/10">
            <Pin className="w-12 h-12 text-slate-500 mx-auto mb-3" />
            <p className="text-white font-medium mb-1">No vehicles on map</p>
            <p className="text-sm text-slate-400">
              Pin vehicles from the list or click "Show on Map"
            </p>
          </div>
        </div>
      )}


      {/* Custom CSS */}
      <style>{`
        .vehicle-marker {
          background: transparent !important;
          border: none !important;
        }
        .custom-popup .leaflet-popup-content-wrapper {
          background: transparent;
          box-shadow: none;
          padding: 0;
        }
        .custom-popup .leaflet-popup-tip {
          display: none;
        }
        .custom-popup .leaflet-popup-content {
          margin: 0;
        }
        @keyframes ping {
          75%, 100% {
            transform: translate(-50%, -50%) scale(1.5);
            opacity: 0;
          }
        }
        /* Vehicle trail styling */
        .vehicle-trail-segment {
          filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.5));
        }
        .speed-tooltip {
          background: rgba(15, 23, 42, 0.9) !important;
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
          border-radius: 4px !important;
          padding: 2px 6px !important;
          font-size: 10px !important;
          font-weight: 500 !important;
          color: white !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        }
        .speed-tooltip::before {
          border-top-color: rgba(15, 23, 42, 0.9) !important;
        }
        /* Measurement tool styling */
        .measure-point-marker {
          background: transparent !important;
          border: none !important;
        }
        .measure-distance-label {
          background: transparent !important;
          border: none !important;
        }
        .measure-line {
          filter: drop-shadow(0 0 2px rgba(245, 158, 11, 0.5));
        }
        .event-tooltip {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .event-tooltip::before {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
