import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, 
  X, 
  Car, 
  MapPin, 
  Loader2,
  AlertCircle,
  ChevronRight,
  Cpu,
  Phone,
  Settings,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useVehicleSearch } from '@hooks/useVehicleSearch';

export default function VehicleSearch() {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const {
    results,
    loading,
    error,
    loadingDetails,
    includeDeactivated,
    search,
    getVehicleDetails,
    clearSearch,
    clearError,
    setIncludeDeactivated,
  } = useVehicleSearch();

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length >= 2) {
        search(query, { includeDeactivated });
        setIsOpen(true);
      } else {
        clearSearch();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, search, clearSearch, includeDeactivated]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + K to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // Escape to close
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelectVehicle = useCallback(async (objectId: number) => {
    const vehicle = await getVehicleDetails(objectId);
    if (vehicle) {
      setIsOpen(false);
      setQuery('');
    }
  }, [getVehicleDetails]);

  const handleClear = useCallback(() => {
    setQuery('');
    clearSearch();
    inputRef.current?.focus();
  }, [clearSearch]);

  const isFocused = isOpen || query.length > 0;

  return (
    <div ref={containerRef} className="relative w-56 md:w-72 lg:w-80 xl:w-96 z-dropdown">
      {/* Search Input */}
      <div className="lg-search-bar rounded-xl relative">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary-400" />
          ) : (
            <Search className={`w-4 h-4 transition-colors duration-150 ${isFocused ? 'text-primary-400' : 'text-slate-500'}`} />
          )}
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Search vehicles…"
          className="w-full pl-10 pr-24 py-2.5 bg-transparent rounded-xl
                     text-white placeholder-slate-500 text-sm
                     outline-none border-none relative z-10"
        />

        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 z-10">
          {!query && (
            <kbd className="lg-kbd px-1.5 py-0.5 rounded text-[10px] text-slate-500">
              Ctrl K
            </kbd>
          )}

          <button
            onClick={() => setShowOptions(!showOptions)}
            className={`p-1 rounded-md lg-icon-btn ${
              includeDeactivated || showOptions
                ? 'text-primary-400 !bg-primary-500/10'
                : 'text-slate-500'
            }`}
            title="Search options"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {query && (
            <button
              onClick={handleClear}
              className="p-1 rounded-md lg-icon-btn text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Search Options Dropdown */}
      <AnimatePresence>
        {showOptions && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.25, 1, 0.5, 1] }}
            className="absolute top-full mt-1.5 right-0 lg-dropdown
                       rounded-xl p-3 z-dropdown"
          >
            <button
              onClick={() => setIncludeDeactivated(!includeDeactivated)}
              className="flex items-center gap-2.5 text-sm whitespace-nowrap"
            >
              {includeDeactivated ? (
                <ToggleRight className="w-5 h-5 text-primary-400" />
              ) : (
                <ToggleLeft className="w-5 h-5 text-slate-500" />
              )}
              <span className={`text-[13px] ${includeDeactivated ? 'text-white' : 'text-slate-400'}`}>
                Include deactivated vehicles
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search Results Dropdown */}
      <AnimatePresence>
        {isOpen && (results.length > 0 || loading || error) && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
            className="absolute top-full mt-2 w-full lg-dropdown
                       rounded-xl overflow-hidden z-dropdown"
          >
            {/* Error State */}
            {error && (
              <div className="p-4 flex items-center gap-3 bg-red-500/8 border-b border-red-500/10 relative z-10">
                <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-400">Search Error</p>
                  <p className="text-xs text-red-400/60 mt-0.5">{error}</p>
                </div>
                <button onClick={clearError} className="p-1 rounded-md lg-icon-btn text-red-400 hover:text-red-300">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Loading State */}
            {loading && results.length === 0 && (
              <div className="py-10 flex flex-col items-center justify-center relative z-10">
                <div className="w-10 h-10 rounded-xl lg-chip flex items-center justify-center mb-3">
                  <Loader2 className="w-5 h-5 animate-spin text-primary-400" />
                </div>
                <p className="text-sm text-slate-400">Searching vehicles…</p>
              </div>
            )}

            {/* Results List */}
            {results.length > 0 && (
              <div className="max-h-80 overflow-y-auto relative z-10">
                <div className="px-4 py-2 flex items-center justify-between border-b border-white/5">
                  <span className="text-[11px] text-slate-500 uppercase tracking-wider">
                    Results
                  </span>
                  <span className="lg-status-pill px-1.5 py-0.5 text-[10px] font-bold text-slate-400 bg-white/5 rounded-md">
                    {results.length}
                  </span>
                </div>

                {results.map((vehicle, idx) => (
                  <button
                    key={vehicle.ObjectId}
                    onClick={() => handleSelectVehicle(vehicle.ObjectId)}
                    disabled={loadingDetails}
                    className={`w-full px-4 py-3 flex items-center gap-3 lg-result-item
                               text-left disabled:opacity-50
                               ${idx < results.length - 1 ? 'border-b border-white/4' : ''}
                               ${!vehicle.Enabled ? 'opacity-60' : ''}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-white/5 ${
                      vehicle.Enabled ? 'bg-primary-500/15' : 'bg-slate-500/15'
                    }`}>
                      <Car className={`w-5 h-5 ${vehicle.Enabled ? 'text-primary-400' : 'text-slate-500'}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm text-white font-semibold truncate">
                          {vehicle.PlateNumber}
                        </span>
                        {vehicle.Enabled ? (
                          <span className="lg-status-pill px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-emerald-500/15 text-emerald-400 tracking-wide">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="lg-status-pill px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-red-500/15 text-red-400 tracking-wide">
                            OFF
                          </span>
                        )}
                        {vehicle.MatchSource === 'engine' && (
                          <span className="lg-status-pill px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-amber-500/15 text-amber-400 tracking-wide">
                            ENGINE
                          </span>
                        )}
                        {vehicle.MatchSource === 'phone' && (
                          <span className="lg-status-pill px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-cyan-500/15 text-cyan-400 tracking-wide">
                            PHONE
                          </span>
                        )}
                      </div>

                      <p className="text-[13px] text-slate-400 truncate mt-0.5">
                        {vehicle.Description || 'No description'}
                      </p>

                      <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                        {vehicle.IMEI && (
                          <div className="flex items-center gap-1">
                            <Cpu className="w-3 h-3" />
                            <span className="truncate max-w-[100px]">{vehicle.IMEI}</span>
                          </div>
                        )}
                        {vehicle.EngineNo && (
                          <div className="flex items-center gap-1 text-amber-500/70">
                            <Settings className="w-3 h-3" />
                            <span>{vehicle.EngineNo}</span>
                          </div>
                        )}
                        {vehicle.PhoneNo && (
                          <div className="flex items-center gap-1 text-cyan-500/70">
                            <Phone className="w-3 h-3" />
                            <span>{vehicle.PhoneNo}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {loadingDetails ? (
                        <Loader2 className="w-4 h-4 text-primary-400 animate-spin" />
                      ) : (
                        <div className="flex items-center gap-1 text-slate-500 group-hover:text-slate-400">
                          <MapPin className="w-3.5 h-3.5" />
                          <ChevronRight className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* No Results */}
            {!loading && !error && results.length === 0 && query.trim().length >= 2 && (
              <div className="py-10 flex flex-col items-center justify-center relative z-10">
                <div className="w-12 h-12 rounded-xl lg-chip flex items-center justify-center mb-3">
                  <Car className="w-6 h-6 text-slate-500 opacity-50" />
                </div>
                <p className="text-sm font-medium text-slate-300">No vehicles found</p>
                <p className="text-xs text-slate-500 mt-1.5 text-center max-w-[220px]">
                  Try searching by plate, IMEI, engine number, or phone
                </p>
                {!includeDeactivated && (
                  <button
                    onClick={() => setIncludeDeactivated(true)}
                    className="mt-3 px-3 py-1.5 text-xs lg-btn-action rounded-lg
                             text-primary-400 bg-primary-500/10 hover:bg-primary-500/15"
                  >
                    Include deactivated vehicles
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
