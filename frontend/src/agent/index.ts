import type {
  AgentEvent,
  AgentToHost,
  Command,
  ConnectMessage,
  HelloMessage,
  HostToAgent,
  RequestKind,
  RequestMap,
} from "../protocol/messages";
import { PROTOCOL_VERSION } from "../protocol/messages";
import { isOwnNode } from "./dom";
import { GeometryWatcher } from "./geometry";
import { Identity } from "./identity";
import { Picker } from "./picker";
import { TreeService } from "./tree";

declare global {
  interface Window {
    __figrAgent?: true;
  }
}

const MAX_QUEUED_EVENTS = 50;

function boot() {
  if (window.__figrAgent || window.parent === window) return;
  window.__figrAgent = true;

  let port: MessagePort | null = null;
  const queue: AgentToHost[] = [];
  let debug: Extract<Command, { kind: "debug" }> = { kind: "debug" };

  const send = (msg: AgentToHost) => {
    if (port) port.postMessage(msg);
    else if (msg.t === "evt" && queue.length < MAX_QUEUED_EVENTS) queue.push(msg);
  };
  const emit = (evt: AgentEvent) => send({ t: "evt", evt });

  const identity = new Identity();
  const tree = new TreeService(identity);
  const watcher = new GeometryWatcher(identity, emit);
  const picker = new Picker(emit, (el) => tree.locate(el));
  picker.setMode("select");

  // One reconcile per mutation batch: rebind replaced nodes, then tell the host
  // which ids died and which observed child lists changed, in a single message
  // so the host never sees a list that references a dead id.
  new MutationObserver((records) => {
    const relevant = records.filter((r) => !isOwnMutation(r));
    if (relevant.length === 0) return;
    const gone = identity.reconcile(relevant);
    const lists = tree.diff();
    if (gone.length || lists.length) emit({ kind: "mutations", lists, gone });
    watcher.flush();
  }).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });

  window.addEventListener("error", (e) => emit({ kind: "pageError", message: e.message || String(e.error) }));
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    emit({ kind: "pageError", message: reason instanceof Error ? reason.message : String(reason) });
  });
  window.addEventListener("pagehide", () => emit({ kind: "bye" }));

  const handlers: { [K in RequestKind]: (req: RequestMap[K]["req"]) => RequestMap[K]["res"] } = {
    children: ({ parentId }) => ({ children: tree.children(parentId) }),
    reveal: ({ id }) => tree.reveal(id),
    relative: ({ id, to }) => tree.relative(id, to),
    search: ({ query, limit }) => tree.search(query, limit),
    ping: () => ({ url: location.href }),
    scrollIntoView: ({ id }) => {
      const el = identity.element(id);
      return { scrolled: el ? scrollIntoViewWithinPage(el) : false };
    },
  };

  const answer = (rid: number, kind: RequestKind, payload: unknown) => {
    try {
      if (debug.throwOnNextRequest) {
        debug = { ...debug, throwOnNextRequest: false };
        throw new Error("Agent failed to handle the request (dev fault)");
      }
      const value = (handlers[kind] as (p: unknown) => unknown)(payload);
      send({ t: "res", rid, ok: true, value });
    } catch (err) {
      send({ t: "res", rid, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const onPortMessage = (e: MessageEvent<HostToAgent>) => {
    const msg = e.data;
    if (msg.t === "cmd") {
      const cmd = msg.cmd;
      if (cmd.kind === "mode") picker.setMode(cmd.mode);
      else if (cmd.kind === "watch") watcher.watch(cmd.hover, cmd.selected);
      else if (cmd.kind === "release") tree.release(cmd.parentIds);
      else if (cmd.kind === "debug") debug = { ...debug, ...cmd };
      return;
    }
    if (msg.kind === "children" && debug.delayNextChildrenMs) {
      const delay = debug.delayNextChildrenMs;
      debug = { ...debug, delayNextChildrenMs: undefined };
      setTimeout(() => answer(msg.rid, msg.kind, msg.payload), delay);
      return;
    }
    answer(msg.rid, msg.kind, msg.payload);
  };

  window.addEventListener("message", (e: MessageEvent<ConnectMessage>) => {
    if (e.source !== window.parent || e.data?.type !== "figr:connect" || !e.ports[0]) return;
    if (e.data.protocol !== PROTOCOL_VERSION) return;
    port?.close();
    port = e.ports[0];
    port.onmessage = onPortMessage;
    tree.reset();
    picker.setMode(e.data.mode);
    for (const msg of queue.splice(0)) port.postMessage(msg);
  });

  const hello: HelloMessage = { type: "figr:hello", protocol: PROTOCOL_VERSION, url: location.href };
  window.parent.postMessage(hello, "*");
}

function isOwnMutation(r: MutationRecord): boolean {
  if (r.target instanceof Element && isOwnNode(r.target)) return true;
  if (r.type !== "childList") return false;
  const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
  return nodes.length > 0 && nodes.every((n) => n instanceof Element && isOwnNode(n));
}

/** Scrolls only this document's own scroll containers; never the embedding board. */
function scrollIntoViewWithinPage(el: Element): boolean {
  let scrolled = false;
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (p.scrollHeight <= p.clientHeight && p.scrollWidth <= p.clientWidth) continue;
    const s = getComputedStyle(p);
    if (!/(auto|scroll|overlay)/.test(s.overflowY + s.overflowX)) continue;
    const r = el.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const dy = r.top < pr.top ? r.top - pr.top : r.bottom > pr.bottom ? Math.min(r.bottom - pr.bottom, r.top - pr.top) : 0;
    const dx = r.left < pr.left ? r.left - pr.left : r.right > pr.right ? Math.min(r.right - pr.right, r.left - pr.left) : 0;
    if (dx || dy) {
      p.scrollBy({ left: dx, top: dy, behavior: "instant" as ScrollBehavior });
      scrolled = true;
    }
  }
  const r = el.getBoundingClientRect();
  const dy = r.top < 0 ? r.top : r.bottom > window.innerHeight ? Math.min(r.bottom - window.innerHeight, r.top) : 0;
  const dx = r.left < 0 ? r.left : r.right > window.innerWidth ? Math.min(r.right - window.innerWidth, r.left) : 0;
  if (dx || dy) {
    window.scrollBy({ left: dx, top: dy, behavior: "instant" as ScrollBehavior });
    scrolled = true;
  }
  return scrolled;
}

boot();
