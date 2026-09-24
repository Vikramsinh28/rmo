import { requireActor } from '@/lib/rmo/guard';
import { subscribeMonitoringEvents } from '@/lib/rmo/monitoring-events';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function visible(
  actor: { rmoRole: string; homeDivisionId: number | null; homeLobbyId: number | null },
  event: { divisionId: number; lobbyId: number },
) {
  if (actor.rmoRole === 'SYSTEM_ADMIN') return true;
  if (actor.rmoRole === 'DIVISION_ADMIN' || actor.rmoRole === 'DIVISION_MONITOR') {
    return actor.homeDivisionId === event.divisionId;
  }
  if (actor.rmoRole === 'LOBBY_USER' || actor.rmoRole === 'CREW_USER') {
    return actor.homeLobbyId === event.lobbyId;
  }
  return false;
}

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  const actor = auth.actor;
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
      };
      write(': connected\n\n');
      unsubscribe = subscribeMonitoringEvents(event => {
        if (!visible(actor, event)) return;
        write(`data: ${JSON.stringify(event)}\n\n`);
      });
      ping = setInterval(() => write(': ping\n\n'), 20000);
      request.signal.addEventListener('abort', () => {
        if (ping) clearInterval(ping);
        unsubscribe();
        controller.close();
      });
    },
    cancel() {
      if (ping) clearInterval(ping);
      unsubscribe();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
