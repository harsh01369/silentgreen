'use client';

import dynamic from 'next/dynamic';

/**
 * The 3D field is heavy and purely decorative, so it loads after the page is
 * interactive and never blocks first paint. The gradient background stands in
 * until it arrives, and for anyone with reduced motion it is all they get.
 */
export const HeroScene = dynamic(() => import('./hero-scene').then((m) => m.HeroScene), {
  ssr: false,
  loading: () => null,
});
