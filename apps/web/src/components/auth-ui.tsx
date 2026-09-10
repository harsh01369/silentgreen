import Link from 'next/link';

export function AuthShell({
  title,
  children,
  alt,
}: {
  title: string;
  children: React.ReactNode;
  alt: { href: string; label: string };
}) {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 30%, rgba(67,185,130,0.10), transparent 70%), radial-gradient(50% 45% at 50% 90%, rgba(224,122,76,0.06), transparent 70%), #0a0b0d',
        }}
      />
      <div className="glass relative w-full max-w-sm rounded-2xl p-1.5">
        <div className="rounded-[13px] bg-[rgba(10,11,13,0.5)] p-7">
          <Link href="/" className="font-mono text-[15px] font-medium tracking-tight text-halo">
            silentgreen
          </Link>
          <p className="mt-7 font-mono text-[11px] uppercase tracking-[0.16em] text-halo-faint">{title}</p>
          <div className="mt-5">{children}</div>
          <p className="mt-7 border-t border-white/8 pt-4 font-mono text-xs text-halo-soft">
            <Link href={alt.href} className="text-traced hover:underline">
              {alt.label}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-xs text-halo-soft">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-lg border border-white/12 bg-white/5 px-3 py-2 font-mono text-sm text-halo outline-none transition-colors placeholder:text-halo-faint focus:border-traced"
      />
    </label>
  );
}
