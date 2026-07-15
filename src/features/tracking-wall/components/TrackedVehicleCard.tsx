/**
 * Tracked Vehicle Card
 * Individual vehicle display card for the tracking wall
 * Features: Live map, speed, heading, distance, and alerts
 */

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Navigation,
  Gauge,
  Route,
  Clock,
  AlertTriangle,
  MapPin,
  Phone,
  User,
  FileText,
  ExternalLink,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface TrackedVehicle {
  id: number;
  vehicle_id: number;
  object_id: number;
  vehicle_reg: string;
  vehicle_desc?: string;
  customer_name?: string;
  customer_phone?: string;
  marked_by?: string;
  marked_at: string;
  priority: number;
  case_number?: string;
  notes?: string;
  status: string;
  last_lat?: number | string;
  last_lon?: number | string;
  last_speed: number;
  last_heading: number;
  last_address?: string;
  last_update?: string;
  total_distance_km: number | string;
  sms_alerts_enabled: boolean;
  sms_phone_number?: string;
}

interface Props {
  vehicle: TrackedVehicle;
}

// Priority colors and labels
const PRIORITY_CONFIG = {
  1: { color: 'red', label: 'CRITICAL', bgClass: 'bg-red-500/20', borderClass: 'border-red-500/50', textClass: 'text-red-400' },
  2: { color: 'amber', label: 'HIGH', bgClass: 'bg-amber-500/20', borderClass: 'border-amber-500/50', textClass: 'text-amber-400' },
  3: { color: 'blue', label: 'MEDIUM', bgClass: 'bg-blue-500/20', borderClass: 'border-blue-500/50', textClass: 'text-blue-400' },
};

export default function TrackedVehicleCard({ vehicle }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const [trailPoints, setTrailPoints] = useState<[number, number][]>([]);
  
  const priority = PRIORITY_CONFIG[vehicle.priority as keyof typeof PRIORITY_CONFIG] || PRIORITY_CONFIG[3];
  
  // Time since marked
  const timeSinceMarked = () => {
    const marked = new Date(vehicle.marked_at);
    const now = new Date();
    const diff = now.getTime() - marked.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };
  
  // Time since last update
  const timeSinceUpdate = () => {
    if (!vehicle.last_update) return 'N/A';
    const updated = new Date(vehicle.last_update);
    const now = new Date();
    const diff = Math.floor((now.getTime() - updated.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };
  
  // Heading to direction
  const getDirection = (heading: number) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(heading / 45) % 8;
    return directions[index];
  };
  
  // Parse lat/lon as numbers (they may come as strings from DB)
  const lat = vehicle.last_lat ? parseFloat(String(vehicle.last_lat)) : null;
  const lon = vehicle.last_lon ? parseFloat(String(vehicle.last_lon)) : null;
  const hasLocation = lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon);
  
  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    
    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });
    
    // Dark map tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);
    
    mapInstanceRef.current = map;
    
    // Set initial view
    if (hasLocation && lat && lon) {
      map.setView([lat, lon], 15);
      
      // Create custom marker
      const icon = L.divIcon({
        className: 'custom-marker',
        html: `
          <div style="
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, #ef4444, #dc2626);
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            transform: rotate(${vehicle.last_heading}deg);
          ">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      
      markerRef.current = L.marker([lat, lon], { icon }).addTo(map);
      
      // Initialize trail
      trailRef.current = L.polyline([], {
        color: '#ef4444',
        weight: 3,
        opacity: 0.7,
      }).addTo(map);
    }
    
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);
  
  // Update marker position when location changes
  useEffect(() => {
    if (!mapInstanceRef.current || !hasLocation || !lat || !lon) return;
    
    const newPos: [number, number] = [lat, lon];
    
    // Update marker
    if (markerRef.current) {
      markerRef.current.setLatLng(newPos);
      
      // Update marker rotation
      const iconHtml = `
        <div style="
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, ${vehicle.last_speed > 0 ? '#ef4444' : '#6b7280'}, ${vehicle.last_speed > 0 ? '#dc2626' : '#4b5563'});
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 4px 12px ${vehicle.last_speed > 0 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(107, 114, 128, 0.5)'};
          display: flex;
          align-items: center;
          justify-content: center;
          transform: rotate(${vehicle.last_heading}deg);
        ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
          </svg>
        </div>
      `;
      
      const icon = L.divIcon({
        className: 'custom-marker',
        html: iconHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      
      markerRef.current.setIcon(icon);
    }
    
    // Update trail
    setTrailPoints(prev => {
      const newPoints = [...prev, newPos].slice(-50); // Keep last 50 points
      if (trailRef.current) {
        trailRef.current.setLatLngs(newPoints);
      }
      return newPoints;
    });
    
    // Pan map to follow vehicle
    mapInstanceRef.current.panTo(newPos, { animate: true, duration: 0.5 });
    
  }, [lat, lon, vehicle.last_heading, vehicle.last_speed]);
  
  // Google Maps link
  const googleMapsUrl = hasLocation
    ? `https://maps.google.com/?q=${lat},${lon}`
    : null;
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex flex-col rounded-xl border ${priority.borderClass} overflow-hidden bg-slate-900/90`}
    >
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2 ${priority.bgClass} border-b ${priority.borderClass}`}>
        <div className="flex items-center gap-3">
          <AlertTriangle className={`w-5 h-5 ${priority.textClass} ${vehicle.priority === 1 ? 'animate-pulse' : ''}`} />
          <span className={`text-sm font-bold uppercase ${priority.textClass}`}>{priority.label}</span>
          {vehicle.case_number && (
            <span className="text-xs text-gray-400">Case: {vehicle.case_number}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Clock className="w-3.5 h-3.5" />
          <span>Tracking: {timeSinceMarked()}</span>
        </div>
      </div>
      
      {/* Map Section */}
      <div className="flex-1 relative min-h-[200px]">
        <div ref={mapRef} className="absolute inset-0" />
        
        {/* No Location Overlay */}
        {!hasLocation ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-800/90">
            <div className="text-center text-gray-500">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Waiting for GPS signal...</p>
            </div>
          </div>
        ) : null}
        
        {/* Speed Overlay */}
        <div className="absolute top-2 left-2 flex flex-col gap-2">
          {/* Speed */}
          <div className={`px-3 py-1.5 rounded-lg backdrop-blur-sm ${
            vehicle.last_speed > 80 ? 'bg-red-500/80' : 
            vehicle.last_speed > 0 ? 'bg-amber-500/80' : 'bg-gray-500/80'
          }`}>
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-white" />
              <span className="text-lg font-bold text-white">{vehicle.last_speed}</span>
              <span className="text-xs text-white/80">km/h</span>
            </div>
          </div>
          
          {/* Heading */}
          <div className="px-3 py-1.5 rounded-lg bg-slate-800/80 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <Navigation 
                className="w-4 h-4 text-blue-400" 
                style={{ transform: `rotate(${vehicle.last_heading}deg)` }}
              />
              <span className="text-sm font-medium text-white">
                {vehicle.last_heading}° {getDirection(vehicle.last_heading)}
              </span>
            </div>
          </div>
        </div>
        
        {/* Distance Overlay */}
        <div className="absolute top-2 right-2 px-3 py-1.5 rounded-lg bg-emerald-500/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Route className="w-4 h-4 text-white" />
            <span className="text-sm font-bold text-white">
              {parseFloat(String(vehicle.total_distance_km || 0)).toFixed(2)} km
            </span>
          </div>
        </div>
        
        {/* Google Maps Link */}
        {googleMapsUrl && (
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-2 right-2 p-2 rounded-lg bg-blue-500/80 hover:bg-blue-500 backdrop-blur-sm transition-colors"
            title="Open in Google Maps"
          >
            <ExternalLink className="w-4 h-4 text-white" />
          </a>
        )}
      </div>
      
      {/* Info Section */}
      <div className="px-4 py-3 bg-slate-800/50 border-t border-white/5">
        {/* Vehicle Info */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-xl font-bold text-white">{vehicle.vehicle_reg}</h3>
            {vehicle.vehicle_desc && (
              <p className="text-xs text-gray-400">{vehicle.vehicle_desc}</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Last Update</div>
            <div className={`text-sm font-medium ${
              !vehicle.last_update ? 'text-gray-500' :
              timeSinceUpdate().includes('s') ? 'text-emerald-400' :
              timeSinceUpdate().includes('m') ? 'text-amber-400' : 'text-red-400'
            }`}>
              {timeSinceUpdate()}
            </div>
          </div>
        </div>
        
        {/* Address */}
        {vehicle.last_address && (
          <div className="flex items-start gap-2 mb-2 text-sm text-gray-300">
            <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-500" />
            <span className="line-clamp-2">{vehicle.last_address}</span>
          </div>
        )}
        
        {/* Customer Info */}
        <div className="flex items-center gap-4 text-xs text-gray-400">
          {vehicle.customer_name && (
            <div className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              <span>{vehicle.customer_name}</span>
            </div>
          )}
          {vehicle.customer_phone && (
            <div className="flex items-center gap-1">
              <Phone className="w-3.5 h-3.5" />
              <span>{vehicle.customer_phone}</span>
            </div>
          )}
          {vehicle.notes && (
            <div className="flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" />
              <span className="truncate max-w-[100px]" title={vehicle.notes}>{vehicle.notes}</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
