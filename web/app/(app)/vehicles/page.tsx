import type { Metadata } from 'next';
import { Vehicles } from '@/components/vehicles/vehicles';

export const metadata: Metadata = { title: 'Your cars' };

export default function Page() {
  return <Vehicles />;
}
