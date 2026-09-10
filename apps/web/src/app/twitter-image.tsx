import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'silentgreen — verification for AI work';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0a0b0d',
          backgroundImage:
            'radial-gradient(600px 400px at 20% 30%, rgba(67,185,130,0.16), transparent 70%), radial-gradient(500px 380px at 85% 75%, rgba(224,122,76,0.12), transparent 70%)',
          padding: '72px',
          color: '#f3f2ee',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#101216',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
            }}
          >
            ✳
          </div>
          <div style={{ fontSize: 28, letterSpacing: -0.5 }}>silentgreen</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 66, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 900, fontFamily: 'serif' }}>
            Nobody checked whether the AI did the job.
          </div>
          <div style={{ fontSize: 25, color: '#a9aab0', maxWidth: 820, lineHeight: 1.4 }}>
            What it can prove, what it can disprove, and what cannot be settled either way. It never asks a model to
            grade a model.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 28, fontSize: 20 }}>
          <span style={{ color: '#43b982' }}>proven</span>
          <span style={{ color: '#e07a4c' }}>violated</span>
          <span style={{ color: '#8b867a' }}>unproven</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
