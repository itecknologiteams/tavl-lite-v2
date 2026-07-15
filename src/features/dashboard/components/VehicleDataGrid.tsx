import { useMemo, useState, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Filter,
  MapPin,
  Pin,
  PinOff,
  Eye,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
  Car,
  Activity,
  Clock,
  WifiOff,
  AlertCircle,
  X,
  Check,
  Columns,
} from 'lucide-react';
import { useVehicleStore } from '@store/vehicleStore';
import type { Vehicle, VehicleStatus } from '@apptypes/vehicle';
import { formatDistanceToNow } from 'date-fns';

type SortField = 'name' | 'status' | 'speed' | 'lastUpdate';
type SortDirection = 'asc' | 'desc';

const STATUS_CONFIG: Record<VehicleStatus, { label: string; color: string; bgColor: string; icon: any }> = {
  moving: { label: 'Moving', color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', icon: Activity },
  idle: { label: 'Idle', color: 'text-amber-400', bgColor: 'bg-amber-500/20', icon: Clock },
  parked: { label: 'Parked', color: 'text-blue-400', bgColor: 'bg-blue-500/20', icon: MapPin },
  offline: { label: 'Offline', color: 'text-slate-400', bgColor: 'bg-slate-500/20', icon: WifiOff },
  'gps-invalid': { label: 'GPS Invalid', color: 'text-pink-400', bgColor: 'bg-pink-500/20', icon: AlertCircle },
  alarm: { label: 'Alarm', color: 'text-red-400', bgColor: 'bg-red-500/20', icon: AlertCircle },
};

export default function VehicleDataGrid() {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const vehicles = useVehicleStore((state) => state.vehicles);
  const pinnedVehicles = useVehicleStore((state) => state.pinnedVehicles);
  const selectedVehicle = useVehicleStore((state) => state.selectedVehicle);
  const searchQuery = useVehicleStore((state) => state.searchQuery);
  const filterStatus = useVehicleStore((state) => state.filterStatus);
  
  const setSearchQuery = useVehicleStore((state) => state.setSearchQuery);
  const setFilterStatus = useVehicleStore((state) => state.setFilterStatus);
  const selectVehicle = useVehicleStore((state) => state.selectVehicle);
  const togglePinVehicle = useVehicleStore((state) => state.togglePinVehicle);
  const showOnMap = useVehicleStore((state) => state.showOnMap);
  
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showFilters, setShowFilters] = useState(false);

  // Filter and sort vehicles
  const filteredVehicles = useMemo(() => {
    let result = Array.from(vehicles.values());
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (v) =>
          v.name.toLowerCase().includes(query) ||
          v.registrationNumber?.toLowerCase().includes(query) ||
          v.objectId.includes(query)
      );
    }
    
    // Status filter
    if (filterStatus) {
      result = result.filter((v) => v.status === filterStatus);
    }
    
    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'speed':
          comparison = (a.gpsData?.speed || 0) - (b.gpsData?.speed || 0);
          break;
        case 'lastUpdate':
          const aTime = a.gpsData?.gpsTime ? new Date(a.gpsData.gpsTime).getTime() : 0;
          const bTime = b.gpsData?.gpsTime ? new Date(b.gpsData.gpsTime).getTime() : 0;
          comparison = aTime - bTime;
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    // Put pinned vehicles first
    const pinned = result.filter((v) => pinnedVehicles.has(v.objectId));
    const unpinned = result.filter((v) => !pinnedVehicles.has(v.objectId));
    
    return [...pinned, ...unpinned];
  }, [vehicles, searchQuery, filterStatus, sortField, sortDirection, pinnedVehicles]);

  // Virtual list
  const rowVirtualizer = useVirtualizer({
    count: filteredVehicles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 10,
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp className="w-3 h-3" />
    ) : (
      <ChevronDown className="w-3 h-3" />
    );
  };

  const StatusBadge = ({ status }: { status: VehicleStatus }) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.offline;
    const Icon = config.icon;
    
    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}>
        <Icon className="w-3 h-3" />
        <span>{config.label}</span>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-dark-100/50">
      {/* Header with Search and Filters */}
      <div className="flex-shrink-0 p-4 border-b border-white/5">
        <div className="flex items-center gap-3 mb-3">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vehicles..."
              className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/25 transition-all outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-3 h-3 text-slate-400" />
              </button>
            )}
          </div>
          
          {/* Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2.5 rounded-xl border transition-all ${
              showFilters || filterStatus
                ? 'bg-primary-500/20 border-primary-500/50 text-primary-400'
                : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
            }`}
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>

        {/* Filter Bar */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 pt-2">
                <span className="text-xs text-slate-500">Status:</span>
                {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                  <button
                    key={key}
                    onClick={() => setFilterStatus(filterStatus === key ? null : key as VehicleStatus)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      filterStatus === key
                        ? `${config.bgColor} ${config.color} ring-1 ring-current`
                        : 'bg-white/5 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    {config.label}
                  </button>
                ))}
                {filterStatus && (
                  <button
                    onClick={() => setFilterStatus(null)}
                    className="px-2 py-1 text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Results Count */}
        <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
          <span>
            {filteredVehicles.length.toLocaleString()} vehicles
            {pinnedVehicles.size > 0 && (
              <span className="text-primary-400 ml-1">
                ({pinnedVehicles.size} pinned)
              </span>
            )}
          </span>
          <span>
            Sorted by {sortField} ({sortDirection})
          </span>
        </div>
      </div>

      {/* Table Header */}
      <div className="flex-shrink-0 grid grid-cols-12 gap-2 px-4 py-2 border-b border-white/5 text-xs font-medium text-slate-400 uppercase tracking-wider">
        <div className="col-span-1 flex items-center justify-center">
          <Pin className="w-3 h-3" />
        </div>
        <button
          onClick={() => handleSort('name')}
          className="col-span-4 flex items-center gap-1 hover:text-white transition-colors text-left"
        >
          Vehicle <SortIcon field="name" />
        </button>
        <button
          onClick={() => handleSort('status')}
          className="col-span-2 flex items-center gap-1 hover:text-white transition-colors"
        >
          Status <SortIcon field="status" />
        </button>
        <button
          onClick={() => handleSort('speed')}
          className="col-span-2 flex items-center gap-1 hover:text-white transition-colors"
        >
          Speed <SortIcon field="speed" />
        </button>
        <button
          onClick={() => handleSort('lastUpdate')}
          className="col-span-2 flex items-center gap-1 hover:text-white transition-colors"
        >
          Last Update <SortIcon field="lastUpdate" />
        </button>
        <div className="col-span-1 text-right">Actions</div>
      </div>

      {/* Virtual List */}
      <div ref={parentRef} className="flex-1 min-h-0 overflow-auto">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const vehicle = filteredVehicles[virtualRow.index];
            const isPinned = pinnedVehicles.has(vehicle.objectId);
            const isSelected = selectedVehicle?.objectId === vehicle.objectId;
            
            return (
              <div
                key={vehicle.objectId}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  onClick={() => selectVehicle(isSelected ? null : vehicle)}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 mx-2 rounded-lg cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-primary-500/20 border border-primary-500/50'
                      : isPinned
                      ? 'bg-white/5 border border-white/10 hover:bg-white/10'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {/* Pin Button */}
                  <div className="col-span-1 flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePinVehicle(vehicle.objectId, vehicle);
                      }}
                      className={`p-1.5 rounded-lg transition-all ${
                        isPinned
                          ? 'text-primary-400 bg-primary-500/20'
                          : 'text-slate-500 hover:text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {isPinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Vehicle Name */}
                  <div className="col-span-4 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      STATUS_CONFIG[vehicle.status]?.bgColor || 'bg-slate-500/20'
                    }`}>
                      <Car className={`w-4 h-4 ${STATUS_CONFIG[vehicle.status]?.color || 'text-slate-400'}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-white truncate">{vehicle.name}</div>
                      {vehicle.registrationNumber && (
                        <div className="text-xs text-slate-500 truncate">{vehicle.registrationNumber}</div>
                      )}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="col-span-2 flex items-center">
                    <StatusBadge status={vehicle.status} />
                  </div>

                  {/* Speed */}
                  <div className="col-span-2 flex items-center">
                    <span className={`font-mono text-sm ${
                      (vehicle.gpsData?.speed || 0) > 0 ? 'text-emerald-400' : 'text-slate-500'
                    }`}>
                      {vehicle.gpsData?.speed?.toFixed(0) || '0'} km/h
                    </span>
                  </div>

                  {/* Last Update */}
                  <div className="col-span-2 flex items-center">
                    <span className="text-sm text-slate-400">
                      {vehicle.gpsData?.gpsTime
                        ? formatDistanceToNow(new Date(vehicle.gpsData.gpsTime), { addSuffix: true })
                        : 'N/A'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="col-span-1 flex items-center justify-end">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        showOnMap(vehicle);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-primary-400 hover:bg-primary-500/20 transition-all"
                      title="Show on Map"
                    >
                      <MapPin className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {filteredVehicles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Car className="w-12 h-12 mb-3 opacity-50" />
            <p className="font-medium">No vehicles found</p>
            <p className="text-sm text-slate-500">Try adjusting your search or filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
