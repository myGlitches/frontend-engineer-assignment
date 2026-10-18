import type { NodeId, NodeInfo, SearchHit } from "../../protocol/messages";
import { ROOT, type LayersState, type ParentKey } from "../state/store";

export interface Row {
  id: NodeId;
  depth: number;
  name: string;
  hasChildren: boolean;
  expanded: boolean;
  loading: boolean;
  /** False for ancestors shown only to give a search hit its context. */
  match: boolean;
}

export function treeRows(l: LayersState): Row[] {
  const rows: Row[] = [];
  const walk = (key: ParentKey, depth: number) => {
    for (const id of l.children[key] ?? []) {
      const node = l.nodes[id];
      if (!node) continue;
      const expanded = !!l.expanded[id] && node.hasChildren;
      rows.push({ id, depth, name: node.name, hasChildren: node.hasChildren, expanded, loading: !!l.loading[id], match: true });
      if (expanded) walk(id, depth + 1);
    }
  };
  walk(ROOT, 0);
  return rows;
}

/** Hits arrive in document order, so ancestors are always seen before descendants. */
export function searchRows(hits: SearchHit[]): Row[] {
  const kids = new Map<ParentKey, NodeId[]>();
  const info = new Map<NodeId, NodeInfo>();
  const matched = new Set<NodeId>();
  for (const hit of hits) {
    matched.add(hit.node.id);
    let parent: ParentKey = ROOT;
    for (const n of [...hit.path, hit.node]) {
      if (!info.has(n.id)) {
        info.set(n.id, n);
        const list = kids.get(parent) ?? [];
        list.push(n.id);
        kids.set(parent, list);
      }
      parent = n.id;
    }
  }
  const rows: Row[] = [];
  const walk = (key: ParentKey, depth: number) => {
    for (const id of kids.get(key) ?? []) {
      const n = info.get(id)!;
      const hasKids = kids.has(id);
      rows.push({ id, depth, name: n.name, hasChildren: hasKids, expanded: hasKids, loading: false, match: matched.has(id) });
      walk(id, depth + 1);
    }
  };
  walk(ROOT, 0);
  return rows;
}
