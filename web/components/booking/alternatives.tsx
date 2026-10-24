'use client';

import { Navigation } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/button';
import { Led } from '@/components/ui/led';
import type { Bay } from '@/lib/booking-types';
import { directionsUrl, distanceM, formatDistance, type Point } from '@/lib/geo';
import { formatEuro } from '@/lib/pricing';

// Free chargers to go to instead of an occupied bay: book one, or drive there
export function AlternativeList({ bays, from, onBook }: { bays: Bay[]; from?: Point | null; onBook: (bay: Bay) => void }) {
  if (!bays.length) return <p className="text-muted">No other free chargers nearby right now.</p>;
  return (
    <ul className="divide-y divide-line">
      {bays.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
          <Led led={b.led} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{b.name}</span>
            <span className="font-mono text-[0.8125rem] text-muted">
              {b.powerKw} kW · from {formatEuro(b.priceFromCents)}
              {from && ` · ${formatDistance(distanceM(from, b))}`}
            </span>
          </span>
          <Button size="sm" onClick={() => onBook(b)} aria-label={`Book ${b.name} now`}>
            Book now
          </Button>
          <a href={directionsUrl(b)} target="_blank" rel="noopener" className={buttonClass('secondary', 'sm')} aria-label={`Navigate by car to ${b.name}`}>
            <Navigation aria-hidden className="size-4" /> Go
          </a>
        </li>
      ))}
    </ul>
  );
}
