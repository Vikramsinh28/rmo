'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { homePathForRole } from '@/lib/rmo/access';
import { authApi } from '@/services/api/auth';
import { useAuthStore } from '@/store/auth';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore(state => state.setAuth);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const response = await authApi.login({ identifier, password });
      const user = response.user;
      setAuth({
          id: String(user.id),
          email: user.email,
          name: user.name,
          profilePicture: user.profilePicture,
          role: user.rmoRole || user.role,
          rmoRole: user.rmoRole || user.role,
          loginId: user.loginId,
          scope: user.scope,
          homeZoneId: user.homeZoneId,
          homeDivisionId: user.homeDivisionId,
          homeLobbyId: user.homeLobbyId,
          isOnboarded: user.isOnboarded ?? true,
        });
      toast.success('Signed in');
      router.push(homePathForRole(user.rmoRole || user.role));
    } catch (cause) {
      const message =
        cause && typeof cause === 'object' && 'response' in cause
          ? (cause as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setError(message || 'Sign in failed. Check the user ID and password.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-2xl border bg-card p-8 shadow-sm">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground lg:hidden">RMO</p>
      <h1 className="text-2xl font-semibold tracking-tight">RMO Remote Monitoring</h1>
      <p className="mt-2 text-sm text-muted-foreground">Sign in with your user ID or email.</p>
      <form className="mt-8 space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <Label htmlFor="identifier">User ID / Email</Label>
          <Input
            id="identifier"
            autoComplete="username"
            value={identifier}
            onChange={event => setIdentifier(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
          />
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="h-10 w-full text-sm" disabled={pending} type="submit">
          {pending ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>
    </div>
  );
}
