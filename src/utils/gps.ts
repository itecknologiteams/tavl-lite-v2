import { differenceInMinutes } from 'date-fns';

/**
 * Calculate GPS status quality based on last update time and ignition status
 * Matches the Python implementation
 */
export function calculateGPSStatus(
  gpsTime: Date,
  ignition: boolean
): 'Excellent' | 'Very Good' | 'Good' | 'Average' | 'Poor' {
  const now = new Date();
  const minutesDiff = differenceInMinutes(now, gpsTime);

  if (ignition) {
    // Engine is ON
    if (minutesDiff <= 5) return 'Excellent';
    if (minutesDiff <= 15) return 'Very Good';
    if (minutesDiff <= 30) return 'Good';
    if (minutesDiff <= 60) return 'Average';
    return 'Poor';
  } else {
    // Engine is OFF
    if (minutesDiff <= 60) return 'Excellent';
    if (minutesDiff <= 180) return 'Very Good'; // 3 hours
    if (minutesDiff <= 360) return 'Good'; // 6 hours
    if (minutesDiff <= 720) return 'Average'; // 12 hours
    return 'Poor';
  }
}

/**
 * Get color for GPS status
 */
export function getGPSStatusColor(
  status: ReturnType<typeof calculateGPSStatus>
): string {
  const colors = {
    Excellent: '#10B981', // Green
    'Very Good': '#3B82F6', // Blue
    Good: '#F59E0B', // Amber
    Average: '#F97316', // Orange
    Poor: '#EF4444', // Red
  };
  return colors[status];
}

/**
 * Format time difference in human-readable format
 */
export function formatTimeDifference(date: Date): string {
  const now = new Date();
  const minutes = differenceInMinutes(now, date);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

/**
 * Convert degrees to compass direction
 */
export function degreesToCompass(degrees: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

/**
 * Format coordinates for display
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lng).toFixed(6)}° ${lngDir}`;
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
