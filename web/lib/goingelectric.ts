import { fail } from './errors';

export type Charger = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  address: string;
  network?: string;
  points: { count: number; power: number; type: string }[];
  fault: boolean;
  url?: string;
};

type GeLocation = {
  ge_id: number;
  name: string;
  coordinates: { lat: number; lng: number };
  address?: { street?: string; postcode?: string; city?: string };
  network?: string;
  chargepoints?: Charger['points'];
  fault_report?: unknown;
  url?: string;
};

const toCharger = (c: GeLocation): Charger => ({
  id: c.ge_id,
  name: c.name,
  lat: c.coordinates.lat,
  lng: c.coordinates.lng,
  address: [c.address?.street, c.address?.postcode, c.address?.city].filter(Boolean).join(', '),
  network: c.network,
  points: c.chargepoints ?? [],
  fault: Boolean(c.fault_report),
  url: c.url && new URL(c.url, 'https://www.goingelectric.de').href,
});

// One GoingElectric chargepoints request. The key stays on the server.
async function query(params: Record<string, string>, init: RequestInit) {
  const url = new URL('https://api.goingelectric.de/chargepoints/');
  url.searchParams.set('key', process.env.GE_API_KEY ?? '');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const data = await (await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) })).json();
  if (data.status !== 'ok') fail(502, `GoingElectric answered with status "${data.status}"`);
  return data as { chargelocations: GeLocation[]; startkey?: number };
}

// Map-section search for the explore map, trimmed to what the map needs
export async function chargers(q: URLSearchParams): Promise<{ chargers: Charger[]; warning?: string; more?: boolean }> {
  if (!process.env.GE_API_KEY) return { chargers: [], warning: 'GE_API_KEY is not set, so no GoingElectric charge points are shown' };
  const params: Record<string, string> = {};
  for (const k of ['sw_lat', 'sw_lng', 'ne_lat', 'ne_lng']) {
    const v = Number(q.get(k));
    if (!q.get(k) || !Number.isFinite(v)) fail(400, `Missing or invalid ${k}`);
    params[k] = String(v);
  }
  const minPower = q.get('min_power');
  if (minPower) {
    const n = Number(minPower);
    if (!Number.isInteger(n) || n < 0 || n > 1000) fail(400, 'Invalid min_power');
    params.min_power = String(n);
  }
  const data = await query(params, { cache: 'no-store' });
  return { chargers: data.chargelocations.map(toCharger), more: Boolean(data.startkey) };
}

// Chargers around a point, for the landing page. Cached for 6 hours so visitors don't each cost a
// GoingElectric request. Returns null without a key or when GoingElectric can't be reached.
export async function chargersNear(lat: number, lng: number, radiusKm: number): Promise<Charger[] | null> {
  if (!process.env.GE_API_KEY) return null;
  try {
    const data = await query({ lat: String(lat), lng: String(lng), radius: String(radiusKm) }, { next: { revalidate: 6 * 3600 } });
    return data.chargelocations.map(toCharger);
  } catch (e) {
    console.error('GoingElectric nearby search failed:', e);
    return null;
  }
}

// One charger by its GoingElectric id, to book a bay found on the map (ge-<id>). Cached for 6 hours; null when
// GoingElectric doesn't know it or can't be reached.
export async function chargerById(id: number): Promise<Charger | null> {
  if (!process.env.GE_API_KEY || !Number.isInteger(id) || id <= 0) return null;
  try {
    const data = await query({ ge_id: String(id) }, { next: { revalidate: 6 * 3600 } });
    const c = data.chargelocations.find((l) => l.ge_id === id);
    return c ? toCharger(c) : null;
  } catch (e) {
    console.error('GoingElectric lookup failed:', e);
    return null;
  }
}
