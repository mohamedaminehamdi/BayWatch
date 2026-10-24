'use client';

import { ChevronUp, LocateFixed, Search } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { distanceM, type Point } from '@/lib/geo';
import type { Charger } from '@/lib/goingelectric';
import type { View } from './map-view';
import { ChargerDetail, ChargerList, RealBayDetail, type Row } from './panels';
import { ReserveDialog } from './reserve-dialog';

const MapView = dynamic(() => import('./map-view'), { ssr: false, loading: () => <div className="absolute inset-0 animate-pulse bg-sunken" /> });

type Found = { chargers: Charger[]; warning?: string; more?: boolean };
type Selection = { kind: 'bay'; id: string } | { kind: 'charger'; id: number } | null;

const MIN_ZOOM = 10.5; // wider than this, GoingElectric would return a whole region
const LIST_CAP = 50;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Explore() {
  const { state } = useAppState();
  const params = useSearchParams();
  const map = useRef<MapRef | null>(null);
  const cache = useRef(new Map<string, Found>());

  const [view, setView] = useState<View | null>(null);
  const [found, setFound] = useState<Found>({ chargers: [] });
  const [loadError, setLoadError] = useState('');
  const [fast, setFast] = useState(false);
  const [reservableOnly, setReservableOnly] = useState(false);
  const [me, setMe] = useState<Point | null>(null);
  const [selected, setSelected] = useState<Selection>(params.has('bay') ? { kind: 'bay', id: params.get('bay') ?? '' } : null);
  const [sheetOpen, setSheetOpen] = useState(params.has('bay'));
  // the Baywatch bay being booked; partner deep links: /explore?bay=…&reserve=1
  const [reserveFor, setReserveFor] = useState<string | null>(params.get('reserve') === '1' ? (params.get('bay') ?? '') : null);
  const [query, setQuery] = useState('');
  const [searchNote, setSearchNote] = useState('');

  // Load public chargers for the visible area: after the map settles, once per area (cached), never while zoomed far out
  useEffect(() => {
    if (!view || view.zoom < MIN_ZOOM) return;
    const [w, s, e, n] = view.bounds.map((v) => v.toFixed(3));
    const key = `${w},${s},${e},${n},${fast}`;
    const t = setTimeout(async () => {
      try {
        const hit =
          cache.current.get(key) ??
          (await api<Found>('GET', `/api/chargers?sw_lat=${s}&sw_lng=${w}&ne_lat=${n}&ne_lng=${e}${fast ? '&min_power=50' : ''}`));
        cache.current.set(key, hit);
        setFound(hit);
        setLoadError('');
      } catch (err) {
        setLoadError(`Couldn’t load public chargers: ${(err as Error).message}`);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [view, fast]);

  const from = me ?? view?.center ?? null; // distances are from you, or from the map centre
  const visible = useMemo(() => (reservableOnly ? [] : found.chargers), [found, reservableOnly]);
  const rows: Row[] = useMemo(
    () =>
      visible
        .map((charger) => ({ charger, distance: from ? distanceM(from, charger) : null }))
        .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
        .slice(0, LIST_CAP),
    [visible, from],
  );

  if (!state) return <div className="absolute inset-0 animate-pulse bg-sunken" />;

  // the three Baywatch bays, live with every /api/state poll; an unknown id (an old link) means the first one
  const realBays = state.realBays ?? [];
  const bayById = (id: string | null) => (id === null ? undefined : (realBays.find((b) => b.id === id) ?? realBays[0]));
  const selectedBay = selected?.kind === 'bay' ? bayById(selected.id) : undefined;
  const reserveBay = bayById(reserveFor) ?? null;
  const mineId = state.viewer?.active?.bayId ?? state.viewer?.next?.bayId ?? null;
  const center = realBays[0] ?? state.bay;
  const charger = selected?.kind === 'charger' ? visible.find((c) => c.id === selected.id) : undefined;

  const zoomNote = view && view.zoom < MIN_ZOOM ? 'Zoom in to see public chargers.' : '';
  const note = loadError || found.warning || zoomNote || (!reservableOnly && view && !visible.length ? 'No public chargers in this area.' : '');

  function fly(p: Point, zoom = 14.5) {
    map.current?.flyTo({ center: [p.lng, p.lat], zoom, duration: reducedMotion() ? 0 : 900 });
  }

  function select(next: Selection) {
    setSelected(next);
    setSheetOpen(true);
    const target = next?.kind === 'bay' ? bayById(next.id) : next?.kind === 'charger' ? visible.find((c) => c.id === next.id) : null;
    if (target) fly(target, Math.max(view?.zoom ?? 14.5, 14.5));
  }

  function locate() {
    if (!navigator.geolocation) return setSearchNote('Your browser can’t share its location.');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const here = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMe(here);
        setSearchNote('');
        fly(here, 14);
      },
      () => setSearchNote('Location is off. Allow it in your browser to sort chargers by distance from you.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  // Nominatim on submit only: its usage policy doesn't allow search-as-you-type
  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchNote('Searching…');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`);
      const [place] = (await res.json()) as { lat: string; lon: string }[];
      if (!place) return setSearchNote(`No place found for “${query}”.`);
      setSearchNote('');
      setSelected(null);
      fly({ lat: Number(place.lat), lng: Number(place.lon) }, 14);
    } catch {
      setSearchNote('Search isn’t available right now.');
    }
  }

  const chip = (on: boolean, label: string, toggle: () => void) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={toggle}
      className="min-h-11 shrink-0 rounded-full bg-surface px-4 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ink shadow-[0_2px_8px_-2px_rgb(15_20_25/0.18)] ring-1 ring-line-strong transition-colors aria-pressed:bg-ink aria-pressed:text-on-brand aria-pressed:ring-ink"
    >
      {label}
    </button>
  );

  const controls = (
    <div className="grid gap-2.5">
      <form onSubmit={search} role="search" className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search a place</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a city or address"
            enterKeyHint="search"
            className="min-h-12 w-full rounded-full bg-surface pl-11 pr-4 text-base shadow-[0_2px_10px_-2px_rgb(15_20_25/0.2)] ring-1 ring-line-strong placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <button
          type="button"
          onClick={locate}
          aria-label="Locate me"
          className="grid size-12 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-[0_2px_10px_-2px_rgb(15_20_25/0.2)] ring-1 ring-line-strong hover:bg-sunken"
        >
          <LocateFixed className="size-5" />
        </button>
      </form>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {chip(fast, 'Fast ≥ 50 kW', () => setFast((v) => !v))}
        {chip(reservableOnly, 'Reservable only', () => setReservableOnly((v) => !v))}
      </div>
      {searchNote && (
        <p role="status" className="rounded-2xl bg-surface px-4 py-2 text-sm text-muted shadow-sm ring-1 ring-line">
          {searchNote}
        </p>
      )}
    </div>
  );

  const panel =
    selectedBay ? (
      // details only show distance from you: the map re-centres on what you picked, so a centre distance means nothing
      <RealBayDetail
        bay={selectedBay}
        mine={selectedBay.id === mineId}
        distance={me ? distanceM(me, selectedBay) : null}
        onBack={() => setSelected(null)}
        onBook={() => setReserveFor(selectedBay.id)}
      />
    ) : charger ? (
      <ChargerDetail
        charger={charger}
        distance={me ? distanceM(me, charger) : null}
        onBack={() => setSelected(null)}
        onBook={() => {
          if (!realBays[0]) return;
          setSelected({ kind: 'bay', id: realBays[0].id });
          setSheetOpen(true);
          fly(realBays[0], 15);
          setReserveFor(realBays[0].id);
        }}
      />
    ) : (
      <ChargerList
        realBays={realBays}
        mineId={mineId}
        fromYou={!!me}
        rows={rows}
        more={visible.length > LIST_CAP}
        note={note}
        onSelectBay={(id) => select({ kind: 'bay', id })}
        onBook={setReserveFor}
        onSelect={(id) => select({ kind: 'charger', id })}
      />
    );

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.75rem+1px+env(safe-area-inset-bottom))] top-14 lg:bottom-0 lg:top-16 lg:flex">
      <aside aria-label="Chargers" className="hidden w-[25rem] shrink-0 flex-col border-r border-line bg-page lg:flex">
        <div className="border-b border-line p-5">{controls}</div>
        <div className="flex-1 overflow-y-auto p-5">{panel}</div>
      </aside>

      <div className="relative h-full flex-1 max-lg:[&_.maplibregl-ctrl-group]:hidden">
        <MapView
          chargers={visible}
          realBays={realBays}
          center={center}
          mineId={mineId}
          selectedBayId={selectedBay?.id ?? null}
          selectedId={charger?.id ?? null}
          me={me}
          onReady={(m) => {
            map.current = m;
            if (selectedBay) fly(selectedBay, 15);
          }}
          onView={setView}
          onSelectCharger={(id) => select({ kind: 'charger', id })}
          onSelectBay={(id) => select({ kind: 'bay', id })}
        />
        <div className="absolute inset-x-3 top-3 z-(--z-map-ui) lg:hidden">{controls}</div>

        {/* phones: the list and details live in a sheet over the map */}
        <section
          aria-label="Chargers"
          data-open={sheetOpen}
          className="absolute inset-x-0 bottom-0 z-(--z-sheet) flex h-[78%] translate-y-[calc(100%-11.5rem)] flex-col rounded-t-3xl bg-page shadow-[0_-12px_40px_-12px_rgb(15_20_25/0.3)] transition-transform duration-300 ease-out data-[open=true]:translate-y-0 lg:hidden"
        >
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            aria-expanded={sheetOpen}
            className="flex w-full flex-col items-center gap-1.5 pb-2 pt-2.5"
          >
            <span className="h-1.5 w-10 rounded-full bg-line-strong/60" />
            <span className="flex items-center gap-1 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-muted">
              {sheetOpen ? 'Show map' : `${rows.length ? `${rows.length}${visible.length > LIST_CAP ? '+' : ''} chargers nearby` : 'Chargers'}`}
              <ChevronUp className={`size-4 transition-transform ${sheetOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>
          <div className="flex-1 overflow-y-auto px-4 pb-6">{panel}</div>
        </section>
      </div>

      <ReserveDialog bay={reserveBay} open={!!reserveBay} onClose={() => setReserveFor(null)} />
    </div>
  );
}

