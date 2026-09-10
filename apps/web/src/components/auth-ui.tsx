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
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center px-6">
      <Link href="/" className="font-mono text-[15px] font-medium tracking-tight text-ink">
        silentgreen
      </Link>
      <div className="mt-8 border-t border-rule pt-8">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">{title}</p>
        <div className="mt-6">{children}</div>
      </div>
      <p className="mt-8 border-t border-rule pt-4 font-mono text-xs text-ink-soft">
        <Link href={alt.href} className="text-stamp hover:underline">
          {alt.label}
        </Link>
      </p>
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
      <span className="mb-1.5 block font-mono text-xs text-ink-soft">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full border border-rule-strong bg-ground-raised px-3 py-2 font-mono text-sm text-ink outline-none transition-colors focus:border-stamp"
      />
    </label>
  );
}
