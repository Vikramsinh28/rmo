'use client';

import { useLogout } from '@/hooks/useLogout';
import {
  RiComputerLine,
  RiLogoutBoxRLine,
  RiMoonLine,
  RiSettings3Line,
  RiSunLine,
} from '@remixicon/react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { siteConfig } from '@/app/siteConfig';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useAuthStore } from '@/store/auth';
import { ChevronsUpDownIcon } from 'lucide-react';

export function UserProfileDropdown() {
  const { user, clearAuth } = useAuthStore();
  const { theme, setTheme } = useTheme();
  const logoutMutation = useLogout();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearAuth();
      router.push(siteConfig.baseLinks.login);
    }
  };

  if (!user) return null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground data-[size='lg']:group-data-[collapsible=icon]:p-0!"
            >
              {user.profilePicture ? (
                <Avatar>
                  <AvatarImage
                    src={user.profilePicture}
                    alt={user.name || ''}
                  />
                  <AvatarFallback className="rounded-lg">
                    {user.name ? user.name.substring(0, 2).toUpperCase() : '??'}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <Avatar>
                  <AvatarFallback className="rounded-lg">
                    {user.name ? user.name.substring(0, 2).toUpperCase() : '??'}
                  </AvatarFallback>
                </Avatar>
              )}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {user.name || 'User'}
                </span>
                <span className="truncate text-xs">
                  {user.email || ''}
                </span>
              </div>
              <ChevronsUpDownIcon />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Link href={siteConfig.baseLinks.settings} className="flex w-full items-center gap-2">
                  <RiSettings3Line className="size-4 shrink-0" aria-hidden="true" />
                  Settings
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <RiSunLine className="size-4 shrink-0" aria-hidden="true" />
                  Theme
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(value) => {
                      setTheme(value);
                    }}
                  >
                    <DropdownMenuRadioItem value="light">
                      <RiSunLine className="size-4 shrink-0" aria-hidden="true" />
                      Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <RiMoonLine className="size-4 shrink-0" aria-hidden="true" />
                      Dark
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <RiComputerLine className="size-4 shrink-0" aria-hidden="true" />
                      System
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <button
                  type="button"
                  className="flex w-full items-center gap-2"
                  onClick={handleLogout}
                >
                  <RiLogoutBoxRLine className="size-4 shrink-0" aria-hidden="true" />
                  Sign out
                </button>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
