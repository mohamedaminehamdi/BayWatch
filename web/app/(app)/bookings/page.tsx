import type { Metadata } from 'next';
import { Bookings } from '@/components/bookings/bookings';

export const metadata: Metadata = { title: 'Bookings' };

export default function Page() {
  return <Bookings />;
}
