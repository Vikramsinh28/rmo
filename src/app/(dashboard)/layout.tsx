'use client';

import { Sidebar } from '@/components/organisms/shared/navigation/Sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useAuthStore } from '@/store/auth';
import { ThemeProvider } from 'next-themes';

function ConsoleHeader() {
  const user = useAuthStore(state => state.user);
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4 lg:px-6">
      <div>
        <p className="text-sm font-semibold tracking-tight">RMO Remote Monitoring</p>
        <p className="text-xs text-muted-foreground">Administration console</p>
      </div>
      {user ? (
        <p className="text-xs text-muted-foreground">
          {user.name}
          <span className="ml-2 rounded-full border px-2 py-0.5">{user.rmoRole || user.role}</span>
        </p>
      ) : null}
    </header>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" attribute="class">
      <SidebarProvider>
        <Sidebar />
        <SidebarInset>
          <div className="flex flex-1 flex-col bg-muted/40">
            <ConsoleHeader />
            <div className="flex flex-1 flex-col gap-2 py-4">{children}</div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  );
}
