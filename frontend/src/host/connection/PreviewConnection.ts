import type {
  AgentEvent,
  AgentToHost,
  Command,
  ConnectMessage,
  HostToAgent,
  Mode,
  RequestKind,
  RequestMap,
} from "../../protocol/messages";
import { PROTOCOL_VERSION } from "../../protocol/messages";
import { PAGES_ORIGIN, REQUEST_TIMEOUT_MS } from "../config";
import { Cancelled, TimeoutError } from "../failures/errors";

export interface ConnectionListener {
  /** A new document said hello. `previous` is the session it replaced, if any. */
  session(sessionId: number, previous: number | null, url: string): void;
  event(evt: AgentEvent, sessionId: number): void;
  /** The current document went away (navigation, reload). A new hello may follow. */
  disconnected(sessionId: number): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  cleanup: () => void;
}

let sessionSeq = 0;

/**
 * One preview's link to its page. The window proxy of an iframe is stable
 * across navigations, so this object lives as long as the iframe element; each
 * document that loads inside it gets its own session id and MessagePort.
 * Requests are scoped to a session: when it ends they are rejected with
 * Cancelled, because the question no longer has an answer.
 */
export class PreviewConnection {
  private port: MessagePort | null = null;
  private session: number | null = null;
  private rid = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(
    readonly screenId: string,
    readonly frameWindow: Window,
    private readonly listener: ConnectionListener,
    private readonly currentMode: () => Mode,
  ) {}

  get sessionId(): number | null {
    return this.port ? this.session : null;
  }

  handleHello(url: string) {
    const previous = this.session;
    this.endSession();
    const sessionId = ++sessionSeq;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.session = sessionId;
    this.port.onmessage = (e: MessageEvent<AgentToHost>) => this.onMessage(e.data, sessionId);
    const connect: ConnectMessage = {
      type: "figr:connect",
      protocol: PROTOCOL_VERSION,
      sessionId,
      mode: this.currentMode(),
    };
    this.frameWindow.postMessage(connect, PAGES_ORIGIN, [channel.port2]);
    this.listener.session(sessionId, previous, url);
  }

  request<K extends RequestKind>(
    kind: K,
    payload: RequestMap[K]["req"],
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<RequestMap[K]["res"]> {
    const port = this.port;
    if (!port) return Promise.reject(new Cancelled("preview is not connected"));
    if (opts.signal?.aborted) return Promise.reject(new Cancelled());
    const rid = ++this.rid;
    const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.settle(rid)?.reject(new TimeoutError(`The page (${kind})`, timeoutMs));
      }, timeoutMs);
      const onAbort = () => this.settle(rid)?.reject(new Cancelled());
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(rid, {
        resolve: resolve as (v: unknown) => void,
        reject,
        cleanup: () => {
          window.clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
        },
      });
      const msg: HostToAgent = { t: "req", rid, kind, payload };
      port.postMessage(msg);
    });
  }

  command(cmd: Command) {
    const msg: HostToAgent = { t: "cmd", cmd };
    this.port?.postMessage(msg);
  }

  dispose() {
    this.endSession();
  }

  private onMessage(msg: AgentToHost, sessionId: number) {
    if (sessionId !== this.session) return;
    if (msg.t === "res") {
      const p = this.settle(msg.rid);
      if (!p) return;
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error));
      return;
    }
    if (msg.evt.kind === "bye") {
      this.endSession();
      this.listener.disconnected(sessionId);
      return;
    }
    this.listener.event(msg.evt, sessionId);
  }

  private settle(rid: number): Pending | undefined {
    const p = this.pending.get(rid);
    if (!p) return undefined;
    this.pending.delete(rid);
    p.cleanup();
    return p;
  }

  private endSession() {
    this.port?.close();
    this.port = null;
    for (const rid of [...this.pending.keys()]) this.settle(rid)?.reject(new Cancelled("session ended"));
  }
}
