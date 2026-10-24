// The bays drivers can book: the three Baywatch bays, each behind a real Ecurious lock or none yet, and every
// GoingElectric charger, whose guard is simulated. What changes minute to minute (status, LED, the next booking,
// the price) comes from the schedule (schedule.ts).

import { classOf } from './booking-rules.ts';
import type { Bay } from './booking-types.ts';
import type { Charger } from './goingelectric.ts';

export type BayInfo = Pick<Bay, 'id' | 'name' | 'lat' | 'lng' | 'address' | 'network' | 'url' | 'points' | 'powerKw' | 'class' | 'real' | 'guard'> & {
  lockId?: string; // the Ecurious lock behind a Baywatch bay; never sent to browsers
  fault?: boolean; // GoingElectric reports the charger out of order
};

export const DEFAULT_BAYS = 'bw-1:lock-0002,bw-2:lock-0003,bw-3:';
const SPACING_M = 6; // until the venue's real coordinates are known

// ECURIOUS_BAYS="bw-1:lock-0002,bw-2:lock-0003,bw-3:" (an empty lock = no hardware yet). One position for all
// from BAY_LAT/BAY_LNG, a bay every 6 m eastwards; the power from BAY_POWER_KW.
export function baywatchBays(env: Record<string, string | undefined> = process.env): BayInfo[] {
  const lat = Number(env.BAY_LAT ?? 52.52);
  const lng = Number(env.BAY_LNG ?? 13.405);
  const powerKw = Number(env.BAY_POWER_KW ?? 200);
  const lngPerBay = SPACING_M / (111_320 * Math.cos((lat * Math.PI) / 180));
  const entries = (env.ECURIOUS_BAYS ?? DEFAULT_BAYS).split(',').map((e) => e.trim()).filter(Boolean);
  return entries.flatMap((entry, i) => {
    const [id, lock = ''] = entry.split(':').map((s) => s.trim());
    if (!/^bw-\d{1,3}$/.test(id) || (lock && !/^lock-\d{4}$/.test(lock))) {
      console.warn(`ECURIOUS_BAYS: skipped "${entry}". Use bw-N:lock-NNNN, or bw-N: for a bay without hardware.`);
      return [];
    }
    const bay: BayInfo = {
      id,
      name: `Baywatch Bay ${id.slice(3)}`,
      lat,
      lng: lng + i * lngPerBay,
      address: env.BAY_ADDRESS ?? 'Hackathon venue',
      points: [{ type: 'CCS', power: powerKw, count: 1 }],
      powerKw,
      class: classOf(powerKw),
      real: true,
      guard: lock ? 'hardware' : 'simulated',
    };
    return [lock ? { ...bay, lockId: lock } : bay];
  });
}

export const geBayId = (geId: number) => `ge-${geId}`;
export const geIdOf = (bayId: string) => (/^ge-(\d{1,10})$/.exec(bayId) ? Number(bayId.slice(3)) : null);

export function geBay(c: Charger): BayInfo {
  const powerKw = Math.max(0, ...c.points.map((p) => p.power));
  return {
    id: geBayId(c.id),
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    address: c.address,
    network: c.network,
    url: c.url,
    points: c.points,
    powerKw,
    class: classOf(powerKw),
    real: false,
    guard: 'simulated',
    fault: c.fault,
  };
}
