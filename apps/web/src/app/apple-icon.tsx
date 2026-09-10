import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0b0d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="120" height="120" viewBox="0 0 64 64">
          <line x1="20" y1="42" x2="44" y2="22" stroke="#43b982" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="20" cy="42" r="7" fill="#43b982" />
          <circle cx="44" cy="22" r="5" fill="#43b982" />
          <circle cx="47" cy="47" r="4" fill="#e07a4c" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
