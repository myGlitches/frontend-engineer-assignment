import type { ChildList, Located, NodeId, NodeInfo, RequestMap, SearchHit } from "../protocol/messages";
import { ancestorsOf, childElements, infoOf, isInspectable, nameOf } from "./dom";
import type { Identity } from "./identity";

const ROOT = "#root";

/**
 * Serves the layers tree lazily. The host only ever sees children of parents
 * it asked for; those parents are "observed", and after every mutation batch
 * we diff each observed parent's children and push only the lists that changed.
 */
export class TreeService {
  private readonly observed = new Map<string, string>();

  constructor(private readonly identity: Identity) {}

  locate(el: Element): Located {
    return {
      node: infoOf(el, this.identity.id(el)),
      ancestors: ancestorsOf(el).map((a) => this.identity.id(a)),
    };
  }

  children(parentId: NodeId | null): NodeInfo[] {
    const parent = parentId === null ? document.body : this.identity.element(parentId);
    if (!parent) throw new Error(`Element ${parentId} no longer exists`);
    const list = childElements(parent).map((c) => infoOf(c, this.identity.id(c)));
    this.observed.set(parentId ?? ROOT, signature(list));
    return list;
  }

  release(parentIds: (NodeId | null)[]) {
    for (const id of parentIds) this.observed.delete(id ?? ROOT);
  }

  reset() {
    this.observed.clear();
  }

  reveal(id: NodeId): RequestMap["reveal"]["res"] {
    const el = this.identity.element(id);
    if (!el || !isInspectable(el)) return null;
    const chain = ancestorsOf(el);
    const lists: ChildList[] = [{ parentId: null, children: this.children(null) }];
    for (const a of chain) {
      const aid = this.identity.id(a);
      lists.push({ parentId: aid, children: this.children(aid) });
    }
    return { ancestors: chain.map((a) => this.identity.id(a)), lists };
  }

  relative(id: NodeId, to: RequestMap["relative"]["req"]["to"]): Located | null {
    const el = this.identity.element(id);
    if (!el) return null;
    let target: Element | null = null;
    if (to === "firstChild") target = childElements(el)[0] ?? null;
    else if (to === "parent") target = el.parentElement;
    else {
      const parent = el.parentElement;
      if (!parent) return null;
      const siblings = childElements(parent);
      const i = siblings.indexOf(el);
      const step = to === "next" ? 1 : -1;
      target = siblings[(i + step + siblings.length) % siblings.length];
    }
    return isInspectable(target) ? this.locate(target) : null;
  }

  search(query: string, limit: number): RequestMap["search"]["res"] {
    const q = query.toLowerCase();
    const hits: SearchHit[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let truncated = false;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n as Element;
      if (!nameOf(el).toLowerCase().includes(q)) continue;
      if (hits.length >= limit) {
        truncated = true;
        break;
      }
      hits.push({
        node: infoOf(el, this.identity.id(el)),
        path: ancestorsOf(el).map((a) => infoOf(a, this.identity.id(a))),
      });
    }
    return { hits, truncated };
  }

  /** Lists of observed parents whose children changed since we last sent them. */
  diff(): ChildList[] {
    const changed: ChildList[] = [];
    for (const [key, previous] of this.observed) {
      const parentId = key === ROOT ? null : key;
      const parent = parentId === null ? document.body : this.identity.element(parentId);
      if (!parent) {
        this.observed.delete(key);
        continue;
      }
      const list = childElements(parent).map((c) => infoOf(c, this.identity.id(c)));
      const sig = signature(list);
      if (sig !== previous) {
        this.observed.set(key, sig);
        changed.push({ parentId, children: list });
      }
    }
    return changed;
  }
}

function signature(list: NodeInfo[]): string {
  return list.map((n) => `${n.id}:${n.name}:${n.hasChildren ? 1 : 0}`).join(",");
}
