const DEFAULT_TURN_URLS = [
  'turn:turn.railwaymonitor.in:3478?transport=udp',
  'turn:turn.railwaymonitor.in:3478?transport=tcp',
  'turn:turn.railwaymonitor.in:3478',
];

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Same STUN and DigitalOcean TURN list the railway monitoring apps use. */
export function monitoringIceServers(): IceServer[] {
  const configured = (process.env.TURN_URLS || '').split(',').map(item => item.trim()).filter(Boolean);
  const urls = configured.length > 0 ? configured : DEFAULT_TURN_URLS;
  return [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },
    {
      urls,
      username: process.env.TURN_USERNAME || 'turnuser',
      credential: process.env.TURN_PASSWORD || 'turnpassword',
    },
  ];
}
