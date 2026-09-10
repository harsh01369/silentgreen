import type { Metadata } from 'next';
import { IBM_Plex_Serif, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// One family, three cuts. Plex was drawn for technical and standards
// documentation, which is the register this product lives in. The serif carries
// the argument, the sans carries the furniture, and the mono carries evidence:
// anything set in mono on this site is literal captured text.
const serif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-serif',
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

export const metadata: Metadata = {
  title: 'silentgreen — verification for AI work',
  description:
    'Checks whether AI and automation did the job, and never asks a model to grade a model. Catches fabricated facts, unrendered templates, deferrals booked as resolutions, and self-contradiction.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
