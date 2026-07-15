import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, ChevronRight, ChevronDown, Circle } from 'lucide-react';
import { useVehicleStore } from '@store/vehicleStore';
import { useVehicles } from '@hooks/useVehicles';

export default function VehiclePanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  
  const vehicles = useVehicleStore((state) => state.vehicles);
  const selectVehicle = useVehicleStore((state) => state.selectVehicle);
  const selectedVehicle = useVehicleStore((state) => state.selectedVehicle);
  const { companies } = useVehicles();

  // Filter vehicles by search query
  const filteredVehicles = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (!query) return vehicles;

    return new Map(
      Array.from(vehicles.entries()).filter(([_, vehicle]) =>
        vehicle.name.toLowerCase().includes(query) ||
        vehicle.vehicleId.toLowerCase().includes(query) ||
        vehicle.registrationNumber?.toLowerCase().includes(query)
      )
    );
  }, [vehicles, searchQuery]);

  // Group vehicles by company
  const groupedVehicles = useMemo(() => {
    const groups = new Map<string, typeof vehicles>();
    
    filteredVehicles.forEach((vehicle) => {
      if (!groups.has(vehicle.companyId)) {
        groups.set(vehicle.companyId, new Map());
      }
      groups.get(vehicle.companyId)!.set(vehicle.objectId, vehicle);
    });

    return groups;
  }, [filteredVehicles]);

  const toggleCompany = (companyId: string) => {
    setExpandedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        next.add(companyId);
      }
      return next;
    });
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      moving: 'bg-green-500 pulse-moving',
      idle: 'bg-amber-500',
      parked: 'bg-blue-500',
      offline: 'bg-slate-500',
      'gps-invalid': 'bg-pink-500',
      alarm: 'bg-red-500 pulse-alarm',
    };
    return colors[status] || 'bg-slate-500';
  };

  return (
    <div className="h-full flex flex-col">
      {/* Search Bar */}
      <div className="p-4 border-b border-glass-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search vehicles..."
            className="glass-input w-full pl-10 pr-10 py-2 rounded-lg text-sm"
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-glass-100 rounded">
            <Filter className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Vehicle Count */}
      <div className="px-4 py-2 text-xs text-slate-400">
        {filteredVehicles.size} vehicles
      </div>

      {/* Vehicle Tree */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
        {companies.map((company) => {
          const companyVehicles = groupedVehicles.get(company.id);
          if (!companyVehicles || companyVehicles.size === 0) return null;

          const isExpanded = expandedCompanies.has(company.id);

          return (
            <motion.div
              key={company.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-1"
            >
              {/* Company Header */}
              <button
                onClick={() => toggleCompany(company.id)}
                className="w-full glass-button px-3 py-2 rounded-lg flex items-center justify-between hover:glow-primary transition-all"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <span className="font-medium text-sm">{company.name}</span>
                </div>
                <span className="text-xs text-slate-400">
                  {companyVehicles.size}
                </span>
              </button>

              {/* Vehicles */}
              {isExpanded && (
                <div className="ml-6 space-y-1">
                  {Array.from(companyVehicles.values()).map((vehicle) => (
                    <button
                      key={vehicle.objectId}
                      onClick={() => selectVehicle(vehicle)}
                      className={`w-full px-3 py-2 rounded-lg flex items-center justify-between hover:bg-glass-100 transition-all group ${
                        selectedVehicle?.objectId === vehicle.objectId
                          ? 'glass-panel border border-primary-500'
                          : 'glass-input'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Circle
                          className={`w-2 h-2 rounded-full ${getStatusColor(
                            vehicle.status
                          )}`}
                        />
                        <span className="text-sm">{vehicle.name}</span>
                      </div>
                      {vehicle.gpsData && (
                        <span className="text-xs text-slate-400">
                          {vehicle.gpsData.speed.toFixed(0)} km/h
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}

        {filteredVehicles.size === 0 && (
          <div className="text-center py-8 text-slate-400">
            <p>No vehicles found</p>
          </div>
        )}
      </div>
    </div>
  );
}
