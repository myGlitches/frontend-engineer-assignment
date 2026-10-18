import type { AgentEvent, ChildList, ElementSnapshot, Located, Mode, NodeId } from "../protocol/messages";
import { report } from "../../report.js";
import { fitViewport, previewOrigin, wheelZoomFactor, zoomAround } from "./board/layout";
import { CHILDREN_TIMEOUT_MS, CONNECT_TIMEOUT_MS, SEARCH_LIMIT } from "./config";
import { PreviewConnection } from "./connection/PreviewConnection";
import { allConnections, connectionFor, registerConnection, unregisterConnection } from "./connection/hub";
import { throwIfArmed } from "./dev/faults";
import { clearFailure, clearFailuresWhere, RegionScope, type RegionRef } from "./failures/regions";
import {
  applyChildLists,
  clearSelection,
  emptyLayers,
  parentKey,
  patchLayers,
  removeNodes,
  ROOT,
  setHover,
  setSelection,
  useApp,
  type Hover,
  type ParentKey,
} from "./state/store";

/**
 * The single writer of app state. Components and agent events call in here;
 * nothing else mutates the store. Side effects that cross the frame boundary
 * (requests, watch/mode commands) are issued from here too, so there is one
 * place to read to know what the host tells a page and why.
 */

const get = useApp.getState;
const set = useApp.setState;

// ---------------------------------------------------------------------------
// Scopes that outlive any one component.

const previewScopes = new Map<string, RegionScope>();
const rowScopes = new Map<string, RegionScope>();
let boardScope: RegionScope | null = null;
let pointerScreen: string | null = null;

export function bindBoardScope(scope: RegionScope | null) {
  boardScope = scope;
}

const rowKey = (screenId: string, key: ParentKey) => `${screenId}|${key}`;

function disposeRowScopes(screenId: string, only?: Set<NodeId>) {
  for (const [key, scope] of rowScopes) {
    const [sid, pk] = key.split("|");
    if (sid !== screenId || (only && !only.has(pk))) continue;
    scope.dispose();
    rowScopes.delete(key);
  }
  clearFailuresWhere(
    (ref) => ref.kind === "layers-row" && ref.screenId === screenId && (!only || only.has(ref.rowId ?? "")),
  );
}

/** Runs work that belongs to a preview (keyboard on its selection, events from it) inside its region. */
function inPreview(screenId: string, fn: () => void) {
  const scope = previewScopes.get(screenId);
  if (scope) scope.run(fn);
  else inBoard(fn);
}

function inBoard(fn: () => void) {
  if (boardScope) boardScope.run(fn);
  else fn();
}

// ---------------------------------------------------------------------------
// Preview lifecycle.

export function attachPreview(screenId: string, frame: Window, scope: RegionScope): () => void {
  previewScopes.set(screenId, scope);
  let cancelConnectTimer = () => {};
  const startConnectTimer = () => {
    cancelConnectTimer();
    cancelConnectTimer = scope.setTimeout(() => {
      throw new Error(`The page did not respond within ${CONNECT_TIMEOUT_MS / 1000}s`);
    }, CONNECT_TIMEOUT_MS);
  };

  const conn = new PreviewConnection(
    screenId,
    frame,
    {
      session: scope.wrap((sessionId: number, previous: number | null, url: string) => {
        cancelConnectTimer();
        resetPreviewState(screenId, previous !== null);
        set({
          previews: { ...get().previews, [screenId]: { sessionId, url, pageErrors: [] } },
          layers: { ...get().layers, [screenId]: emptyLayers(sessionId) },
        });
        lastWatch.delete(screenId);
        connectionFor(screenId)?.command({ kind: "mode", mode: get().mode });
        syncWatch();
      }),
      event: scope.wrap((evt: AgentEvent) => {
        throwIfArmed("preview-message");
        onAgentEvent(screenId, evt);
      }),
      disconnected: scope.wrap(() => {
        const p = get().previews[screenId];
        if (p) set({ previews: { ...get().previews, [screenId]: { ...p, sessionId: null } } });
        if (get().hover?.screenId === screenId) setHover(null);
        startConnectTimer();
      }),
    },
    () => get().mode,
  );
  registerConnection(conn);
  startConnectTimer();

  return () => {
    cancelConnectTimer();
    unregisterConnection(conn);
    if (previewScopes.get(screenId) === scope) previewScopes.delete(screenId);
    resetPreviewState(screenId, true);
    const previews = { ...get().previews };
    delete previews[screenId];
    const layers = { ...get().layers };
    delete layers[screenId];
    set({ previews, layers });
    lastWatch.delete(screenId);
  };
}

/** Forget everything tied to the document that was in this preview. */
function resetPreviewState(screenId: string, documentChanged: boolean) {
  disposeRowScopes(screenId);
  revealControllers.get(screenId)?.abort();
  searchControllers.get(screenId)?.abort();
  clearFailure({ kind: "layers", screenId });
  const s = get();
  if (s.hover?.screenId === screenId) setHover(null);
  if (documentChanged && s.selection.screenId === screenId) clearSelection();
  const geometry = { ...s.geometry };
  delete geometry[screenId];
  set({ geometry });
}

/**
 * The iframe finished loading a document. If that document has an agent, its
 * hello has normally arrived already and the ping is answered at once. If the
 * old document left without saying bye, or the new one has no agent, the port
 * is dead and the ping times out: that is the "doesn't respond" failure.
 * A hello arriving meanwhile ends the session, which cancels the ping quietly.
 */
export function previewLoaded(screenId: string) {
  const conn = connectionFor(screenId);
  const scope = previewScopes.get(screenId);
  if (!conn || !scope || conn.sessionId === null) return;
  scope.settle(conn.request("ping", {}, { timeoutMs: CONNECT_TIMEOUT_MS, signal: scope.signal }), () => {});
}

// ---------------------------------------------------------------------------
// Agent events.

function onAgentEvent(screenId: string, evt: AgentEvent) {
  switch (evt.kind) {
    case "hover":
      return onPreviewHover(screenId, evt.target);
    case "press":
      return onPreviewPress(screenId, evt.target, evt.shift);
    case "key":
      return handleShortcut({ key: evt.key, shiftKey: evt.shift, ctrlKey: evt.ctrl, metaKey: evt.meta, altKey: evt.alt });
    case "zoom":
      return zoomFromPreview(screenId, evt.deltaY, evt.x, evt.y);
    case "pan":
      return panBy(evt.dx, evt.dy);
    case "geometry":
      return applyGeometry(screenId, evt.elements);
    case "mutations":
      return applyMutations(screenId, evt.lists, evt.gone);
    case "pageError":
      return onPageError(screenId, evt.message);
    case "bye":
      return;
  }
}

function onPreviewHover(screenId: string, target: Located | null) {
  const s = get();
  if (s.mode !== "select") return;
  if (!target) {
    if (s.hover?.screenId === screenId && s.hover.source === "preview") setHover(null);
    return;
  }
  if (pointerScreen !== screenId) return;
  setHover({ screenId, id: target.node.id, name: target.node.name, ancestors: target.ancestors, source: "preview" });
}

function onPreviewPress(screenId: string, target: Located | null, shift: boolean) {
  set({ activeScreenId: screenId });
  if (!target) {
    clearSelection();
    return;
  }
  selectElement(screenId, target, shift);
}

function applyGeometry(screenId: string, elements: ElementSnapshot[]) {
  const current = get().geometry[screenId] ?? {};
  const next = { ...current };
  for (const e of elements) next[e.id] = e;
  set({ geometry: { ...get().geometry, [screenId]: next } });
}

function applyMutations(screenId: string, lists: ChildList[], goneIds: NodeId[]) {
  const gone = new Set(goneIds);
  patchLayers(screenId, (l) => removeNodes(applyChildLists(l, lists), gone));
  if (gone.size === 0) {
    if (get().layers[screenId]?.search.query) scheduleSearch(screenId);
    return;
  }
  disposeRowScopes(screenId, gone);
  const s = get();
  if (s.hover?.screenId === screenId && gone.has(s.hover.id)) setHover(null);
  if (s.selection.screenId === screenId && s.selection.ids.some((id) => gone.has(id))) {
    const ids = s.selection.ids.filter((id) => !gone.has(id));
    if (ids.length) setSelection({ screenId, ids });
    else setSelection({ screenId: null, ids: [] }, true);
  }
  const geo = s.geometry[screenId];
  if (geo) {
    const next = { ...geo };
    for (const id of gone) delete next[id];
    set({ geometry: { ...get().geometry, [screenId]: next } });
  }
  if (get().layers[screenId]?.search.query) scheduleSearch(screenId);
}

function onPageError(screenId: string, message: string) {
  const p = get().previews[screenId];
  if (!p) return;
  set({ previews: { ...get().previews, [screenId]: { ...p, pageErrors: [...p.pageErrors, message] } } });
  report(new Error(message), { region: "preview", screenId });
}

// ---------------------------------------------------------------------------
// Watch: what each page streams geometry for.

const lastWatch = new Map<string, string>();

function syncWatch() {
  const s = get();
  for (const conn of allConnections()) {
    const hover = s.mode === "select" && s.hover?.screenId === conn.screenId ? s.hover.id : null;
    const selected = s.selection.screenId === conn.screenId ? s.selection.ids : [];
    const sig = `${conn.sessionId}|${hover}|${selected.join(",")}`;
    if (lastWatch.get(conn.screenId) === sig || conn.sessionId === null) continue;
    lastWatch.set(conn.screenId, sig);
    conn.command({ kind: "watch", hover, selected });
  }
}

useApp.subscribe((s, prev) => {
  if (s.mode !== prev.mode) {
    for (const conn of allConnections()) conn.command({ kind: "mode", mode: s.mode });
  }
  if (s.hover !== prev.hover || s.selection !== prev.selection || s.mode !== prev.mode) syncWatch();
});

// ---------------------------------------------------------------------------
// Pointer and viewport.

export function pointerEnteredPreview(screenId: string | null) {
  pointerScreen = screenId;
  const hover = get().hover;
  if (hover && hover.source === "preview" && hover.screenId !== screenId) setHover(null);
}

export function pointerLeftWindow() {
  pointerScreen = null;
  setHover(null);
}

export function setMode(mode: Mode) {
  if (get().mode === mode) return;
  set({ mode, hover: null });
}

export function panBy(dx: number, dy: number) {
  const v = get().viewport;
  set({ viewport: { ...v, x: v.x - dx, y: v.y - dy }, hover: null });
}

let fitted = false;

export function setBoardSize(width: number, height: number) {
  set({ boardSize: { width, height } });
  if (!fitted && get().screens) fitBoard();
}

/** Called when screens arrive; fits once the board has been measured. */
export function screensLoaded() {
  fitted = false;
  if (get().boardSize.width) fitBoard();
}

export function fitBoard() {
  const count = get().screens?.length ?? 0;
  const { width, height } = get().boardSize;
  if (!count || !width) return;
  fitted = true;
  set({ viewport: fitViewport(count, width, height), hover: null });
}

/** Zoom by a step around the centre of the board, for the zoom buttons. */
export function zoomStep(direction: 1 | -1) {
  const boardSize = get().boardSize;
  set({
    viewport: zoomAround(get().viewport, boardSize.width / 2, boardSize.height / 2, direction > 0 ? 1.25 : 0.8),
    hover: null,
  });
}

/** Move the board so the given world point sits in the middle of the view. */
export function centerOn(worldX: number, worldY: number) {
  const { viewport: v, boardSize } = get();
  set({
    viewport: { ...v, x: boardSize.width / 2 - worldX * v.zoom, y: boardSize.height / 2 - worldY * v.zoom },
    hover: null,
  });
}

export function zoomAtBoardPoint(bx: number, by: number, deltaY: number) {
  set({ viewport: zoomAround(get().viewport, bx, by, wheelZoomFactor(deltaY)), hover: null });
}

function zoomFromPreview(screenId: string, deltaY: number, x: number, y: number) {
  const s = get();
  const index = s.screens?.findIndex((sc) => sc.id === screenId) ?? -1;
  if (index < 0) return;
  const origin = previewOrigin(index);
  const v = s.viewport;
  zoomAtBoardPoint(v.x + (origin.x + x) * v.zoom, v.y + (origin.y + y) * v.zoom, deltaY);
}

// ---------------------------------------------------------------------------
// Selection.

export function selectElement(screenId: string, target: Located, toggle: boolean) {
  const s = get();
  const id = target.node.id;
  if (toggle && s.selection.screenId === screenId) {
    const ids = s.selection.ids.includes(id) ? s.selection.ids.filter((x) => x !== id) : [...s.selection.ids, id];
    setSelection({ screenId: ids.length ? screenId : null, ids });
    if (!ids.includes(id)) return;
  } else {
    setSelection({ screenId, ids: [id] });
  }
  revealInLayers(screenId, target);
}

type ShortcutEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">;

/** Board-level shortcuts. Returns true when the key was handled. */
export function handleShortcut(e: ShortcutEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const s = get();
  if (key === "v" || key === "i") {
    inBoard(() => {
      throwIfArmed("key-handler");
      setMode(key === "v" ? "select" : "interact");
    });
    return true;
  }
  if (s.mode !== "select") return false;
  if (key === "Escape") {
    clearSelection();
    return true;
  }
  const screenId = s.selection.screenId;
  const last = s.selection.ids[s.selection.ids.length - 1];
  if (!screenId || !last) return false;
  if (key === "Enter") {
    selectRelative(screenId, last, e.shiftKey ? "parent" : "firstChild");
    return true;
  }
  if (key === "Tab") {
    selectRelative(screenId, last, e.shiftKey ? "prev" : "next");
    return true;
  }
  return false;
}

function selectRelative(screenId: string, from: NodeId, to: "firstChild" | "parent" | "next" | "prev") {
  inPreview(screenId, () => {
    throwIfArmed("key-handler");
    const conn = connectionFor(screenId);
    const scope = previewScopes.get(screenId);
    if (!conn || !scope) return;
    const before = get().selection;
    scope.settle(conn.request("relative", { id: from, to }, { signal: scope.signal }), (target) => {
      if (!target || get().selection !== before) return;
      setSelection({ screenId, ids: [target.node.id] });
      revealInLayers(screenId, target);
    });
  });
}

// ---------------------------------------------------------------------------
// Layers.

export function hoverRow(screenId: string, id: NodeId | null) {
  if (!id) {
    const h = get().hover;
    if (h?.source === "layers") setHover(null);
    return;
  }
  const l = get().layers[screenId];
  const node = l?.nodes[id] ?? l?.search.hits.find((h) => h.node.id === id)?.node;
  if (!node) return;
  const hover: Hover = { screenId, id, name: node.name, ancestors: ancestorsFromCache(screenId, id), source: "layers" };
  setHover(hover);
}

function ancestorsFromCache(screenId: string, id: NodeId): NodeId[] {
  const l = get().layers[screenId];
  const chain: NodeId[] = [];
  for (let p = l?.parent[id]; p && p !== ROOT; p = l?.parent[p]) chain.unshift(p);
  return chain;
}

export function clickRow(screenId: string, id: NodeId, toggle: boolean) {
  const l = get().layers[screenId];
  const node = l?.nodes[id] ?? l?.search.hits.find((h) => h.node.id === id)?.node;
  if (!node) return;
  selectElement(screenId, { node, ancestors: ancestorsFromCache(screenId, id) }, toggle);
  const conn = connectionFor(screenId);
  const scope = previewScopes.get(screenId);
  if (conn && scope) scope.settle(conn.request("scrollIntoView", { id }, { signal: scope.signal }), () => {});
}

export function ensureRootLoaded(screenId: string) {
  const l = get().layers[screenId];
  if (l && !l.children[ROOT] && !l.loading[ROOT]) loadChildren(screenId, null);
}

export function setExpanded(screenId: string, id: NodeId, expanded: boolean) {
  patchLayers(screenId, (l) => {
    const next = { ...l.expanded };
    if (expanded) next[id] = true;
    else delete next[id];
    return { ...l, expanded: next };
  });
  const l = get().layers[screenId];
  if (expanded && l && !l.children[id] && !l.loading[id] && !rowScopes.has(rowKey(screenId, id))) {
    loadChildren(screenId, id);
  }
}

/**
 * Children for one row. At most one request per row is ever in flight;
 * collapsing does not cancel it and re-expanding does not start another, and
 * the response replaces the row's child list rather than appending, so the
 * result cannot contain duplicates or miss children.
 */
export function loadChildren(screenId: string, parentId: NodeId | null) {
  const key = parentKey(parentId);
  const ref: RegionRef = parentId === null ? { kind: "layers", screenId } : { kind: "layers-row", screenId, rowId: parentId };
  const conn = connectionFor(screenId);
  if (!conn || conn.sessionId === null) return;
  rowScopes.get(rowKey(screenId, key))?.dispose();
  clearFailure(ref);
  const scope = new RegionScope(ref);
  rowScopes.set(rowKey(screenId, key), scope);
  patchLayers(screenId, (l) => ({ ...l, loading: { ...l.loading, [key]: true } }));

  const done = () => {
    if (rowScopes.get(rowKey(screenId, key)) === scope) rowScopes.delete(rowKey(screenId, key));
    patchLayers(screenId, (l) => {
      const loading = { ...l.loading };
      delete loading[key];
      return { ...l, loading };
    });
  };
  conn
    .request("children", { parentId }, { timeoutMs: CHILDREN_TIMEOUT_MS, signal: scope.signal })
    .then(
      (res) =>
        scope.run(() => {
          done();
          patchLayers(screenId, (l) => applyChildLists(l, [{ parentId, children: res.children }]));
        }),
      (err) => {
        if (!scope.alive) return;
        done();
        scope.fail(err);
      },
    );
}

export function retryRow(screenId: string, id: NodeId | null) {
  loadChildren(screenId, id);
}

const revealControllers = new Map<string, AbortController>();

/** Make a selected element's row visible: load and expand every ancestor, then scroll to it. */
function revealInLayers(screenId: string, target: Located) {
  const l = get().layers[screenId];
  if (!l) return;
  const id = target.node.id;
  const scrollTo = () =>
    patchLayers(screenId, (x) => ({ ...x, scrollTarget: { id, seq: (x.scrollTarget?.seq ?? 0) + 1 } }));
  if (l.search.query) {
    scrollTo();
    return;
  }
  const chain = target.ancestors;
  const allLoaded = !!l.children[ROOT] && chain.every((a) => l.children[a]);
  if (allLoaded) {
    expandAll(screenId, chain);
    scrollTo();
    return;
  }
  revealControllers.get(screenId)?.abort();
  const ctl = new AbortController();
  revealControllers.set(screenId, ctl);
  const conn = connectionFor(screenId);
  if (!conn) return;
  const layersScope = new RegionScope({ kind: "layers", screenId });
  conn.request("reveal", { id }, { signal: ctl.signal }).then(
    (res) =>
      layersScope.run(() => {
        if (ctl.signal.aborted || !res || get().layers[screenId]?.sessionId !== l.sessionId) return;
        patchLayers(screenId, (x) => applyChildLists(x, res.lists));
        expandAll(screenId, res.ancestors);
        scrollTo();
      }),
    (err) => layersScope.fail(err),
  );
}

function expandAll(screenId: string, ids: NodeId[]) {
  if (ids.length === 0) return;
  patchLayers(screenId, (l) => {
    const expanded = { ...l.expanded };
    for (const a of ids) expanded[a] = true;
    return { ...l, expanded };
  });
}

export function rememberScroll(screenId: string, scrollTop: number) {
  const l = get().layers[screenId];
  if (l && l.scrollTop !== scrollTop) {
    set({ layers: { ...get().layers, [screenId]: { ...l, scrollTop } } });
  }
}

// ---- search ----

const searchTimers = new Map<string, number>();
const searchControllers = new Map<string, AbortController>();

export function setSearchQuery(screenId: string, query: string) {
  patchLayers(screenId, (l) => ({
    ...l,
    search: query ? { ...l.search, query, status: "loading" } : { query: "", status: "idle", hits: [], truncated: false },
  }));
  if (!query) {
    searchControllers.get(screenId)?.abort();
    window.clearTimeout(searchTimers.get(screenId));
    return;
  }
  scheduleSearch(screenId);
}

function scheduleSearch(screenId: string) {
  window.clearTimeout(searchTimers.get(screenId));
  searchTimers.set(
    screenId,
    window.setTimeout(() => runSearch(screenId), 120),
  );
}

function runSearch(screenId: string) {
  const l = get().layers[screenId];
  const conn = connectionFor(screenId);
  if (!l || !conn || !l.search.query) return;
  searchControllers.get(screenId)?.abort();
  const ctl = new AbortController();
  searchControllers.set(screenId, ctl);
  const query = l.search.query;
  const scope = new RegionScope({ kind: "layers", screenId });
  conn.request("search", { query, limit: SEARCH_LIMIT }, { signal: ctl.signal }).then(
    (res) =>
      scope.run(() => {
        if (get().layers[screenId]?.search.query !== query) return;
        patchLayers(screenId, (x) => ({ ...x, search: { query, status: "ready", hits: res.hits, truncated: res.truncated } }));
      }),
    (err) => scope.fail(err),
  );
}
