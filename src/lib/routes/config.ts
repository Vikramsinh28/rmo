/**
 * Route configuration definitions.
 * Page routes for the RMO shell and the auth/file APIs that remain.
 */

import {
  ADMIN,
  CREW_USER,
  DIVISION_ADMIN,
  DIVISION_MONITOR,
  LOBBY_USER,
  RouteConfig,
  SUPER_ADMIN,
  SYSTEM_ADMIN,
  USER,
} from './types';

const SIGNED_IN = [
  USER,
  ADMIN,
  SYSTEM_ADMIN,
  SUPER_ADMIN,
  DIVISION_ADMIN,
  DIVISION_MONITOR,
  LOBBY_USER,
  CREW_USER,
] as const;

const ORG_ADMIN = [SYSTEM_ADMIN] as const;
const DIVISION_READ = [SYSTEM_ADMIN, DIVISION_ADMIN, DIVISION_MONITOR] as const;
const USER_ADMIN = [SYSTEM_ADMIN, DIVISION_ADMIN] as const;
const DEVICE_ADMIN = USER_ADMIN;
const DEVICE_READ = [...DEVICE_ADMIN, DIVISION_MONITOR] as const;
const LOBBY_READ = [...DIVISION_READ, LOBBY_USER] as const;
const FORM_ADMIN = [SYSTEM_ADMIN, DIVISION_ADMIN] as const;
const FORM_READ = [...FORM_ADMIN, DIVISION_MONITOR] as const;
const FORM_USE = [...FORM_READ, LOBBY_USER, CREW_USER] as const;
const FORM_SUBMIT = [LOBBY_USER, CREW_USER] as const;
const ENROLLMENT_READ = [SYSTEM_ADMIN, DIVISION_ADMIN] as const;
const ENROLLMENT_DECIDE = [DIVISION_ADMIN] as const;

export const ALL_ROUTES: RouteConfig[] = [
  { path: '/', isPublic: true },
  { path: '/login', isPublic: true },
  { path: '/enroll', isPublic: true },
  { path: '/sitemap.xml', isPublic: true },
  { path: '/robots.txt', isPublic: true },
  { path: '/api/health', isPublic: true },

  { path: '/favicon.ico', isPublic: true },
  { path: '/favicon/[...path]', isPublic: true },
  { path: '/_next/[...path]', isPublic: true },
  { path: '/images/[...path]', isPublic: true },
  { path: '/logos/[...path]', isPublic: true },

  { path: '/api/auth/logout', isPublic: true },
  { path: '/api/auth', isPublic: true },
  { path: '/api/auth/login', isPublic: true },
  { path: '/api/auth/signup', isPublic: true },
  { path: '/api/auth/verify-signup', isPublic: true },
  { path: '/api/auth/forgot-password', isPublic: true },
  { path: '/api/auth/reset-password', isPublic: true },
  { path: '/api/auth/resend-otp', isPublic: true },
  { path: '/api/auth/me', isPublic: false, accessTo: { GET: [...SIGNED_IN] } },

  { path: '/overview', isPublic: false, accessTo: { GET: [...SIGNED_IN] } },
  { path: '/zones', isPublic: false, accessTo: { GET: [...ORG_ADMIN] } },
  { path: '/divisions', isPublic: false, accessTo: { GET: [...DIVISION_READ] } },
  {
    path: '/divisions/[id]/ai',
    isPublic: false,
    accessTo: { GET: [SYSTEM_ADMIN, DIVISION_ADMIN, DIVISION_MONITOR] },
  },
  { path: '/lobbies', isPublic: false, accessTo: { GET: [...LOBBY_READ] } },
  { path: '/users', isPublic: false, accessTo: { GET: [...USER_ADMIN] } },
  { path: '/roles', isPublic: false, accessTo: { GET: [...ORG_ADMIN] } },
  { path: '/audit', isPublic: false, accessTo: { GET: [...ORG_ADMIN] } },
  { path: '/crew', isPublic: false, accessTo: { GET: [CREW_USER, ...ORG_ADMIN] } },
  {
    path: '/crew/face-enrollment',
    isPublic: false,
    accessTo: { GET: [CREW_USER] },
  },
  {
    path: '/api/crew/face-enrollment',
    isPublic: false,
    accessTo: { GET: [CREW_USER], POST: [CREW_USER] },
  },
  { path: '/monitoring', isPublic: false, accessTo: { GET: [...DIVISION_READ] } },
  { path: '/forms', isPublic: false, accessTo: { GET: [...FORM_USE] } },
  { path: '/forms/new', isPublic: false, accessTo: { GET: [...FORM_ADMIN] } },
  { path: '/forms/[id]/fill', isPublic: false, accessTo: { GET: [...FORM_USE] } },
  { path: '/forms/[id]', isPublic: false, accessTo: { GET: [...FORM_USE] } },
  { path: '/devices', isPublic: false, accessTo: { GET: [...DEVICE_ADMIN] } },
  { path: '/lobbies/[id]', isPublic: false, accessTo: { GET: [...DIVISION_READ] } },
  { path: '/registers', isPublic: false, accessTo: { GET: [...FORM_READ] } },
  { path: '/submissions', isPublic: false, accessTo: { GET: [...FORM_USE] } },
  { path: '/submissions/[id]', isPublic: false, accessTo: { GET: [...FORM_USE] } },
  { path: '/analytics', isPublic: false, accessTo: { GET: [...FORM_ADMIN] } },
  { path: '/enrollments', isPublic: false, accessTo: { GET: [...ENROLLMENT_READ] } },
  { path: '/enrollments/[id]', isPublic: false, accessTo: { GET: [...ENROLLMENT_READ] } },
  { path: '/safety-events', isPublic: false, accessTo: { GET: [...ORG_ADMIN] } },
  { path: '/settings', isPublic: false, accessTo: { GET: [...SIGNED_IN] } },

  {
    path: '/api/auth',
    isPublic: false,
    accessTo: { GET: [...SIGNED_IN] },
  },
  {
    path: '/api/users/data',
    isPublic: false,
    accessTo: { GET: [USER, ADMIN] },
  },
  {
    path: '/api/files',
    isPublic: false,
    accessTo: { GET: [USER, ADMIN], POST: [USER, ADMIN] },
  },
  {
    path: '/api/files/[id]',
    isPublic: false,
    accessTo: { GET: [USER, ADMIN], PUT: [USER, ADMIN], DELETE: [USER, ADMIN] },
  },
  {
    path: '/api/files/[id]/download',
    isPublic: false,
    accessTo: { POST: [USER, ADMIN] },
  },
  {
    path: '/api/file-upload/presigned-url',
    isPublic: false,
    accessTo: { POST: [USER, ADMIN] },
  },
  {
    path: '/api/admin/users',
    isPublic: false,
    accessTo: { GET: [...USER_ADMIN], POST: [...USER_ADMIN] },
  },
  {
    path: '/api/admin/users/[id]',
    isPublic: false,
    accessTo: {
      GET: [...USER_ADMIN],
      PUT: [...USER_ADMIN],
      PATCH: [...USER_ADMIN],
      DELETE: [...ORG_ADMIN],
    },
  },
  {
    path: '/api/admin/users/[id]/restore',
    isPublic: false,
    accessTo: { POST: [...ORG_ADMIN] },
  },
  {
    path: '/api/admin/users/[id]/password',
    isPublic: false,
    accessTo: { POST: [...USER_ADMIN] },
  },
  {
    path: '/api/admin/zones',
    isPublic: false,
    accessTo: { GET: [...ORG_ADMIN], POST: [...ORG_ADMIN] },
  },
  {
    path: '/api/admin/zones/[id]',
    isPublic: false,
    accessTo: { PATCH: [...ORG_ADMIN] },
  },
  {
    path: '/api/admin/divisions',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ], POST: [...ORG_ADMIN] },
  },
  {
    path: '/api/admin/divisions/[id]/ai',
    isPublic: false,
    accessTo: {
      GET: [SYSTEM_ADMIN, DIVISION_ADMIN, DIVISION_MONITOR],
      PATCH: [SYSTEM_ADMIN],
    },
  },
  {
    path: '/api/admin/divisions/[id]',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ], PATCH: [...ORG_ADMIN] },
  },
  {
    path: '/api/admin/lobbies',
    isPublic: false,
    accessTo: { GET: [...LOBBY_READ], POST: [...ORG_ADMIN] },
  },
  {
    path: '/api/admin/lobbies/[id]',
    isPublic: false,
    accessTo: { GET: [...LOBBY_READ], PATCH: [...ORG_ADMIN] },
  },
  {
    path: '/api/admin/devices',
    isPublic: false,
    accessTo: { GET: [...DEVICE_READ], POST: [...DEVICE_ADMIN] },
  },
  {
    path: '/api/admin/devices/[id]',
    isPublic: false,
    accessTo: { PATCH: [...DEVICE_ADMIN] },
  },
  {
    path: '/api/admin/devices/[id]/enable',
    isPublic: false,
    accessTo: { POST: [...DEVICE_ADMIN] },
  },
  {
    path: '/api/admin/devices/[id]/disable',
    isPublic: false,
    accessTo: { POST: [...DEVICE_ADMIN] },
  },
  {
    path: '/api/admin/roles',
    isPublic: false,
    accessTo: { GET: [...ORG_ADMIN] },
  },
  {
    path: '/api/admin/audit-logs',
    isPublic: false,
    accessTo: { GET: [...ORG_ADMIN] },
  },
  {
    path: '/api/admin/dashboard',
    isPublic: false,
    accessTo: { GET: [...SIGNED_IN] },
  },
  {
    path: '/api/admin/forms',
    isPublic: false,
    accessTo: { GET: [...FORM_USE], POST: [...FORM_ADMIN] },
  },
  {
    path: '/api/admin/forms/[id]',
    isPublic: false,
    accessTo: { GET: [...FORM_USE], PATCH: [...FORM_ADMIN] },
  },
  {
    path: '/api/admin/forms/[id]/publish',
    isPublic: false,
    accessTo: { POST: [...FORM_ADMIN] },
  },
  {
    path: '/api/admin/forms/[id]/archive',
    isPublic: false,
    accessTo: { POST: [...FORM_ADMIN] },
  },
  {
    path: '/api/admin/forms/[id]/versions',
    isPublic: false,
    accessTo: { POST: [...FORM_ADMIN] },
  },
  {
    path: '/api/admin/registers',
    isPublic: false,
    accessTo: { GET: [...FORM_READ], POST: [...FORM_ADMIN] },
  },
  {
    path: '/api/admin/registers/[id]',
    isPublic: false,
    accessTo: { GET: [...FORM_READ], PATCH: [...FORM_ADMIN] },
  },
  {
    path: '/api/submissions/export',
    isPublic: false,
    accessTo: { GET: [...FORM_ADMIN] },
  },
  {
    path: '/api/submissions',
    isPublic: false,
    accessTo: { GET: [...FORM_USE], POST: [...FORM_SUBMIT] },
  },
  {
    path: '/api/submissions/[id]',
    isPublic: false,
    accessTo: { GET: [...FORM_USE], PATCH: [...FORM_ADMIN] },
  },
  {
    path: '/api/analytics/submissions',
    isPublic: false,
    accessTo: { GET: [...FORM_ADMIN] },
  },
  {
    path: '/api/analytics/forms',
    isPublic: false,
    accessTo: { GET: [...FORM_ADMIN] },
  },
  {
    path: '/api/analytics/lobbies',
    isPublic: false,
    accessTo: { GET: [...FORM_ADMIN] },
  },
  { path: '/api/enrollment/options', isPublic: true },
  { path: '/api/enrollment/crew', isPublic: true },
  { path: '/api/enrollment/crew/[code]/status', isPublic: true },
  {
    path: '/api/admin/crew-enrollments',
    isPublic: false,
    accessTo: { GET: [...ENROLLMENT_READ] },
  },
  {
    path: '/api/admin/crew-enrollments/[id]/approve',
    isPublic: false,
    accessTo: { POST: [...ENROLLMENT_DECIDE] },
  },
  {
    path: '/api/admin/crew-enrollments/[id]/reject',
    isPublic: false,
    accessTo: { POST: [...ENROLLMENT_DECIDE] },
  },
  {
    path: '/api/admin/crew-enrollments/[id]',
    isPublic: false,
    accessTo: { GET: [...ENROLLMENT_READ] },
  },

  { path: '/monitoring/cameras', isPublic: false, accessTo: { GET: [...DIVISION_READ] } },
  { path: '/monitoring/history', isPublic: false, accessTo: { GET: [...DIVISION_READ] } },
  { path: '/monitoring/recordings', isPublic: false, accessTo: { GET: [...DIVISION_READ] } },
  { path: '/monitoring/desk', isPublic: false, accessTo: { GET: [LOBBY_USER, CREW_USER] } },
  {
    path: '/monitoring/calls/[id]',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ, LOBBY_USER, CREW_USER] },
  },

  {
    path: '/api/monitoring/ai',
    isPublic: false,
    accessTo: { GET: [DIVISION_ADMIN, DIVISION_MONITOR, LOBBY_USER] },
  },
  {
    path: '/api/monitoring/events',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ, LOBBY_USER, CREW_USER] },
  },
  {
    path: '/api/monitoring/ice',
    isPublic: false,
    accessTo: { GET: [DIVISION_MONITOR, LOBBY_USER, CREW_USER] },
  },
  {
    path: '/api/monitoring/presence',
    isPublic: false,
    accessTo: { POST: [LOBBY_USER] },
  },
  {
    path: '/api/monitoring/history',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ] },
  },
  {
    path: '/api/monitoring/lobbies',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ, LOBBY_USER, CREW_USER] },
  },
  {
    path: '/api/monitoring/lobbies/[id]/call',
    isPublic: false,
    accessTo: { POST: [DIVISION_MONITOR] },
  },
  {
    path: '/api/monitoring/lobbies/[id]',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ, LOBBY_USER, CREW_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/ai',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ, LOBBY_USER, CREW_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/ai/start',
    isPublic: false,
    accessTo: { POST: [SYSTEM_ADMIN, DIVISION_MONITOR] },
  },
  {
    path: '/api/monitoring/calls/[id]/ai/stop',
    isPublic: false,
    accessTo: { POST: [SYSTEM_ADMIN, DIVISION_MONITOR] },
  },
  {
    path: '/api/monitoring/calls/[id]/ai/status',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ, LOBBY_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/ai/frames',
    isPublic: false,
    accessTo: { POST: [SYSTEM_ADMIN, DIVISION_MONITOR, LOBBY_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/ai/recognize',
    isPublic: false,
    accessTo: { POST: [SYSTEM_ADMIN, DIVISION_MONITOR] },
  },
  {
    path: '/api/monitoring/calls/[id]/accept',
    isPublic: false,
    accessTo: { POST: [LOBBY_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/reject',
    isPublic: false,
    accessTo: { POST: [LOBBY_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/end',
    isPublic: false,
    accessTo: { POST: [DIVISION_MONITOR, LOBBY_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/connection',
    isPublic: false,
    accessTo: { POST: [DIVISION_MONITOR, LOBBY_USER, CREW_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/token',
    isPublic: false,
    accessTo: { POST: [DIVISION_MONITOR, LOBBY_USER, CREW_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/signal',
    isPublic: false,
    accessTo: {
      GET: [DIVISION_MONITOR, LOBBY_USER, CREW_USER],
      POST: [DIVISION_MONITOR, LOBBY_USER, CREW_USER],
    },
  },
  {
    path: '/api/monitoring/calls/[id]/participants/[participantId]/leave',
    isPublic: false,
    accessTo: { POST: [CREW_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/participants',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ, LOBBY_USER, CREW_USER], POST: [CREW_USER] },
  },
  {
    path: '/api/monitoring/calls/[id]/recording/start',
    isPublic: false,
    accessTo: { POST: [DIVISION_MONITOR] },
  },
  {
    path: '/api/monitoring/calls/[id]/recording/[recordingId]/media',
    isPublic: false,
    accessTo: { POST: [DIVISION_MONITOR] },
  },
  {
    path: '/api/monitoring/calls/[id]/recording/[recordingId]/stop',
    isPublic: false,
    accessTo: { POST: [DIVISION_MONITOR] },
  },
  {
    path: '/api/monitoring/calls/[id]/recordings',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ] },
  },
  {
    path: '/api/monitoring/calls/[id]',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ, LOBBY_USER, CREW_USER] },
  },
  {
    path: '/api/monitoring/recordings/[id]/file',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ] },
  },
  {
    path: '/api/monitoring/recordings/[id]',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ] },
  },
  {
    path: '/api/monitoring/recordings',
    isPublic: false,
    accessTo: { GET: [...DIVISION_READ] },
  },
] as const;
