import type { Metadata } from 'next';
import { BookingScreen } from '@/components/booking/booking-view';

export const metadata: Metadata = { title: 'Your booking' };

export default async function Page({ params }: PageProps<'/booking/[id]'>) {
  const { id } = await params;
  // keyed: "Book now" on an alternative lands on another booking, which starts from a clean screen
  return <BookingScreen key={id} id={id} />;
}
