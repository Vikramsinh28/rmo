import { siteConfig } from '@/app/siteConfig';
import {
  BookMarked,
  Building2,
  Camera,
  ChartColumn,
  CircleUser,
  ClipboardPen,
  DoorOpen,
  Inbox,
  LayoutDashboard,
  MapPinned,
  ScrollText,
  Settings,
  Shield,
  TabletSmartphone,
  Tv,
  Users,
  Warehouse,
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
    label: 'Live',
    items: [
      {
        title: 'Live',
        url: siteConfig.baseLinks.monitoring,
        icon: Tv,
        roles: DIVISION,
      },
    ],
  },
  {
    label: 'Dashboard',
    items: [
      {
        title: 'Dashboard',
        url: siteConfig.baseLinks.overview,
        icon: LayoutDashboard,
        roles: [...SYSTEM, 'SUPER_ADMIN', 'LOBBY_USER'],
      },
      {
        title: 'Summary',
        url: siteConfig.baseLinks.overview,
        icon: ChartColumn,
        roles: ['DIVISION_ADMIN'],
      },
      {
        title: 'My lobby',
        url: siteConfig.baseLinks.lobbies,
        icon: DoorOpen,
        roles: ['LOBBY_USER'],
      },
      {
        title: 'My account',
        url: siteConfig.baseLinks.crew,
        icon: CircleUser,
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
        icon: Warehouse,
        roles: [...SYSTEM, 'DIVISION_MONITOR'],
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
        roles: SYSTEM,
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
    label: 'People',
    items: [
      {
        title: 'Users',
        url: siteConfig.baseLinks.users,
        icon: Users,
        roles: ['DIVISION_ADMIN'],
      },
    ],
  },
  {
    label: 'Lobbies',
    items: [
      {
        title: 'Lobbies',
        url: siteConfig.baseLinks.lobbies,
        icon: Warehouse,
        roles: ['DIVISION_ADMIN'],
      },
    ],
  },
  {
    label: 'Devices',
    items: [
      {
        title: 'Cameras',
        url: `${siteConfig.baseLinks.devices}?type=CAMERA`,
        icon: Camera,
        roles: [...SYSTEM, 'DIVISION_ADMIN'],
      },
      {
        title: 'Kiosks',
        url: `${siteConfig.baseLinks.devices}?type=KIOSK`,
        icon: TabletSmartphone,
        roles: [...SYSTEM, 'DIVISION_ADMIN'],
      },
    ],
  },
  {
    label: 'Forms',
    items: [
      {
        title: 'Forms',
        url: siteConfig.baseLinks.forms,
        icon: ClipboardPen,
        roles: ['DIVISION_ADMIN'],
        hint: 'Next phase',
      },
    ],
  },
  {
    label: 'Registers',
    items: [
      {
        title: 'Registers',
        url: siteConfig.baseLinks.registers,
        icon: BookMarked,
        roles: ['DIVISION_ADMIN'],
        hint: 'Next phase',
      },
    ],
  },
  {
    label: 'Submissions',
    items: [
      {
        title: 'Submissions',
        url: siteConfig.baseLinks.submissions,
        icon: Inbox,
        roles: ['DIVISION_ADMIN'],
        hint: 'Next phase',
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
  { title: 'Forms', icon: ClipboardPen },
  { title: 'Devices', icon: Camera },
  { title: 'Live monitoring', icon: Tv },
];
