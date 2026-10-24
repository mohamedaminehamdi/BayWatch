import type { Metadata } from 'next';
import { Welcome } from '@/components/vehicles/welcome';

export const metadata: Metadata = { title: 'Welcome' };

export default function Page() {
  return <Welcome />;
}
