'use client';

import { siteConfig } from '@/app/siteConfig';
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { NAVIGATION_ITEMS } from '@/lib/constants/sidebar-navigation';
import { useAuthStore } from '@/store/auth';
import { useSafetyAlertStore } from '@/store/safety-alerts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserProfileDropdown } from './UserProfileDropdown';

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore(state => state.user);
  const userRole = user?.rmoRole || user?.role;
  const pendingSafety = useSafetyAlertStore(state => state.pending);

  const isActive = (itemUrl: string) => {
    if (itemUrl === siteConfig.baseLinks.overview) {
      return pathname === itemUrl;
    }
    return pathname === itemUrl || pathname.startsWith(`${itemUrl}/`);
  };

  return (
    <ShadcnSidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href={siteConfig.baseLinks.overview} title="RMO">
                <img src="/logos/rmo-logo.png" alt="RMO" className="h-8 w-auto object-contain" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAVIGATION_ITEMS.map(section => {
          const items = section.items.filter(item => {
            if (!item.roles?.length) return true;
            if (!userRole) return false;
            return item.roles.includes(userRole);
          });

          if (items.length === 0) return null;

          return (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarMenu>
                {items.map(item => (
                  <SidebarMenuItem key={`${item.title}:${item.url}`}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link href={item.url} title={item.title}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.url === siteConfig.baseLinks.safetyEvents && pendingSafety ? (
                      <SidebarMenuBadge
                        className="bg-red-600 text-white"
                        aria-label={`${pendingSafety} safety events pending review`}
                      >
                        {pendingSafety > 99 ? '99+' : pendingSafety}
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <UserProfileDropdown />
      </SidebarFooter>
      <SidebarRail />
    </ShadcnSidebar>
  );
}
