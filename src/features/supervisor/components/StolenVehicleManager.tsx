/**
 * Stolen Vehicle Manager
 * Supervisor component to mark vehicles as stolen and manage tracking
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Search,
  Car,
  Plus,
  Trash2,
  MapPin,
  Phone,
  User,
  FileText,
  MessageSquare,
  RefreshCw,
  ExternalLink,
  X,
  CheckCircle,
  Clock,
  Navigation,
  Route,
  Bell,
} from 'lucide-react';

// Types
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
  last_lat?: number | string | null;
  last_lon?: number | string | null;
  last_speed: number;
  last_heading: number;
  last_address?: string;
  last_update?: string;
  total_distance_km: number | string;
  sms_alerts_enabled: boolean;
  sms_phone_number?: string;
  sms_interval_km?: number | string;
}

interface SearchResult {
  ObjectId: number;
  PlateNumber: string;
  Description?: string;
  Enabled?: boolean;
  IMEI?: string;
  MatchSource?: string;
  EngineNo?: string;
  PhoneNo?: string;
}

export default function StolenVehicleManager() {
  const [trackedVehicles, setTrackedVehicles] = useState<TrackedVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [showMarkModal, setShowMarkModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<SearchResult | null>(null);
  const [markLoading, setMarkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state for marking
  const [formData, setFormData] = useState({
    priority: 1,
    caseNumber: '',
    notes: '',
    smsAlertsEnabled: false,
    smsPhoneNumber: '',
    smsIntervalKm: 5,
  });
  
  // Fetch tracked vehicles
  const fetchTrackedVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/stolen-tracking/active');
      const data = await response.json();
      
      if (data.success) {
        setTrackedVehicles(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch tracked vehicles:', error);
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Search for vehicles
  const searchVehicles = useCallback(async (term: string) => {
    if (!term || term.length < 2) {
      setSearchResults([]);
      return;
    }
    
    setSearchLoading(true);
    try {
      const response = await fetch(`/api/vehicles/search?term=${encodeURIComponent(term)}&limit=10`);
      const data = await response.json();
      
      if (data.success) {
        setSearchResults(data.data || []);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearchLoading(false);
    }
  }, []);
  
  // Debounced search
  useEffect(() => {
    const timeout = setTimeout(() => {
      searchVehicles(searchTerm);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchTerm, searchVehicles]);
  
  // Mark vehicle as stolen
  const markAsStolen = async () => {
    if (!selectedVehicle) return;
    
    setMarkLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/stolen-tracking/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: selectedVehicle.ObjectId, // Using ObjectId as vehicleId
          objectId: selectedVehicle.ObjectId,
          vehicleReg: selectedVehicle.PlateNumber,
          vehicleDesc: selectedVehicle.Description,
          customerName: selectedVehicle.Description, // Description often contains customer info
          customerPhone: selectedVehicle.PhoneNo,
          markedBy: 'Supervisor', // TODO: Get from auth
          priority: formData.priority,
          caseNumber: formData.caseNumber || null,
          notes: formData.notes || null,
          smsAlertsEnabled: formData.smsAlertsEnabled,
          smsPhoneNumber: formData.smsPhoneNumber || null,
          smsIntervalKm: formData.smsIntervalKm,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Refresh list and close modal
        fetchTrackedVehicles();
        setShowMarkModal(false);
        resetForm();
      } else {
        setError(data.error || 'Failed to mark vehicle');
      }
    } catch (error: any) {
      setError(error.message || 'Failed to mark vehicle');
    } finally {
      setMarkLoading(false);
    }
  };
  
  // Remove vehicle from tracking
  const removeFromTracking = async (id: number, status: 'recovered' | 'cancelled') => {
    try {
      const response = await fetch(`/api/stolen-tracking/${id}?status=${status}`, {
        method: 'DELETE',
      });
      
      const data = await response.json();
      
      if (data.success) {
        fetchTrackedVehicles();
      }
    } catch (error) {
      console.error('Failed to remove vehicle:', error);
    }
  };
  
  // Reset form
  const resetForm = () => {
    setSelectedVehicle(null);
    setSearchTerm('');
    setSearchResults([]);
    setFormData({
      priority: 1,
      caseNumber: '',
      notes: '',
      smsAlertsEnabled: false,
      smsPhoneNumber: '',
      smsIntervalKm: 5,
    });
    setError(null);
  };
  
  // Initialize
  useEffect(() => {
    fetchTrackedVehicles();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchTrackedVehicles, 30000);
    return () => clearInterval(interval);
  }, [fetchTrackedVehicles]);
  
  // Priority config
  const PRIORITIES = [
    { value: 1, label: 'CRITICAL', color: 'bg-red-500', textColor: 'text-red-400' },
    { value: 2, label: 'HIGH', color: 'bg-amber-500', textColor: 'text-amber-400' },
    { value: 3, label: 'MEDIUM', color: 'bg-blue-500', textColor: 'text-blue-400' },
  ];
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Stolen Vehicle Tracking</h2>
            <p className="text-xs text-slate-400">
              Mark vehicles as stolen to display on the tracking wall
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <a
            href="/tracking-wall"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 rounded-lg transition-colors text-sm"
          >
            <ExternalLink className="w-4 h-4" />
            Open Tracking Wall
          </a>
          
          <button
            onClick={fetchTrackedVehicles}
            disabled={loading}
            className="p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          
          <button
            onClick={() => setShowMarkModal(true)}
            disabled={trackedVehicles.length >= 10}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-slate-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Mark as Stolen
          </button>
        </div>
      </div>
      
      {/* Tracked Vehicles List */}
      {trackedVehicles.length === 0 ? (
        <div className="text-center py-12 bg-white/5 rounded-xl border border-white/10">
          <Car className="w-12 h-12 mx-auto text-slate-600 mb-3" />
          <h3 className="text-lg font-medium text-slate-400 mb-1">No Vehicles Being Tracked</h3>
          <p className="text-sm text-slate-500">
            Click "Mark as Stolen" to add a vehicle to the tracking wall
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {trackedVehicles.map((vehicle) => (
            <motion.div
              key={vehicle.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-4 rounded-xl border ${
                vehicle.priority === 1 ? 'border-red-500/50 bg-red-500/10' :
                vehicle.priority === 2 ? 'border-amber-500/50 bg-amber-500/10' :
                'border-blue-500/50 bg-blue-500/10'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`w-5 h-5 ${
                    vehicle.priority === 1 ? 'text-red-400 animate-pulse' :
                    vehicle.priority === 2 ? 'text-amber-400' : 'text-blue-400'
                  }`} />
                  <div>
                    <div className="text-lg font-bold text-white">{vehicle.vehicle_reg}</div>
                    {vehicle.vehicle_desc && (
                      <div className="text-xs text-slate-400">{vehicle.vehicle_desc}</div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 text-xs font-bold rounded ${
                    vehicle.priority === 1 ? 'bg-red-500 text-white' :
                    vehicle.priority === 2 ? 'bg-amber-500 text-white' :
                    'bg-blue-500 text-white'
                  }`}>
                    {PRIORITIES.find(p => p.value === vehicle.priority)?.label || 'MEDIUM'}
                  </span>
                </div>
              </div>
              
              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center p-2 bg-black/20 rounded-lg">
                  <div className="text-lg font-bold text-white">{vehicle.last_speed || 0}</div>
                  <div className="text-xs text-slate-400">km/h</div>
                </div>
                <div className="text-center p-2 bg-black/20 rounded-lg">
                  <div className="text-lg font-bold text-white">
                    {parseFloat(String(vehicle.total_distance_km || 0)).toFixed(1)}
                  </div>
                  <div className="text-xs text-slate-400">km traveled</div>
                </div>
                <div className="text-center p-2 bg-black/20 rounded-lg">
                  <div className="text-lg font-bold text-white">
                    {vehicle.last_update ? 
                      Math.floor((Date.now() - new Date(vehicle.last_update).getTime()) / 60000) + 'm' :
                      'N/A'
                    }
                  </div>
                  <div className="text-xs text-slate-400">ago</div>
                </div>
              </div>
              
              {/* Info */}
              <div className="space-y-1 text-sm mb-3">
                {vehicle.customer_name && (
                  <div className="flex items-center gap-2 text-slate-300">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    {vehicle.customer_name}
                  </div>
                )}
                {vehicle.case_number && (
                  <div className="flex items-center gap-2 text-slate-300">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    Case: {vehicle.case_number}
                  </div>
                )}
                {vehicle.sms_alerts_enabled && (
                  <div className="flex items-center gap-2 text-emerald-400">
                    <MessageSquare className="w-3.5 h-3.5" />
                    SMS to {vehicle.sms_phone_number} every {vehicle.sms_interval_km || 5}km
                  </div>
                )}
              </div>
              
              {/* Actions */}
              <div className="flex items-center gap-2">
                {vehicle.last_lat && vehicle.last_lon && (
                  <a
                    href={`https://maps.google.com/?q=${vehicle.last_lat},${vehicle.last_lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg text-sm transition-colors"
                  >
                    <MapPin className="w-4 h-4" />
                    View on Map
                  </a>
                )}
                
                <button
                  onClick={() => removeFromTracking(vehicle.id, 'recovered')}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg text-sm transition-colors"
                >
                  <CheckCircle className="w-4 h-4" />
                  Recovered
                </button>
                
                <button
                  onClick={() => removeFromTracking(vehicle.id, 'cancelled')}
                  className="flex items-center justify-center p-2 bg-slate-500/20 hover:bg-slate-500/30 text-slate-400 rounded-lg transition-colors"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      
      {/* Capacity indicator */}
      <div className="text-center text-sm text-slate-500">
        {trackedVehicles.length}/10 vehicles being tracked
      </div>
      
      {/* Mark as Stolen Modal */}
      <AnimatePresence>
        {showMarkModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => { setShowMarkModal(false); resetForm(); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-xl bg-slate-900 rounded-2xl border border-white/10 shadow-2xl"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Mark Vehicle as Stolen</h3>
                    <p className="text-xs text-slate-400">Add to tracking wall for real-time monitoring</p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowMarkModal(false); resetForm(); }}
                  className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Modal Body */}
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Vehicle Search */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Search Vehicle
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      placeholder="Enter plate number, IMEI, or phone..."
                      className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                      disabled={!!selectedVehicle}
                    />
                    {searchLoading && (
                      <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 animate-spin" />
                    )}
                  </div>
                  
                  {/* Search Results */}
                  {!selectedVehicle && searchResults.length > 0 && (
                    <div className="mt-2 bg-white/5 rounded-xl border border-white/10 max-h-48 overflow-y-auto">
                      {searchResults.map((result, i) => (
                        <button
                          key={i}
                          onClick={() => setSelectedVehicle(result)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/10 transition-colors text-left border-b border-white/5 last:border-0"
                        >
                          <div>
                            <div className="font-medium text-white">{result.PlateNumber}</div>
                            <div className="text-xs text-slate-400">
                              {result.Description || 'No description'}
                              {result.PhoneNo && ` • ${result.PhoneNo}`}
                              {result.MatchSource && ` (${result.MatchSource})`}
                            </div>
                          </div>
                          <Plus className="w-5 h-5 text-slate-400" />
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* Selected Vehicle */}
                  {selectedVehicle && (
                    <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Car className="w-5 h-5 text-red-400" />
                          <span className="font-bold text-white">{selectedVehicle.PlateNumber}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {selectedVehicle.Description || 'No description'}
                          {selectedVehicle.PhoneNo && ` • ${selectedVehicle.PhoneNo}`}
                        </div>
                      </div>
                      <button
                        onClick={resetForm}
                        className="p-1 hover:bg-white/10 rounded transition-colors"
                      >
                        <X className="w-4 h-4 text-slate-400" />
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Priority */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Priority Level
                  </label>
                  <div className="flex gap-2">
                    {PRIORITIES.map(p => (
                      <button
                        key={p.value}
                        onClick={() => setFormData(prev => ({ ...prev, priority: p.value }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                          formData.priority === p.value
                            ? `${p.color} text-white`
                            : 'bg-white/5 text-slate-400 hover:bg-white/10'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Case Number */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Case/FIR Number (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.caseNumber}
                    onChange={e => setFormData(prev => ({ ...prev, caseNumber: e.target.value }))}
                    placeholder="e.g., FIR-2026-1234"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                </div>
                
                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Notes (Optional)
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Any additional information..."
                    rows={2}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
                  />
                </div>
                
                {/* SMS Alerts */}
                <div className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-emerald-400" />
                      <span className="font-medium text-white">SMS Alerts</span>
                    </div>
                    <button
                      onClick={() => setFormData(prev => ({ ...prev, smsAlertsEnabled: !prev.smsAlertsEnabled }))}
                      className={`w-12 h-6 rounded-full transition-colors ${
                        formData.smsAlertsEnabled ? 'bg-emerald-500' : 'bg-slate-600'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                        formData.smsAlertsEnabled ? 'translate-x-6' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                  
                  {formData.smsAlertsEnabled && (
                    <div className="space-y-3 pt-3 border-t border-white/10">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Phone Number</label>
                        <input
                          type="tel"
                          value={formData.smsPhoneNumber}
                          onChange={e => setFormData(prev => ({ ...prev, smsPhoneNumber: e.target.value }))}
                          placeholder="+92 300 1234567"
                          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Send SMS every (km)</label>
                        <input
                          type="number"
                          value={formData.smsIntervalKm}
                          onChange={e => setFormData(prev => ({ ...prev, smsIntervalKm: parseInt(e.target.value) || 5 }))}
                          min={1}
                          max={50}
                          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Error */}
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}
              </div>
              
              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
                <button
                  onClick={() => { setShowMarkModal(false); resetForm(); }}
                  className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={markAsStolen}
                  disabled={!selectedVehicle || markLoading}
                  className="flex items-center gap-2 px-6 py-2 bg-red-500 hover:bg-red-600 disabled:bg-slate-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  {markLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" />
                  )}
                  Mark as Stolen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
