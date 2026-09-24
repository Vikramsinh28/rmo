'use client';

import { LoginFeedCard } from '@/components/branding/LoginFeedCard';
import { homePathForRole } from '@/lib/rmo/access';
import { useAuthStore } from '@/store/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const FEEDS = [
  { name: 'Entrance', delay: '0s' },
  { name: 'Platform', delay: '0.6s' },
  { name: 'Desk', delay: '1.2s' },
] as const;

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(state => state.user);
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.replace(homePathForRole(user.rmoRole || user.role));
    }
  }, [router, user]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-50">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-12%] h-[28rem] w-[28rem] rounded-full bg-orange-500/25 blur-3xl animate-rmo-drift" />
        <div className="absolute right-[-8%] top-[18%] h-[32rem] w-[32rem] rounded-full bg-sky-500/20 blur-3xl animate-rmo-drift [animation-delay:-7s]" />
        <div className="absolute bottom-[-18%] left-[28%] h-[24rem] w-[24rem] rounded-full bg-amber-300/15 blur-3xl animate-rmo-drift [animation-delay:-3s]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]" />
      </div>

      <div className="relative grid min-h-screen lg:grid-cols-[1.15fr_0.85fr]">
        <section className="hidden flex-col justify-between px-12 py-12 lg:flex">
          <div className="animate-rmo-rise">
            <img src="/logos/rmo-logo.png" alt="RMO" className="h-12 w-auto object-contain" />
          </div>
          <div>
            <p className="animate-rmo-rise text-sm font-medium tracking-[0.28em] text-orange-200/80 [animation-delay:80ms]">
              RAILWAY MONITOR
            </p>
            <h1 className="animate-rmo-rise mt-4 max-w-lg text-5xl font-semibold tracking-tight [animation-delay:160ms]">
              Watch every lobby from one desk.
            </h1>
            <p className="animate-rmo-rise mt-4 max-w-md text-sm leading-6 text-zinc-400 [animation-delay:240ms]">
              Cameras, kiosks, and the people assigned to them. Sign in and the live workspace
              opens for your division.
            </p>
            <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
              {FEEDS.map(feed => (
                <LoginFeedCard key={feed.name} name={feed.name} delay={feed.delay} />
              ))}
            </div>
          </div>
          <p className="animate-rmo-rise text-xs text-zinc-500 [animation-delay:480ms]">
            Remote Monitoring Operations
          </p>
        </section>

        <section className="flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-md">{children}</div>
        </section>
      </div>
    </div>
  );
}
