import { siteConfig } from '@/app/siteConfig';
import {
  BookMarked,
  Building2,
  Camera,
  ChartColumn,
  ChartNoAxesCombined,
  CircleUser,
  ClipboardList,
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
  Video,
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
const FORM_ADMIN = ['SYSTEM_ADMIN', 'DIVISION_ADMIN'];
const FORM_READ = [...FORM_ADMIN, 'DIVISION_MONITOR'];
const FORM_USE = [...FORM_READ, 'LOBBY_USER', 'CREW_USER'];

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
      {
        title: 'Lobby desk',
        url: siteConfig.baseLinks.monitoringDesk,
        icon: DoorOpen,
        roles: ['LOBBY_USER', 'CREW_USER'],
      },
      {
        title: 'Call history',
        url: siteConfig.baseLinks.monitoringHistory,
        icon: ScrollText,
        roles: DIVISION,
      },
      {
        title: 'Recordings',
        url: siteConfig.baseLinks.monitoringRecordings,
        icon: Video,
        roles: DIVISION,
      },
      {
        title: 'Cameras',
        url: siteConfig.baseLinks.monitoringCameras,
        icon: Camera,
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
      {
        title: 'Enrollments',
        url: siteConfig.baseLinks.enrollments,
        icon: ClipboardList,
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
      {
        title: 'Enrollments',
        url: siteConfig.baseLinks.enrollments,
        icon: ClipboardList,
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
    label: 'Records',
    items: [
      {
        title: 'Forms',
        url: siteConfig.baseLinks.forms,
        icon: ClipboardPen,
        roles: FORM_USE,
      },
      {
        title: 'Registers',
        url: siteConfig.baseLinks.registers,
        icon: BookMarked,
        roles: FORM_READ,
      },
      {
        title: 'Submissions',
        url: siteConfig.baseLinks.submissions,
        icon: Inbox,
        roles: FORM_USE,
      },
      {
        title: 'Analytics',
        url: siteConfig.baseLinks.analytics,
        icon: ChartNoAxesCombined,
        roles: FORM_ADMIN,
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
  { title: 'Live session', icon: Tv },
];
