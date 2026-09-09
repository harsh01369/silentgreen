'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signUp } from '@/lib/auth-client';
import { AuthShell, Field } from '@/components/auth-ui';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signUp.email({ name, email, password });
    setBusy(false);
    if (error) {
      setError(error.message ?? 'Could not create the account.');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <AuthShell title="Create an account" alt={{ href: '/login', label: 'I already have one' }}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" type="text" value={name} onChange={setName} autoComplete="name" />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <p className="text-xs text-paper-faint">At least 10 characters.</p>
        {error && <p className="text-sm text-amber">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-patina py-2.5 text-sm font-medium text-ink-sunken transition-colors hover:bg-patina-bright disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}
