import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { SmoothScroll } from '@/components/smooth-scroll';

// Fraunces carries the argument: an editorial, high-contrast serif that holds up
// at display size and reads well small. Plex Sans is the interface. Plex Mono is
// evidence: anything set in mono on this site is literal captured text.
const display = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const SITE = 'https://silentgreen.dev';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: 'silentgreen — verification for AI work',
    template: '%s — silentgreen',
  },
  description:
    'silentgreen reads what an agent, a RAG pipeline or an automation produced and tells you what it can prove, what it can disprove, and what cannot be settled either way. It never asks a model to grade a model.',
  keywords: [
    'AI verification',
    'hallucination detection',
    'groundedness',
    'RAG evaluation',
    'LLM evaluation',
    'AI evidence',
    'EU AI Act',
    'agent monitoring',
  ],
  authors: [{ name: 'silentgreen' }],
  openGraph: {
    type: 'website',
    url: SITE,
    siteName: 'silentgreen',
    title: 'silentgreen — verification for AI work',
    description:
      'What it can prove, what it can disprove, and what cannot be settled either way. It never asks a model to grade a model.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'silentgreen — verification for AI work',
    description:
      'What it can prove, what it can disprove, and what cannot be settled either way. No model grades a model.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0b0d' },
    { media: '(prefers-color-scheme: light)', color: '#f6f5f1' },
  ],
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
