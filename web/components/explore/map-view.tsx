'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource } from 'maplibre-gl';
import { Zap } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import MapGL, { Layer, Marker, NavigationControl, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { Charger } from '@/lib/goingelectric';
import type { Point } from '@/lib/geo';

export type View = { center: Point; bounds: [number, number, number, number]; zoom: number };
export type BayLook = 'free' | 'mine' | 'busy' | 'offline';

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

// Hundreds of public chargers are one clustered GeoJSON source drawn by the GPU; only the Ecurious bay
// is a DOM marker. Colours are the theme tokens (ink for DC ≥ 50 kW, context grey for AC, danger for faults).
export default function MapView({
  chargers,
  bay,
  bayLook,
  selectedId,
  me,
  onReady,
  onView,
  onSelectCharger,
  onSelectBay,
}: {
  chargers: Charger[];
  bay: Point;
  bayLook: BayLook;
  selectedId: number | null;
  me: Point | null;
  onReady: (map: MapRef) => void;
  onView: (v: View) => void;
  onSelectCharger: (id: number) => void;
  onSelectBay: () => void;
}) {
  const ref = useRef<MapRef>(null);
  const muted = bayLook === 'busy' || bayLook === 'offline'; // greyed pin; the label says which
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
      initialViewState={{ longitude: bay.lng, latitude: bay.lat, zoom: 13.4 }}
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

      <Marker longitude={bay.lng} latitude={bay.lat} anchor="bottom" onClick={(e) => (e.originalEvent.stopPropagation(), onSelectBay())}>
        <button
          type="button"
          aria-label={
            { free: 'Baywatch bay, free to book', mine: 'Baywatch bay, booked by you', busy: 'Baywatch bay, taken right now', offline: 'Baywatch bay, offline right now' }[bayLook]
          }
          className="group relative grid cursor-pointer place-items-center"
        >
          {bayLook === 'free' && <span className="absolute top-1 size-10 animate-pulse-ring rounded-full bg-signal/70" />}
          <span
            className={`relative grid size-11 place-items-center rounded-full rounded-br-none rotate-45 shadow-[0_8px_20px_-6px_rgb(15_20_25/0.45)] ring-3 transition-transform group-hover:scale-105 ${
              muted ? 'bg-sunken ring-faint' : 'bg-signal ring-ink'
            }`}
          >
            <Zap className={`size-5 -rotate-45 ${muted ? 'fill-faint text-faint' : 'fill-ink text-ink'}`} />
          </span>
        </button>
      </Marker>

      <NavigationControl position="bottom-right" showCompass={false} />
    </MapGL>
  );
}
