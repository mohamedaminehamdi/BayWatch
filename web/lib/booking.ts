// Booking v2 for in-process callers on the server (voice, and POST /api/reservations): bays(), quote(),
// reserve() and reserveFromWeb() on the server's engine. The logic and its checks are in booking-api.ts.
import 'server-only';
import { bookingApi } from './booking-api';
import { schedule } from './server';
import { listVehicles } from './vehicles';

const api = bookingApi(schedule, { list: listVehicles });

export const bays = api.bays;
export const quote = api.quote;
export const reserve = api.reserve;
export const reserveFromWeb = api.reserveFromWeb;
