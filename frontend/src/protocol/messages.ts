// Host <-> agent contract. Both sides import this file; nothing else is shared.
//
// Handshake runs over window.postMessage (the only channel available between
// origins). Everything after it runs over a dedicated MessagePort, so a page
// navigation or reload naturally closes the session: the old port dies with
// the old document and the new document has to say hello again.

export const PROTOCOL_VERSION = 1;

export type NodeId = string;
export type Mode = "select" | "interact";

export interface NodeInfo {
  id: NodeId;
  name: string;
  hasChildren: boolean;
}

/** A node plus the ids of its ancestors, top-level first, body excluded. */
export interface Located {
  node: NodeInfo;
  ancestors: NodeId[];
}

/** A search hit with the full chain of ancestors, so the host can show rows it never loaded. */
export interface SearchHit {
  node: NodeInfo;
  path: NodeInfo[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LiveProps {
  name: string;
  tag: string;
  domId: string;
  classes: string;
  width: number;
  height: number;
  pageX: number;
  pageY: number;
  text: string;
  color: string;
  background: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  dataKey: string | null;
}

export interface ElementSnapshot {
  id: NodeId;
  /** Border box in the page's viewport coordinates. */
  rect: Rect;
  /** Part of the viewport not clipped by scrolling ancestors; null when fully hidden. */
  visible: Rect | null;
  props?: LiveProps;
}

export interface ChildList {
  parentId: NodeId | null;
  children: NodeInfo[];
}

// ---- window.postMessage handshake ----

export interface HelloMessage {
  type: "figr:hello";
  protocol: number;
  url: string;
}

export interface ConnectMessage {
  type: "figr:connect";
  protocol: number;
  sessionId: number;
  mode: Mode;
}

// ---- requests (host -> agent, answered) ----

export interface RequestMap {
  children: { req: { parentId: NodeId | null }; res: { children: NodeInfo[] } };
  reveal: { req: { id: NodeId }; res: { ancestors: NodeId[]; lists: ChildList[] } | null };
  relative: {
    req: { id: NodeId; to: "firstChild" | "parent" | "next" | "prev" };
    res: Located | null;
  };
  search: { req: { query: string; limit: number }; res: { hits: SearchHit[]; truncated: boolean } };
  scrollIntoView: { req: { id: NodeId }; res: { scrolled: boolean } };
  ping: { req: Record<string, never>; res: { url: string } };
}

export type RequestKind = keyof RequestMap;

// ---- commands (host -> agent, fire and forget) ----

export type Command =
  | { kind: "mode"; mode: Mode }
  | { kind: "watch"; hover: NodeId | null; selected: NodeId[] }
  | { kind: "release"; parentIds: (NodeId | null)[] }
  | { kind: "debug"; delayNextChildrenMs?: number; throwOnNextRequest?: boolean };

// ---- events (agent -> host) ----

export type AgentEvent =
  | { kind: "hover"; target: Located | null }
  | { kind: "press"; target: Located | null; shift: boolean }
  | { kind: "key"; key: string; shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }
  | { kind: "zoom"; deltaY: number; x: number; y: number }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "geometry"; elements: ElementSnapshot[] }
  | { kind: "mutations"; lists: ChildList[]; gone: NodeId[] }
  | { kind: "pageError"; message: string }
  | { kind: "bye" };

// ---- port envelopes ----

export type HostToAgent =
  | { t: "req"; rid: number; kind: RequestKind; payload: unknown }
  | { t: "cmd"; cmd: Command };

export type AgentToHost =
  | { t: "res"; rid: number; ok: true; value: unknown }
  | { t: "res"; rid: number; ok: false; error: string }
  | { t: "evt"; evt: AgentEvent };

export const HOST_SHORTCUT_KEYS = new Set(["v", "i", "Escape", "Enter", "Tab"]);
