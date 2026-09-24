import type { WSBroadcastType, WSUnicastType } from "@beatsync/shared";
import type { ServerWebSocket } from "bun";
import { mock } from "bun:test";
import type { BunServer, WSData } from "@/utils/websocket";

/**
 * Shared mock helper for @/utils/responses. Default implementations:
 * - sendUnicast/sendToClient: Call ws.send(JSON.stringify(message)) + optional custom handler
 * - sendBroadcast: Call server.publish(roomId, JSON.stringify(message)) + optional custom handler
 * - corsHeaders, jsonResponse, errorResponse: Pass-through
 *
 * Each test that needs custom behavior can pass handler functions that will be called
 * AFTER the actual send/publish. This ensures tests can record messages while the real
 * communication happens (critical for tests like liveness.test.ts that depend on ws.send).
 *
 * Usage:
 * ```ts
 * const recorded: WSBroadcastType[] = [];
 * mockResponses({
 *   sendBroadcast: ({ server, roomId, message }) => {
 *     recorded.push(message);
 *   }
 * });
 * ```
 */
export function mockResponses(
  handlers: {
    sendBroadcast?: (opts: { server: BunServer; roomId: string; message: WSBroadcastType }) => void;
    sendUnicast?: (opts: { ws: ServerWebSocket<WSData>; message: WSUnicastType }) => void;
    sendToClient?: (opts: { ws: ServerWebSocket<WSData>; message: WSBroadcastType }) => void;
  } = {}
): void {
  // Mock module setup that calls real send/publish FIRST, then custom handlers
  void mock.module("@/utils/responses", () => ({
    sendBroadcast: mock(
      ({ server, roomId, message }: { server: BunServer; roomId: string; message: WSBroadcastType }) => {
        // CRITICAL: Forward to actual server.publish so messages propagate correctly
        server.publish(roomId, JSON.stringify(message));
        // Then call custom handler if provided
        handlers.sendBroadcast?.({ server, roomId, message });
      }
    ),
    sendUnicast: mock(({ ws, message }: { ws: ServerWebSocket<WSData>; message: WSUnicastType }) => {
      // CRITICAL: Forward to actual ws.send so liveness tests can count pings
      ws.send(JSON.stringify(message));
      // Then call custom handler if provided
      handlers.sendUnicast?.({ ws, message });
    }),
    sendToClient: mock(({ ws, message }: { ws: ServerWebSocket<WSData>; message: WSBroadcastType }) => {
      // CRITICAL: Forward to actual ws.send
      ws.send(JSON.stringify(message));
      // Then call custom handler if provided
      handlers.sendToClient?.({ ws, message });
    }),
    corsHeaders: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    },
    jsonResponse: mock((data: unknown, status = 200) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      return new Response(JSON.stringify(data), { status });
    }),
    errorResponse: mock((message: string, status = 400) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      return new Response(message, { status });
    }),
  }));
}
