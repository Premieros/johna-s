import type { Page } from '@playwright/test';

/**
 * Keep browser E2E traffic fully isolated from Production Realtime.
 *
 * HTTP/Auth/PostgREST are already mocked in the E2E suites. Without a WebSocket
 * route, supabase-js still opens the real Production Realtime endpoint using the
 * synthetic E2E JWT, which creates noisy JwtSignerError logs and unnecessary
 * platform load. This local protocol stub acknowledges joins/heartbeats only;
 * it never connects to Supabase.
 */
export async function mockSupabaseRealtime(page: Page): Promise<void> {
  await page.routeWebSocket(/\/realtime\/v1\/websocket(?:\?|$)/, (ws) => {
    ws.onMessage((message) => {
      if (typeof message !== 'string') return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }

      if (Array.isArray(parsed)) {
        const [joinRef, ref, topic, event, payload] = parsed as [
          string | null,
          string | null,
          string,
          string,
          Record<string, unknown>,
        ];
        if (!['phx_join', 'heartbeat', 'phx_leave', 'access_token'].includes(event)) return;

        const config = (payload?.config || {}) as { postgres_changes?: Array<Record<string, unknown>> };
        const response = event === 'phx_join'
          ? { postgres_changes: (config.postgres_changes || []).map((row, index) => ({ ...row, id: index + 1 })) }
          : {};

        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]));
        return;
      }

      if (!parsed || typeof parsed !== 'object') return;
      const msg = parsed as {
        topic?: string;
        event?: string;
        payload?: { config?: { postgres_changes?: Array<Record<string, unknown>> } };
        ref?: string | null;
        join_ref?: string | null;
      };
      if (!msg.event || !['phx_join', 'heartbeat', 'phx_leave', 'access_token'].includes(msg.event)) return;

      const response = msg.event === 'phx_join'
        ? {
            postgres_changes: (msg.payload?.config?.postgres_changes || []).map((row, index) => ({
              ...row,
              id: index + 1,
            })),
          }
        : {};

      ws.send(JSON.stringify({
        topic: msg.topic || 'phoenix',
        event: 'phx_reply',
        payload: { status: 'ok', response },
        ref: msg.ref ?? null,
        join_ref: msg.join_ref ?? null,
      }));
    });
  });
}
