import { baywatchBays } from '@/lib/bays';
import { distanceM } from '@/lib/geo';
import { chargersNear } from '@/lib/goingelectric';
import { DotMap, type Dot } from './dot-map';

const RADIUS_KM = 2;
const UNITS_PER_M = 180 / (RADIUS_KM * 1000); // the 2 km ring has radius 180 in the 400×400 map

// Real GoingElectric chargers around the Baywatch bays. Renders nothing without data (no key, or GE down).
export async function NearbyChargers() {
  const bays = baywatchBays();
  const bay = bays[0];
  if (!bay) return null;
  const found = await chargersNear(bay.lat, bay.lng, RADIUS_KM);
  if (!found?.length) return null;
  const locks = bays.filter((b) => b.guard === 'hardware').length;

  const cos = Math.cos((bay.lat * Math.PI) / 180);
  const dots: Dot[] = found
    .map((c) => ({
      id: c.id,
      name: c.name,
      x: 200 + (c.lng - bay.lng) * 111_320 * cos * UNITS_PER_M,
      y: 200 - (c.lat - bay.lat) * 110_574 * UNITS_PER_M,
      powerKw: Math.max(0, ...c.points.map((p) => p.power)),
      distance: distanceM(bay, c),
    }))
    // drop the bays themselves if GoingElectric lists them, and anything outside the outer ring
    .filter((d) => d.distance > 15 && d.distance <= RADIUS_KM * 1000)
    .sort((a, b) => b.distance - a.distance);
  const nearest = dots.at(-1);

  return (
    <section className="mx-auto grid max-w-7xl items-center gap-12 px-[clamp(1.25rem,5vw,5rem)] py-20 lg:grid-cols-[1fr_1.1fr] lg:gap-20 lg:py-28">
      <div>
        <h2 className="font-display text-[clamp(2.5rem,5vw,4.5rem)] leading-[0.9] tracking-[0.012em]">
          {dots.length} public chargers within {RADIUS_KM} km. <span className="text-accent">Now each one can wait for you.</span>
        </h2>
        <p className="mt-6 max-w-[46ch] text-lg text-muted">
          Without a booking, any of these can be taken or blocked by the time you arrive, and you only find out when you
          get there. Book one through Baywatch and it’s held for your slot. The violet dot marks the {bays.length} Baywatch
          bays at the venue{locks ? `, ${locks} of them behind a real lock` : ''}.
        </p>
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.08em] text-muted">
          Live data from{' '}
          <a href="https://www.goingelectric.de/stromtankstellen/" className="underline underline-offset-2 hover:text-ink">
            GoingElectric.de
          </a>
          , around the Baywatch bays.
        </p>
      </div>
      <figure className="rounded-3xl bg-surface p-5 ring-1 ring-line sm:p-8">
        <DotMap dots={dots} />
        <figcaption className="sr-only">
          Map of {dots.length} public chargers within {RADIUS_KM} km of the Baywatch bays
          {nearest ? `; the nearest is ${nearest.name}, ${Math.round(nearest.distance)} metres away` : ''}. Every one can be booked through Baywatch.
        </figcaption>
      </figure>
    </section>
  );
}
