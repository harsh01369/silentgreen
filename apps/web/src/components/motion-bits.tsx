'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

let registered = false;
function ensure() {
  if (!registered && typeof window !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
}
const reduce = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A section that rises and settles as it enters the viewport. It renders fully
 * visible; the effect hides it and animates it in only when GSAP is available,
 * so a failed script or a bot never leaves content stuck at opacity 0.
 */
export function Reveal({
  children,
  className = '',
  y = 26,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ensure();
    const el = ref.current;
    if (!el || reduce()) return;
    const ctx = gsap.context(() => {
      gsap.set(el, { opacity: 0, y });
      gsap.to(el, {
        opacity: 1,
        y: 0,
        duration: 0.9,
        delay,
        ease: 'expo.out',
        scrollTrigger: { trigger: el, start: 'top 86%', once: true },
      });
    });
    return () => ctx.revert();
  }, [y, delay]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Stagger each direct child of the container in as the container enters. */
export function RevealStagger({ children, className = '', gap = 0.08 }: { children: ReactNode; className?: string; gap?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ensure();
    const el = ref.current;
    if (!el || reduce()) return;
    const items = Array.from(el.children) as HTMLElement[];
    const ctx = gsap.context(() => {
      gsap.set(items, { opacity: 0, y: 20 });
      gsap.to(items, {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: 'expo.out',
        stagger: gap,
        scrollTrigger: { trigger: el, start: 'top 84%', once: true },
      });
    });
    return () => ctx.revert();
  }, [gap]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Count a number up when it scrolls into view. */
export function CountUp({ to, className = '', suffix = '' }: { to: number; className?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ensure();
    const el = ref.current;
    if (!el) return;
    if (reduce()) {
      el.textContent = `${to}${suffix}`;
      return;
    }
    const obj = { v: 0 };
    const ctx = gsap.context(() => {
      gsap.to(obj, {
        v: to,
        duration: 1.4,
        ease: 'expo.out',
        scrollTrigger: { trigger: el, start: 'top 90%', once: true },
        onUpdate: () => {
          el.textContent = `${Math.round(obj.v)}${suffix}`;
        },
      });
    });
    return () => ctx.revert();
  }, [to, suffix]);
  return (
    <span ref={ref} className={className}>
      {to}
      {suffix}
    </span>
  );
}

/** The hero: parallax the canvas out and fade the copy as the page leaves. */
export function HeroParallax({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ensure();
    const el = ref.current;
    if (!el || reduce()) return;
    const scene = el.querySelector<HTMLElement>('[data-hero-scene]');
    const copy = el.querySelector<HTMLElement>('[data-hero-copy]');
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: 0.6 },
      });
      if (scene) tl.to(scene, { yPercent: 12, scale: 1.06, opacity: 0.3, ease: 'none' }, 0);
      if (copy) tl.to(copy, { yPercent: -16, opacity: 0, ease: 'none' }, 0);
    });
    return () => ctx.revert();
  }, []);
  return <div ref={ref}>{children}</div>;
}
