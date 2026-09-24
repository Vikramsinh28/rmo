import { RmoError } from '@/lib/rmo/errors';
import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { beatLobbyPresence } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const presence = body?.presence === 'CONNECTING' ? 'CONNECTING' : 'ONLINE';
  return runMonitoring(request, actor => {
    if (actor.rmoRole !== 'LOBBY_USER') {
      throw new RmoError('Only the lobby user can update lobby presence.', 403);
    }
    return beatLobbyPresence(actor, presence);
  });
}
