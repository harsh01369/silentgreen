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
    <main className="flex min-h-[100dvh] items-center justify-center px-6">
      <div className="glass w-full max-w-sm rounded-2xl p-8">
        <Link href="/" className="font-display text-lg tracking-tight text-paper">
          silent<span className="text-patina-bright">green</span>
        </Link>
        <h1 className="mt-6 font-display text-2xl text-paper">{title}</h1>
        <div className="mt-6">{children}</div>
        <p className="mt-6 text-sm text-paper-dim">
          <Link href={alt.href} className="text-patina-bright hover:underline">
            {alt.label}
          </Link>
        </p>
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
      <span className="mb-1.5 block text-sm text-paper-dim">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-lg border border-line-bright bg-ink-sunken/60 px-3 py-2 text-sm text-paper outline-none transition-colors focus:border-patina"
      />
    </label>
  );
}
