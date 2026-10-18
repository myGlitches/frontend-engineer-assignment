import type { HelloMessage } from "../../protocol/messages";
import { PROTOCOL_VERSION } from "../../protocol/messages";
import { PAGES_ORIGIN } from "../config";
import type { PreviewConnection } from "./PreviewConnection";

/**
 * Routes handshakes to the right preview. Only hellos are accepted on window
 * messages, only from the pages origin, and only from a frame we registered;
 * anything else on the window is ignored.
 */
const byScreen = new Map<string, PreviewConnection>();

window.addEventListener("message", (e: MessageEvent<HelloMessage>) => {
  if (e.origin !== PAGES_ORIGIN) return;
  if (e.data?.type !== "figr:hello" || e.data.protocol !== PROTOCOL_VERSION) return;
  for (const conn of byScreen.values()) {
    if (conn.frameWindow === e.source) {
      conn.handleHello(e.data.url);
      return;
    }
  }
});

export function registerConnection(conn: PreviewConnection) {
  byScreen.get(conn.screenId)?.dispose();
  byScreen.set(conn.screenId, conn);
}

export function unregisterConnection(conn: PreviewConnection) {
  if (byScreen.get(conn.screenId) === conn) byScreen.delete(conn.screenId);
  conn.dispose();
}

export function connectionFor(screenId: string): PreviewConnection | undefined {
  return byScreen.get(screenId);
}

export function allConnections(): Iterable<PreviewConnection> {
  return byScreen.values();
}
