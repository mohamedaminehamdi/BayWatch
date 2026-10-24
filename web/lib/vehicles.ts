import { clerkClient } from '@clerk/nextjs/server';
import { normalizePlate } from './plates';
import { fail } from './reservation';

// A driver's cars live in their Clerk account (privateMetadata: server-only, never sent to the browser by Clerk).
// `plate` is normalized for matching camera reads; `display` keeps the driver's spacing ("M AB 1234").
export type Vehicle = { id: string; plate: string; display: string; label: string; consentAt: number };

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
  if (vehicles.length >= MAX) fail(409, `You can add up to ${MAX} cars`);
  if (vehicles.some((v) => v.plate === plate)) fail(409, 'This car is already in your account');
  const display = String(input.plate).toUpperCase().replace(/[^A-Z0-9ÄÖÜ -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  const v: Vehicle = { id: crypto.randomUUID(), plate, display, label: label || 'My car', consentAt: Date.now() };
  await save(userId, [...vehicles, v]);
  return v;
}

export async function removeVehicle(userId: string, id: string) {
  const vehicles = await listVehicles(userId);
  if (!vehicles.some((v) => v.id === id)) fail(404, 'Car not found');
  await save(userId, vehicles.filter((v) => v.id !== id));
  return { ok: true };
}
