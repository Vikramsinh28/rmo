'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { homePathForRole } from '@/lib/rmo/access';
import { authApi } from '@/services/api/auth';
import { useAuthStore } from '@/store/auth';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
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
  const [showPassword, setShowPassword] = useState(false);

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

  const fieldClass =
    'h-12 rounded-xl border-white/10 bg-white/5 px-3 text-sm text-zinc-50 placeholder:text-zinc-500 focus-visible:border-orange-300/70 focus-visible:ring-orange-300/30';

  return (
    <div className="animate-rmo-rise rounded-3xl border border-white/10 bg-zinc-950/70 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <img src="/logos/rmo-logo.png" alt="" className="mb-6 h-10 w-auto object-contain lg:hidden" />
      <p className="text-xs font-medium tracking-[0.22em] text-orange-200/80">SIGN IN</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Welcome back</h1>
      <p className="mt-2 text-sm text-zinc-400">Use your user ID or email to open the live workspace.</p>
      <form className="mt-8 space-y-5" onSubmit={onSubmit}>
        <div className="animate-rmo-rise space-y-2 [animation-delay:120ms]">
          <Label htmlFor="identifier" className="text-zinc-300">
            User ID / Email
          </Label>
          <Input
            id="identifier"
            autoComplete="username"
            placeholder="User ID or email"
            value={identifier}
            onChange={event => setIdentifier(event.target.value)}
            className={fieldClass}
            required
          />
        </div>
        <div className="animate-rmo-rise space-y-2 [animation-delay:200ms]">
          <Label htmlFor="password" className="text-zinc-300">
            Password
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              className={`${fieldClass} pr-11`}
              required
            />
            <button
              type="button"
              className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-400 hover:text-zinc-100"
              onClick={() => setShowPassword(current => !current)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        {error ? (
          <p className="animate-rmo-rise text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          className="animate-rmo-rise relative h-12 w-full overflow-hidden rounded-xl bg-orange-500 text-sm font-semibold text-zinc-950 hover:bg-orange-400 [animation-delay:280ms]"
          disabled={pending}
          type="submit"
        >
          <span
            className="pointer-events-none absolute inset-0 animate-rmo-shimmer bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.45),transparent)] bg-[length:200%_100%]"
            aria-hidden
          />
          <span className="relative">{pending ? 'Signing in…' : 'Sign In'}</span>
        </Button>
      </form>
      <p className="mt-6 text-sm text-zinc-400">
        Joining a division as crew?{' '}
        <Link href="/enroll" className="font-medium text-orange-200 underline">
          Crew enrollment
        </Link>
      </p>
    </div>
  );
}
