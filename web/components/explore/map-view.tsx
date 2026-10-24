'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource } from 'maplibre-gl';
import { Zap } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import MapGL, { Layer, Marker, NavigationControl, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { Bay } from '@/lib/booking-types';
import type { Charger } from '@/lib/goingelectric';
import type { Point } from '@/lib/geo';

export type View = { center: Point; bounds: [number, number, number, number]; zoom: number };

const STATUS_WORD: Record<Bay['status'], string> = { free: 'free', reserved: 'reserved', occupied: 'occupied', offline: 'offline right now' };
const PIN_GAP_PX = 64; // the Baywatch bays stand a few metres apart, so their pins sit side by side at any zoom

const maxPower = (c: Charger) => Math.max(0, ...c.points.map((p) => p.power));

// MapLibre paints with plain colour strings, so read the theme tokens once and resolve them
// through a canvas pixel (this also turns oklch into rgb, which MapLibre can't parse)
function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const read = (token: string) => {
    if (!ctx) return '#000';
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css.getPropertyValue(token).trim() || '#000';
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  return {
    ink: read('--color-ink'),
    surface: read('--color-surface'),
    accent: read('--color-accent'),
    danger: read('--color-danger'),
    context: read('--color-context'),
    location: read('--color-location'),
  };
}

// Hundreds of public chargers are one clustered GeoJSON source drawn by the GPU; only the three Baywatch bays
// are DOM markers, big and violet. Colours are the theme tokens (ink for DC ≥ 50 kW, context grey for AC, danger for faults).
export default function MapView({
  chargers,
  realBays,
  center,
  mineId,
  selectedBayId,
  selectedId,
  me,
  onReady,
  onView,
  onSelectCharger,
  onSelectBay,
}: {
  chargers: Charger[];
  realBays: Bay[];
  center: Point;
  mineId: string | null;
  selectedBayId: string | null;
  selectedId: number | null;
  me: Point | null;
  onReady: (map: MapRef) => void;
  onView: (v: View) => void;
  onSelectCharger: (id: number) => void;
  onSelectBay: (id: string) => void;
}) {
  const ref = useRef<MapRef>(null);
  const [c] = useState(themeColors); // read once; this component only renders in the browser
  const data = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: chargers.map((c) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
        properties: { id: c.id, fast: maxPower(c) >= 50, fault: c.fault },
      })),
    }),
    [chargers],
  );

  function report() {
    const m = ref.current;
    if (!m) return;
    const b = m.getBounds();
    const c = m.getCenter();
    onView({ center: { lat: c.lat, lng: c.lng }, bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: m.getZoom() });
  }

  async function click(e: MapLayerMouseEvent) {
    const f = e.features?.[0];
    if (!f) return;
    if (f.properties?.cluster) {
      const source = ref.current?.getSource('chargers') as GeoJSONSource | undefined;
      const zoom = await source?.getClusterExpansionZoom(f.properties.cluster_id);
      if (f.geometry.type === 'Point') {
        const [lng, lat] = f.geometry.coordinates;
        ref.current?.easeTo({ center: [lng, lat], zoom: (zoom ?? 14) + 0.3, duration: 500 });
      }
    } else onSelectCharger(Number(f.properties?.id));
  }

  return (
    <MapGL
      ref={ref}
      initialViewState={{ longitude: center.lng, latitude: center.lat, zoom: 13.4 }}
      mapStyle="https://tiles.openfreemap.org/styles/positron"
      attributionControl={{
        compact: true,
        customAttribution: 'Charging data © <a href="https://www.goingelectric.de/stromtankstellen/" target="_blank" rel="noopener">GoingElectric.de</a>',
      }}
      interactiveLayerIds={['clusters', 'chargers']}
      onClick={click}
      onLoad={() => {
        if (ref.current) onReady(ref.current);
        report();
      }}
      onMoveEnd={report}
      cursor="auto"
      style={{ position: 'absolute', inset: 0 }}
    >
      <Source id="chargers" type="geojson" data={data} cluster clusterRadius={34} clusterMaxZoom={13}>
        <Layer
          id="clusters"
          type="circle"
          filter={['has', 'point_count']}
          paint={{
            'circle-color': c.ink,
            'circle-opacity': 0.92,
            'circle-radius': ['step', ['get', 'point_count'], 15, 10, 19, 50, 24],
            'circle-stroke-color': c.surface,
            'circle-stroke-width': 2.5,
          }}
        />
        <Layer
          id="cluster-count"
          type="symbol"
          filter={['has', 'point_count']}
          layout={{ 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true }}
          paint={{ 'text-color': c.surface }}
        />
        <Layer
          id="chargers"
          type="circle"
          filter={['!', ['has', 'point_count']]}
          paint={{
            'circle-color': c.surface,
            'circle-radius': ['case', ['==', ['get', 'id'], selectedId ?? -1], 10, 7],
            'circle-stroke-width': ['case', ['==', ['get', 'id'], selectedId ?? -1], 4, 3],
            'circle-stroke-color': ['case', ['get', 'fault'], c.danger, ['==', ['get', 'id'], selectedId ?? -1], c.accent, ['get', 'fast'], c.ink, c.context],
          }}
        />
      </Source>

      {me && (
        <Source id="me" type="geojson" data={{ type: 'Point', coordinates: [me.lng, me.lat] }}>
          <Layer id="me-halo" type="circle" paint={{ 'circle-radius': 16, 'circle-color': c.location, 'circle-opacity': 0.15 }} />
          <Layer id="me-dot" type="circle" paint={{ 'circle-radius': 7, 'circle-color': c.location, 'circle-stroke-color': c.surface, 'circle-stroke-width': 3 }} />
        </Source>
      )}

      {realBays.map((b, i) => {
        const offline = b.status === 'offline';
        const selected = b.id === selectedBayId;
        return (
          <Marker
            key={b.id}
            longitude={b.lng}
            latitude={b.lat}
            anchor="bottom"
            offset={[(i - (realBays.length - 1) / 2) * PIN_GAP_PX, 0]}
            onClick={(e) => (e.originalEvent.stopPropagation(), onSelectBay(b.id))}
          >
            <button
              type="button"
              aria-label={`${b.name}, ${b.guard === 'hardware' ? 'real barrier' : 'no hardware assigned yet'}, ${b.id === mineId ? 'booked by you' : STATUS_WORD[b.status]}`}
              aria-pressed={selected}
              className="group relative flex cursor-pointer flex-col items-center gap-1"
            >
              {b.led === 'green' && !offline && <span className="absolute top-1 size-12 animate-pulse-ring rounded-full bg-accent/40" />}
              <span
                className={`relative grid size-14 rotate-45 place-items-center rounded-full rounded-br-none shadow-[0_10px_24px_-6px_rgb(15_20_25/0.5)] transition-transform group-hover:scale-105 ${
                  offline ? 'bg-sunken ring-3 ring-faint' : 'bg-accent ring-3 ring-surface'
                } ${selected ? 'outline-3 outline-offset-2 outline-ink' : ''}`}
              >
                <Zap aria-hidden className={`size-6 -rotate-45 ${offline ? 'fill-faint text-faint' : 'fill-surface text-surface'}`} />
              </span>
              {!offline && <span aria-hidden className={`absolute -right-0.5 top-0 size-3.5 rounded-full ring-2 ring-surface ${b.led === 'green' ? 'bg-signal' : 'bg-danger'}`} />}
              <span aria-hidden className="rounded-full bg-ink px-2 py-0.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-on-brand">
                {b.name.replace(/^Baywatch /, '')}
              </span>
            </button>
          </Marker>
        );
      })}

      <NavigationControl position="bottom-right" showCompass={false} />
    </MapGL>
  );
}
