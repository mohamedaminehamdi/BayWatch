import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Explore } from '@/components/explore/explore';

export const metadata: Metadata = { title: 'Explore' };

export default function ExplorePage() {
  return (
    <Suspense>
      <Explore />
    </Suspense>
  );
}
