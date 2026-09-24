import { createHmac } from 'crypto';

/**
 * Kostra has no existing signaling server, WebRTC helper, or media server.
 * LiveKit is the local SFU: one room per persistent LobbyRoom, many
 * participants, and client reconnect against the same room name.
 * A browser is never used as the media relay.
 */
export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export function liveKitConfig(): LiveKitConfig | null {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

export async function mintLiveKitToken(input: {
  identity: string;
  name: string;
  roomKey: string;
}) {
  const config = liveKitConfig();
  if (!config) return null;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: config.apiKey,
    sub: input.identity,
    name: input.name,
    iat: now,
    nbf: now,
    exp: now + 6 * 60 * 60,
    video: {
      roomJoin: true,
      room: input.roomKey,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  })).toString('base64url');
  const signature = createHmac('sha256', config.apiSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return { url: config.url, token: `${header}.${payload}.${signature}`, roomKey: input.roomKey };
}
