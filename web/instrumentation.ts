// Next's startup hook, once per server process: in live hardware mode (ECURIOUS_LIVE=1) it connects the
// Ecurious camera and car-sensor events to the reservation engine. See lib/ecurious-bridge.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') (await import('./lib/ecurious-bridge')).startBridge();
}
