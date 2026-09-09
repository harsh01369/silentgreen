'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from '@/lib/auth-client';
import { AuthShell, Field } from '@/components/auth-ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn.email({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message ?? 'That did not work. Check the email and password.');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <AuthShell title="Sign in" alt={{ href: '/signup', label: 'Create an account' }}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && <p className="text-sm text-amber">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-patina py-2.5 text-sm font-medium text-ink-sunken transition-colors hover:bg-patina-bright disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
