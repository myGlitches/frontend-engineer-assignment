import type { NodeId } from "../protocol/messages";
import { childElements, isOwnNode } from "./dom";

/**
 * Stable ids for DOM elements that survive the page rebuilding its nodes.
 *
 * Ids are handed out lazily, only for elements the host has seen. When a
 * mutation batch disconnects an element we try to find the node that
 * replaced it, strongest evidence first:
 *
 *   1. data-key: authoritative. A unique, same-tag match is the element;
 *      no match means it is gone. We never fall back to weaker rules.
 *   2. id attribute: same rule, but only when exactly one candidate exists.
 *   3. Under the (recursively resolved) parent: a unique child with an
 *      identical fingerprint (tag, attributes, text).
 *   4. The same, with digits ignored in text. Re-renders mostly change
 *      counters and relative times ("18s ago"), not what an element is.
 *   5. Under the resolved parent, an in-place re-render: same child count and
 *      every sibling lines up exactly, so only this slot's content changed.
 *
 * Anything else is reported as gone. A false "gone" costs the user a click;
 * a selection jumping to a different element is a correctness bug, so every
 * rule requires uniqueness and refuses to guess.
 */
export class Identity {
  private seq = 0;
  private readonly byId = new Map<NodeId, Element>();
  private readonly idOf = new WeakMap<Element, NodeId>();
  /** Last known parent, needed when an element was removed from a parent that stayed connected. */
  private readonly parentOf = new WeakMap<Element, Element>();

  id(el: Element): NodeId {
    let id = this.idOf.get(el);
    if (!id) {
      id = `n${++this.seq}`;
      this.bind(id, el);
    }
    return id;
  }

  element(id: NodeId): Element | null {
    const el = this.byId.get(id);
    return el && el.isConnected ? el : null;
  }

  has(id: NodeId): boolean {
    return this.byId.has(id);
  }

  /** Rebinds ids whose elements were replaced. Returns the ids that are gone for good. */
  reconcile(records: MutationRecord[]): NodeId[] {
    const stale: [NodeId, Element][] = [];
    for (const [id, el] of this.byId) if (!el.isConnected) stale.push([id, el]);
    if (stale.length === 0) return [];

    const pass = new ResolvePass(this.idOf, this.byId, this.parentOf, records);
    const gone: NodeId[] = [];
    for (const [id, el] of stale) {
      const next = pass.resolve(el);
      if (next) {
        this.bind(id, next);
      } else {
        this.byId.delete(id);
        gone.push(id);
      }
    }
    return gone;
  }

  private bind(id: NodeId, el: Element) {
    this.byId.set(id, el);
    this.idOf.set(el, id);
    if (el.parentElement) this.parentOf.set(el, el.parentElement);
  }
}

class ResolvePass {
  private readonly memo = new Map<Element, Element | null>();
  private readonly claimed = new Set<Element>();
  private readonly fingerprints = new WeakMap<Element, string>();
  private readonly looseFingerprints = new WeakMap<Element, string>();
  /** For nodes removed by a full replacement of their parent's content: their old siblings. */
  private readonly oldSiblings = new Map<Element, Element[]>();

  constructor(
    private readonly idOf: WeakMap<Element, NodeId>,
    private readonly byId: Map<NodeId, Element>,
    private readonly parentOf: WeakMap<Element, Element>,
    records: MutationRecord[],
  ) {
    for (const r of records) {
      if (r.type !== "childList" || r.removedNodes.length === 0) continue;
      if (r.previousSibling || r.nextSibling) continue;
      const olds = Array.from(r.removedNodes).filter((n): n is Element => n instanceof Element && !isOwnNode(n));
      for (const o of olds) {
        this.oldSiblings.set(o, olds);
        if (r.target instanceof Element && !this.parentOf.has(o)) this.parentOf.set(o, r.target);
      }
    }
  }

  resolve(old: Element): Element | null {
    if (old.isConnected) return old;
    if (this.memo.has(old)) return this.memo.get(old)!;
    this.memo.set(old, null);
    const found = this.find(old);
    if (found) this.claimed.add(found);
    this.memo.set(old, found);
    return found;
  }

  private find(old: Element): Element | null {
    const key = old.getAttribute("data-key");
    if (key !== null) return this.unique(document.querySelectorAll(`[data-key="${CSS.escape(key)}"]`), old);

    if (old.id) {
      const match = this.unique(document.querySelectorAll(`#${CSS.escape(old.id)}`), old);
      if (match) return match;
    }

    const oldParent = old.parentElement ?? this.parentOf.get(old) ?? null;
    if (!oldParent) return null;
    const parent = this.resolve(oldParent);
    if (!parent) return null;

    const candidates = childElements(parent).filter((c) => this.isFree(c));
    const fp = this.fingerprint(old);
    const exact = candidates.filter((c) => this.fingerprint(c) === fp);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;

    const loose = this.fingerprint(old, true);
    const similar = candidates.filter((c) => this.fingerprint(c, true) === loose);
    if (similar.length === 1) return similar[0];
    if (similar.length > 1) return null;

    const before = old.parentElement ? childElements(old.parentElement) : this.oldSiblings.get(old);
    if (!before) return null;
    const after = childElements(parent);
    if (before.length !== after.length) return null;
    const slot = before.indexOf(old);
    for (let i = 0; i < before.length; i++) {
      if (i !== slot && this.fingerprint(before[i]) !== this.fingerprint(after[i])) return null;
    }
    const next = after[slot];
    if (!next || !this.isFree(next) || this.shape(next) !== this.shape(old)) return null;
    return next;
  }

  private unique(list: NodeListOf<Element>, old: Element): Element | null {
    let match: Element | null = null;
    for (const c of list) {
      if (c.localName !== old.localName || !this.isFree(c)) continue;
      if (match) return null;
      match = c;
    }
    return match;
  }

  private isFree(el: Element): boolean {
    if (this.claimed.has(el)) return false;
    const id = this.idOf.get(el);
    return !id || this.byId.get(id) !== el;
  }

  private shape(el: Element): string {
    const attrs = Array.from(el.attributes, (a) => `${a.name}=${a.value}`).sort();
    return `${el.localName}[${attrs.join("|")}]`;
  }

  private fingerprint(el: Element, ignoreDigits = false): string {
    const cache = ignoreDigits ? this.looseFingerprints : this.fingerprints;
    let fp = cache.get(el);
    if (fp === undefined) {
      let text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (ignoreDigits) text = text.replace(/\d+/g, "#");
      fp = `${this.shape(el)}{${text}}`;
      cache.set(el, fp);
    }
    return fp;
  }
}
