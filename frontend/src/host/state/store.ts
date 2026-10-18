import { create } from "zustand";
import type { ChildList, ElementSnapshot, Mode, NodeId, NodeInfo, SearchHit } from "../../protocol/messages";
import type { Screen } from "../api/client";

export const ROOT = "#root";
export type ParentKey = NodeId | typeof ROOT;
export const parentKey = (id: NodeId | null): ParentKey => id ?? ROOT;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Hover {
  screenId: string;
  id: NodeId;
  name: string;
  ancestors: NodeId[];
  source: "preview" | "layers";
}

export interface Selection {
  screenId: string | null;
  /** In selection order; the last one is the "most recently selected". */
  ids: NodeId[];
}

export interface PreviewStatus {
  sessionId: number | null;
  url: string | null;
  pageErrors: string[];
}

export interface SearchState {
  query: string;
  status: "idle" | "loading" | "ready";
  hits: SearchHit[];
  truncated: boolean;
}

export interface LayersState {
  sessionId: number;
  nodes: Record<NodeId, NodeInfo>;
  parent: Record<NodeId, ParentKey>;
  children: Partial<Record<ParentKey, NodeId[]>>;
  loading: Partial<Record<ParentKey, true>>;
  expanded: Record<NodeId, true>;
  scrollTop: number;
  scrollTarget: { id: NodeId; seq: number } | null;
  search: SearchState;
}

export interface AppState {
  screens: Screen[] | null;
  viewport: Viewport;
  boardSize: { width: number; height: number };
  mode: Mode;
  hover: Hover | null;
  selection: Selection;
  /** Set when the selection emptied because its elements disappeared from the page. */
  selectionLost: boolean;
  activeScreenId: string | null;
  previews: Record<string, PreviewStatus>;
  geometry: Record<string, Record<NodeId, ElementSnapshot>>;
  layers: Record<string, LayersState>;
}

const EMPTY_SELECTION: Selection = { screenId: null, ids: [] };
const IDLE_SEARCH: SearchState = { query: "", status: "idle", hits: [], truncated: false };

export const useApp = create<AppState>(() => ({
  screens: null,
  viewport: { x: 48, y: 72, zoom: 0.3 },
  boardSize: { width: 0, height: 0 },
  mode: "select",
  hover: null,
  selection: EMPTY_SELECTION,
  selectionLost: false,
  activeScreenId: null,
  previews: {},
  geometry: {},
  layers: {},
}));

export function emptyLayers(sessionId: number): LayersState {
  return {
    sessionId,
    nodes: {},
    parent: {},
    children: {},
    loading: {},
    expanded: {},
    scrollTop: 0,
    scrollTarget: null,
    search: IDLE_SEARCH,
  };
}

// ---- pure transitions. The controller is the only caller. ----

const set = useApp.setState;
const get = useApp.getState;

export function patchLayers(screenId: string, fn: (l: LayersState) => LayersState) {
  const current = get().layers[screenId];
  if (!current) return;
  set({ layers: { ...get().layers, [screenId]: fn(current) } });
}

export function applyChildLists(l: LayersState, lists: ChildList[]): LayersState {
  if (lists.length === 0) return l;
  const nodes = { ...l.nodes };
  const parent = { ...l.parent };
  const children = { ...l.children };
  const loading = { ...l.loading };
  for (const list of lists) {
    const key = parentKey(list.parentId);
    children[key] = list.children.map((c) => c.id);
    delete loading[key];
    for (const c of list.children) {
      nodes[c.id] = c;
      parent[c.id] = key;
    }
  }
  return { ...l, nodes, parent, children, loading };
}

export function removeNodes(l: LayersState, gone: Set<NodeId>): LayersState {
  if (gone.size === 0) return l;
  const nodes = { ...l.nodes };
  const parent = { ...l.parent };
  const children = { ...l.children };
  const loading = { ...l.loading };
  const expanded = { ...l.expanded };
  for (const id of gone) {
    delete nodes[id];
    delete parent[id];
    delete children[id];
    delete loading[id];
    delete expanded[id];
  }
  for (const key of Object.keys(children) as ParentKey[]) {
    const list = children[key];
    if (list?.some((id) => gone.has(id))) children[key] = list.filter((id) => !gone.has(id));
  }
  const search = l.search.hits.some((h) => gone.has(h.node.id))
    ? { ...l.search, hits: l.search.hits.filter((h) => !gone.has(h.node.id)) }
    : l.search;
  return { ...l, nodes, parent, children, loading, expanded, search };
}

export function setSelection(selection: Selection, lost = false) {
  set({ selection, selectionLost: lost });
}

/** "This element no longer exists" stays until the next selection, so clearing an already empty selection keeps it. */
export function clearSelection() {
  const empty = get().selection.ids.length === 0;
  set({ selection: EMPTY_SELECTION, selectionLost: empty && get().selectionLost });
}

export function setHover(hover: Hover | null) {
  const current = get().hover;
  if (current === hover) return;
  if (current && hover && current.screenId === hover.screenId && current.id === hover.id && current.source === hover.source) {
    return;
  }
  set({ hover });
}

export { EMPTY_SELECTION, IDLE_SEARCH };
