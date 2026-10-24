import { earliestStart, CLASSES } from '@/lib/booking-rules';
import { reserveFromWeb } from '@/lib/booking';
import { v1View, LEGACY_BAY } from '@/lib/legacy';
import { body, handle, requireUser, resolveBay } from '@/lib/server';

// Book a slot: { bayId, start, blocks, vehicleId, priceCents, acceptFees: true } → the booking. The plate comes
// from the driver's own car. `priceCents` is the fee the driver saw: a different one now is a 409, as are a taken
// slot and the 3-booking limit; a slot off the grid or too long is a 400. Payment is decided on the server
// (booking-api.ts): a `payment` field from the browser is ignored; with Stripe keys a card hold is required.
// The old reserve dialog's { vehicleId, minutes, … } (no bayId) still books Baywatch Bay 1 from the next block.
export const POST = (req: Request) =>
  handle(async () => {
    const userId = await requireUser();
    const input = await body(req);
    if (typeof input.bayId === 'string') {
      await resolveBay(input.bayId); // GoingElectric bays are looked up once
      return reserveFromWeb(userId, input);
    }
    const bay = await resolveBay(LEGACY_BAY);
    const blocks = Math.min(CLASSES[bay.class].maxBlocks, Math.max(1, Math.ceil(Number(input.minutes) / 15) || 4));
    return v1View(await reserveFromWeb(userId, { ...input, bayId: bay.id, start: earliestStart(Date.now()), blocks }));
  });
