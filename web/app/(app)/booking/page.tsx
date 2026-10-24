import type { Metadata } from 'next';
import { BookingView } from '@/components/booking/booking-view';

export const metadata: Metadata = { title: 'Your booking' };

export default function BookingPage() {
  return <BookingView />;
}
