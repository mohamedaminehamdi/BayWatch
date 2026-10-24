import type { Metadata } from 'next';
import { ActiveBookingRedirect } from '@/components/booking/booking-view';

export const metadata: Metadata = { title: 'Your booking' };

// /booking goes to the booking that matters now: the active one, else the next
export default function BookingPage() {
  return <ActiveBookingRedirect />;
}
