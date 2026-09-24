export const siteConfig = {
  name: 'RMO Remote Monitoring',
  url: 'https://railwaymonitor.in',
  description: 'Railway monitoring operations console',
  baseLinks: {
    login: '/login',
    overview: '/overview',
    zones: '/zones',
    divisions: '/divisions',
    lobbies: '/lobbies',
    users: '/users',
    roles: '/roles',
    audit: '/audit',
    crew: '/crew',
    monitoring: '/monitoring',
    forms: '/forms',
    devices: '/devices',
    safetyEvents: '/safety-events',
    settings: '/settings',
  },
};

export type SiteConfigType = typeof siteConfig;
