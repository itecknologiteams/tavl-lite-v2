const cacheShort = new Map<string, string>();
const cacheFull = new Map<string, string>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function formatAddress(data: any): string {
  if (!data?.address) {
    return data?.display_name?.split(',').slice(0, 3).join(', ') || '';
  }
  const a = data.address;
  const parts: string[] = [];

  if (a.house_number && a.road) parts.push(`${a.house_number} ${a.road}`);
  else if (a.road) parts.push(a.road);
  else if (a.pedestrian) parts.push(a.pedestrian);

  if (a.suburb) parts.push(a.suburb);
  else if (a.neighbourhood) parts.push(a.neighbourhood);
  else if (a.village) parts.push(a.village);
  else if (a.residential) parts.push(a.residential);

  if (a.city) parts.push(a.city);
  else if (a.town) parts.push(a.town);
  else if (a.county) parts.push(a.county);

  return parts.join(', ') || data.display_name?.split(',').slice(0, 3).join(', ') || '';
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const k = cacheKey(lat, lng);
  const hit = cacheShort.get(k);
  if (hit) return hit;

  try {
    const res = await fetch(
      `/api/geocode/reverse?lat=${lat}&lon=${lng}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const addr = formatAddress(data);
    if (addr) cacheShort.set(k, addr);
    return addr || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return '';
  }
}

export async function reverseGeocodeFull(lat: number, lng: number): Promise<string> {
  const k = cacheKey(lat, lng);
  const hit = cacheFull.get(k);
  if (hit) return hit;

  try {
    const res = await fetch(
      `/api/geocode/reverse?lat=${lat}&lon=${lng}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const full = (data?.display_name || '').toString();
    if (full) cacheFull.set(k, full);
    return full || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return '';
  }
}

export async function batchReverseGeocode(
  coords: Array<{ lat: number; lng: number }>,
): Promise<void> {
  const unique = new Map<string, { lat: number; lng: number }>();
  for (const c of coords) {
    const k = cacheKey(c.lat, c.lng);
    if (!cacheShort.has(k) && !unique.has(k)) unique.set(k, c);
  }
  if (unique.size === 0) return;

  await Promise.allSettled(
    Array.from(unique.values()).map((c) => reverseGeocode(c.lat, c.lng)),
  );
}

export function getCachedAddress(lat: number, lng: number): string | undefined {
  return cacheShort.get(cacheKey(lat, lng));
}

export function getCachedAddressFull(lat: number, lng: number): string | undefined {
  return cacheFull.get(cacheKey(lat, lng));
}
