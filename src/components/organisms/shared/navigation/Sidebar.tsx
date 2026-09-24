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
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { NAVIGATION_ITEMS } from '@/lib/constants/sidebar-navigation';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserProfileDropdown } from './UserProfileDropdown';

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore(state => state.user);
  const userRole = user?.rmoRole || user?.role;

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
              <Link href={siteConfig.baseLinks.overview}>
                <img src="/logos/rmo-logo.png" alt="RMO" className="h-8 w-auto object-contain" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAVIGATION_ITEMS.map(section => {
          const items = section.items.filter(item => {
            if (!item.roles || !userRole) return true;
            return item.roles.includes(userRole);
          });

          if (items.length === 0) return null;

          return (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarMenu>
                {items.map(item => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
        {userRole === 'SYSTEM_ADMIN' || userRole === 'DIVISION_MONITOR' ? (
          <SidebarGroup>
            <SidebarGroupLabel>Next phase</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton disabled tooltip="Coming in next phase">
                  <span>Live monitoring</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <UserProfileDropdown />
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
