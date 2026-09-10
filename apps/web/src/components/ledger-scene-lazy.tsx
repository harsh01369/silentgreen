'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const LedgerScene = dynamic(() => import('./ledger-scene').then((m) => m.LedgerScene), {
  ssr: false,
  loading: () => null,
});

/**
 * Mounts the 3D scene only on capable clients and only after first paint, so it
 * never blocks the hero text or the largest-contentful-paint. Under
 * prefers-reduced-motion it stays a still gradient.
 */
export function LedgerSceneLazy() {
  const [show, setShow] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Phones and small tablets keep the still gradient: bloom is expensive on
    // mobile GPUs and the hero must stay smooth.
    const small = window.matchMedia('(max-width: 820px)').matches;
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
    if (reduce || small || weak) return;
    const id = window.requestIdleCallback
      ? window.requestIdleCallback(() => setShow(true), { timeout: 1200 })
      : window.setTimeout(() => setShow(true), 400);
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(id as number);
      else clearTimeout(id as number);
    };
  }, []);

  // Stop the render loop once the hero has scrolled away. Otherwise the scene
  // keeps running four full-screen post passes behind the paper sections and
  // makes the whole page feel heavy.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => setOnScreen(entries[0]?.isIntersecting ?? true),
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="absolute inset-0">
      {/* the still fallback, always painted; the canvas fades in over it */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 30% 40%, rgba(67,185,130,0.10), transparent 70%), radial-gradient(50% 45% at 78% 62%, rgba(224,122,76,0.08), transparent 70%), #0a0b0d',
        }}
      />
      <div
        className="absolute inset-0 transition-opacity duration-[1200ms]"
        style={{ opacity: show ? 1 : 0 }}
      >
        {show && <LedgerScene active={onScreen} />}
      </div>
    </div>
  );
}
