import { clerkClient } from '@clerk/nextjs/server';
import { cameraPlate, normalizePlate } from './plates';
import { fail } from './reservation';

// A driver's cars live in their Clerk account (privateMetadata: server-only, never sent to the browser by Clerk).
// `plate` is normalized for matching camera reads; `display` keeps the driver's spacing ("M AB 1234"); `cameraPlate`
// is what the bay camera's own allow-list gets, Han characters and all ("湘A613EN"). Cars added before it existed
// have none: their plate stands in.
export type Vehicle = { id: string; plate: string; display: string; label: string; consentAt: number; cameraPlate?: string };

const MAX = 5;

async function load(userId: string) {
  const client = await clerkClient();
  const { privateMetadata } = await client.users.getUser(userId);
  return { client, meta: privateMetadata, vehicles: (privateMetadata.vehicles as Vehicle[] | undefined) ?? [] };
}

// ponytail: read-modify-write without a lock; two adds in the same instant can lose one. Fine for one driver's own cars.
async function save(userId: string, vehicles: Vehicle[]) {
  const { client, meta } = await load(userId);
  await client.users.replaceUserMetadata(userId, { privateMetadata: { ...meta, vehicles } });
}

export const listVehicles = async (userId: string) => (await load(userId)).vehicles;

export async function getVehicle(userId: string, id: unknown) {
  const v = (await listVehicles(userId)).find((v) => v.id === id);
  return v ?? fail(404, 'Car not found');
}

export async function addVehicle(userId: string, input: Record<string, unknown>) {
  const plate = normalizePlate(input.plate);
  const label = String(input.label ?? '').trim();
  if (plate.length < 2 || plate.length > 10) fail(400, 'Enter a valid license plate');
  if (label.length > 30) fail(400, 'Keep the nickname under 30 characters');
  if (input.consent !== true) fail(400, 'Agree to plate recognition to add this car');
  const vehicles = await listVehicles(userId);
  const display = String(input.plate).toUpperCase().replace(/[^\p{Script=Han}A-Z0-9ÄÖÜ -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  const camera = cameraPlate(input.plate);
  const same = vehicles.find((v) => v.plate === plate);
  if (same) {
    if ((same.cameraPlate ?? same.plate) === camera) fail(409, 'This car is already in your account');
    // the same car, added before its Han characters were kept ("A613EN" for 湘A613EN): they're added now
    Object.assign(same, { display, cameraPlate: camera });
    await save(userId, vehicles);
    return same;
  }
  if (vehicles.length >= MAX) fail(409, `You can add up to ${MAX} cars`);
  const v: Vehicle = { id: crypto.randomUUID(), plate, display, label: label || 'My car', consentAt: Date.now(), cameraPlate: camera };
  await save(userId, [...vehicles, v]);
  return v;
}

export async function removeVehicle(userId: string, id: string) {
  const vehicles = await listVehicles(userId);
  if (!vehicles.some((v) => v.id === id)) fail(404, 'Car not found');
  await save(userId, vehicles.filter((v) => v.id !== id));
  return { ok: true };
}
