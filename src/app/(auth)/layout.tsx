'use client';

import { siteConfig } from '@/app/siteConfig';
import { homePathForRole } from '@/lib/rmo/access';
import { useAuthStore } from '@/store/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(state => state.user);
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.replace(homePathForRole(user.rmoRole || user.role));
    }
  }, [router, user]);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between bg-zinc-950 px-10 py-12 text-zinc-50 lg:flex">
        <div>
          <p className="text-sm font-medium tracking-[0.2em] text-zinc-400">RMO</p>
          <h1 className="mt-6 max-w-md text-4xl font-semibold tracking-tight">
            Remote Monitoring
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-zinc-400">
            Sign in to the operations console. Your role decides which zones, divisions, and
            lobbies you can administer.
          </p>
        </div>
        <p className="text-xs text-zinc-500">{siteConfig.name}</p>
      </section>
      <section className="flex items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </div>
  );
}
