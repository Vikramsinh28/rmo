import { siteConfig } from '@/app/siteConfig';
import {
  Building2,
  ClipboardList,
  LayoutDashboard,
  MapPinned,
  Monitor,
  Radio,
  ScrollText,
  Settings,
  Shield,
  TrainFront,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavigationItem {
  title: string;
  url: string;
  icon: LucideIcon;
  roles: readonly string[];
  hint?: string;
}

export interface NavigationSection {
  label: string;
  items: NavigationItem[];
}

const SYSTEM = ['SYSTEM_ADMIN'];
const DIVISION = [...SYSTEM, 'DIVISION_ADMIN', 'DIVISION_MONITOR'];
const LOBBY = [...DIVISION, 'LOBBY_USER'];

export const NAVIGATION_ITEMS: NavigationSection[] = [
  {
    label: 'Dashboard',
    items: [
      {
        title: 'Dashboard',
        url: siteConfig.baseLinks.overview,
        icon: LayoutDashboard,
        roles: [...SYSTEM, 'SUPER_ADMIN', 'DIVISION_ADMIN', 'LOBBY_USER'],
      },
      {
        title: 'Division',
        url: siteConfig.baseLinks.divisions,
        icon: TrainFront,
        roles: ['DIVISION_ADMIN'],
      },
      {
        title: 'Monitoring',
        url: siteConfig.baseLinks.monitoring,
        icon: Monitor,
        roles: ['DIVISION_MONITOR'],
        hint: 'Coming in next phase',
      },
      {
        title: 'My lobby',
        url: siteConfig.baseLinks.lobbies,
        icon: Radio,
        roles: ['LOBBY_USER'],
      },
      {
        title: 'My account',
        url: siteConfig.baseLinks.crew,
        icon: Users,
        roles: ['CREW_USER'],
      },
    ],
  },
  {
    label: 'Organization',
    items: [
      {
        title: 'Zones',
        url: siteConfig.baseLinks.zones,
        icon: MapPinned,
        roles: SYSTEM,
      },
      {
        title: 'Divisions',
        url: siteConfig.baseLinks.divisions,
        icon: Building2,
        roles: SYSTEM,
      },
      {
        title: 'Lobbies',
        url: siteConfig.baseLinks.lobbies,
        icon: Radio,
        roles: [...SYSTEM, 'DIVISION_ADMIN', 'DIVISION_MONITOR'],
      },
    ],
  },
  {
    label: 'Access Management',
    items: [
      {
        title: 'Users',
        url: siteConfig.baseLinks.users,
        icon: Users,
        roles: [...SYSTEM, 'DIVISION_ADMIN'],
      },
      {
        title: 'Roles',
        url: siteConfig.baseLinks.roles,
        icon: Shield,
        roles: SYSTEM,
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        title: 'Audit logs',
        url: siteConfig.baseLinks.audit,
        icon: ScrollText,
        roles: SYSTEM,
      },
      {
        title: 'Settings',
        url: siteConfig.baseLinks.settings,
        icon: Settings,
        roles: [...LOBBY, 'SUPER_ADMIN', 'CREW_USER'],
      },
    ],
  },
];

export const COMING_NEXT = [
  { title: 'Forms', icon: ClipboardList },
  { title: 'Devices', icon: Radio },
  { title: 'Live monitoring', icon: Monitor },
];
