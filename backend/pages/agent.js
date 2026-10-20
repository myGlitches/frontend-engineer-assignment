var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
  const PROTOCOL_VERSION = 1;
  const HOST_SHORTCUT_KEYS = /* @__PURE__ */ new Set(["v", "i", "Escape", "Enter", "Tab"]);
  const GLASS_TAG = "figr-glass";
  function isOwnNode(el) {
    return el.localName === GLASS_TAG;
  }
  function isInspectable(el) {
    return !!el && el !== document.documentElement && el !== document.body && !isOwnNode(el);
  }
  function childElements(parent) {
    const out = [];
    for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (!isOwnNode(c)) out.push(c);
    }
    return out;
  }
  function nameOf(el) {
    const dataName = el.getAttribute("data-name");
    if (dataName) return dataName;
    const tag = el.localName;
    const firstClass = el.classList[0];
    if (firstClass) return `${tag}.${firstClass}`;
    if (el.id) return `${tag}#${el.id}`;
    return tag;
  }
  function infoOf(el, id) {
    return { id, name: nameOf(el), hasChildren: childElements(el).length > 0 };
  }
  function ancestorsOf(el) {
    const chain = [];
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      chain.push(p);
    }
    return chain.reverse();
  }
  function toRect(r) {
    return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
  }
  function clipsOverflow(el) {
    const s = getComputedStyle(el);
    return s.overflowX !== "visible" || s.overflowY !== "visible";
  }
  function visibleRectOf(el, rect) {
    let left = Math.max(rect.left, 0);
    let top = Math.max(rect.top, 0);
    let right = Math.min(rect.right, window.innerWidth);
    let bottom = Math.min(rect.bottom, window.innerHeight);
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (!clipsOverflow(p)) continue;
      const pr = p.getBoundingClientRect();
      const innerLeft = pr.left + p.clientLeft;
      const innerTop = pr.top + p.clientTop;
      left = Math.max(left, innerLeft);
      top = Math.max(top, innerTop);
      right = Math.min(right, innerLeft + p.clientWidth);
      bottom = Math.min(bottom, innerTop + p.clientHeight);
    }
    if (right <= left || bottom <= top) {
      if (rect.width === 0 || rect.height === 0) {
        const inside = rect.left >= 0 && rect.top >= 0 && rect.left <= window.innerWidth && rect.top <= window.innerHeight;
        return inside ? toRect(rect) : null;
      }
      return null;
    }
    return toRect({ left, top, right, bottom });
  }
  function rectOf(el) {
    return toRect(el.getBoundingClientRect());
  }
  function livePropsOf(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    return {
      name: nameOf(el),
      tag: el.localName,
      domId: el.id,
      classes: Array.from(el.classList).join(" "),
      width: Math.round(r.width),
      height: Math.round(r.height),
      pageX: Math.round(r.left + window.scrollX),
      pageY: Math.round(r.top + window.scrollY),
      text,
      color: s.color,
      background: s.backgroundColor,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      dataKey: el.getAttribute("data-key")
    };
  }
  function isEditable(el) {
    if (!(el instanceof Element)) return false;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    return el.isContentEditable === true;
  }
  class GeometryWatcher {
    constructor(identity, emit) {
      __publicField(this, "hover", null);
      __publicField(this, "selected", []);
      __publicField(this, "last", /* @__PURE__ */ new Map());
      __publicField(this, "frame", 0);
      this.identity = identity;
      this.emit = emit;
      const kick = () => this.flush();
      window.addEventListener("scroll", kick, { capture: true, passive: true });
      window.addEventListener("resize", kick);
    }
    watch(hover, selected) {
      this.hover = hover;
      this.selected = selected;
      const keep = new Set(selected);
      if (hover) keep.add(hover);
      for (const id of this.last.keys()) if (!keep.has(id)) this.last.delete(id);
      this.flush();
      this.schedule();
    }
    flush() {
      const ids = new Set(this.selected);
      if (this.hover) ids.add(this.hover);
      const changed = [];
      for (const id of ids) {
        const el = this.identity.element(id);
        if (!el) continue;
        const rect = rectOf(el);
        const snap = {
          id,
          rect,
          visible: visibleRectOf(el, el.getBoundingClientRect()),
          props: this.selected.includes(id) ? livePropsOf(el) : void 0
        };
        const sig = JSON.stringify(snap);
        if (this.last.get(id) !== sig) {
          this.last.set(id, sig);
          changed.push(snap);
        }
      }
      if (changed.length) this.emit({ kind: "geometry", elements: changed });
    }
    schedule() {
      if (this.frame || !this.hover && this.selected.length === 0) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.flush();
        this.schedule();
      });
    }
  }
  class Identity {
    constructor() {
      __publicField(this, "seq", 0);
      __publicField(this, "byId", /* @__PURE__ */ new Map());
      __publicField(this, "idOf", /* @__PURE__ */ new WeakMap());
      /** Last known parent, needed when an element was removed from a parent that stayed connected. */
      __publicField(this, "parentOf", /* @__PURE__ */ new WeakMap());
    }
    id(el) {
      let id = this.idOf.get(el);
      if (!id) {
        id = `n${++this.seq}`;
        this.bind(id, el);
      }
      return id;
    }
    element(id) {
      const el = this.byId.get(id);
      return el && el.isConnected ? el : null;
    }
    has(id) {
      return this.byId.has(id);
    }
    /** Rebinds ids whose elements were replaced. Returns the ids that are gone for good. */
    reconcile(records) {
      const stale = [];
      for (const [id, el] of this.byId) if (!el.isConnected) stale.push([id, el]);
      if (stale.length === 0) return [];
      const pass = new ResolvePass(this.idOf, this.byId, this.parentOf, records);
      const gone = [];
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
    bind(id, el) {
      this.byId.set(id, el);
      this.idOf.set(el, id);
      if (el.parentElement) this.parentOf.set(el, el.parentElement);
    }
  }
  class ResolvePass {
    constructor(idOf, byId, parentOf, records) {
      __publicField(this, "memo", /* @__PURE__ */ new Map());
      __publicField(this, "claimed", /* @__PURE__ */ new Set());
      __publicField(this, "fingerprints", /* @__PURE__ */ new WeakMap());
      __publicField(this, "looseFingerprints", /* @__PURE__ */ new WeakMap());
      /** For nodes removed by a full replacement of their parent's content: their old siblings. */
      __publicField(this, "oldSiblings", /* @__PURE__ */ new Map());
      this.idOf = idOf;
      this.byId = byId;
      this.parentOf = parentOf;
      for (const r of records) {
        if (r.type !== "childList" || r.removedNodes.length === 0) continue;
        if (r.previousSibling || r.nextSibling) continue;
        const olds = Array.from(r.removedNodes).filter((n) => n instanceof Element && !isOwnNode(n));
        for (const o of olds) {
          this.oldSiblings.set(o, olds);
          if (r.target instanceof Element && !this.parentOf.has(o)) this.parentOf.set(o, r.target);
        }
      }
    }
    resolve(old) {
      if (old.isConnected) return old;
      if (this.memo.has(old)) return this.memo.get(old);
      this.memo.set(old, null);
      const found = this.find(old);
      if (found) this.claimed.add(found);
      this.memo.set(old, found);
      return found;
    }
    find(old) {
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
    unique(list, old) {
      let match = null;
      for (const c of list) {
        if (c.localName !== old.localName || !this.isFree(c)) continue;
        if (match) return null;
        match = c;
      }
      return match;
    }
    isFree(el) {
      if (this.claimed.has(el)) return false;
      const id = this.idOf.get(el);
      return !id || this.byId.get(id) !== el;
    }
    shape(el) {
      const attrs = Array.from(el.attributes, (a) => `${a.name}=${a.value}`).sort();
      return `${el.localName}[${attrs.join("|")}]`;
    }
    fingerprint(el, ignoreDigits = false) {
      const cache = ignoreDigits ? this.looseFingerprints : this.fingerprints;
      let fp = cache.get(el);
      if (fp === void 0) {
        let text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (ignoreDigits) text = text.replace(/\d+/g, "#");
        fp = `${this.shape(el)}{${text}}`;
        cache.set(el, fp);
      }
      return fp;
    }
  }
  const LINE_HEIGHT = 16;
  const WHEEL_LATCH_MS = 250;
  class Picker {
    constructor(emit, locate) {
      __publicField(this, "mode", "select");
      __publicField(this, "glass");
      __publicField(this, "hovered", null);
      __publicField(this, "lastWheel", 0);
      __publicField(this, "latch", "page");
      this.emit = emit;
      this.locate = locate;
      this.glass = document.createElement(GLASS_TAG);
      Object.assign(this.glass.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        background: "transparent",
        cursor: "default",
        display: "block"
      });
      this.glass.addEventListener("pointermove", (e) => this.onPointerMove(e));
      this.glass.addEventListener("pointerdown", (e) => this.onPointerDown(e));
      for (const type of ["click", "dblclick", "mousedown", "mouseup", "contextmenu", "auxclick"]) {
        this.glass.addEventListener(type, (e) => e.preventDefault());
      }
      document.addEventListener("pointerout", (e) => {
        if (!e.relatedTarget) this.setHover(null);
      });
      window.addEventListener("blur", () => this.setHover(null));
      window.addEventListener("wheel", (e) => this.onWheel(e), { capture: true, passive: false });
      window.addEventListener("keydown", (e) => this.onKey(e), { capture: true });
      window.addEventListener("keyup", (e) => this.mode === "select" && e.stopImmediatePropagation(), { capture: true });
      window.addEventListener("keypress", (e) => this.mode === "select" && e.stopImmediatePropagation(), { capture: true });
    }
    setMode(mode) {
      this.mode = mode;
      if (mode === "select") {
        if (!this.glass.isConnected) document.documentElement.appendChild(this.glass);
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body) active.blur();
      } else {
        this.glass.remove();
        this.setHover(null);
      }
    }
    pick(x, y) {
      for (const el of document.elementsFromPoint(x, y)) {
        if (el === this.glass) continue;
        return isInspectable(el) ? el : null;
      }
      return null;
    }
    setHover(el) {
      if (el === this.hovered) return;
      this.hovered = el;
      this.emit({ kind: "hover", target: el ? this.locate(el) : null });
    }
    onPointerMove(e) {
      this.setHover(this.pick(e.clientX, e.clientY));
    }
    onPointerDown(e) {
      e.preventDefault();
      if (e.button !== 0) return;
      const el = this.pick(e.clientX, e.clientY);
      this.emit({ kind: "press", target: el ? this.locate(el) : null, shift: e.shiftKey });
    }
    /**
     * The wheel scrolls the page first and chains to the board once nothing under
     * the pointer can scroll further, like nested scroll containers in a browser.
     * One gesture is latched to whichever side it started on, so trackpad
     * momentum that runs past the end of a page does not suddenly pan the board.
     */
    onWheel(e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.emit({ kind: "zoom", deltaY: normalise(e.deltaY, e.deltaMode, window.innerHeight), x: e.clientX, y: e.clientY });
        return;
      }
      const horizontal = e.shiftKey && !e.deltaX;
      const dx = normalise(horizontal ? e.deltaY : e.deltaX, e.deltaMode, window.innerWidth);
      const dy = horizontal ? 0 : normalise(e.deltaY, e.deltaMode, window.innerHeight);
      const selecting = this.mode === "select" && e.target === this.glass;
      const from = selecting ? this.pick(e.clientX, e.clientY) : e.target instanceof Element ? e.target : null;
      const now = performance.now();
      const continuing = now - this.lastWheel < WHEEL_LATCH_MS;
      this.lastWheel = now;
      const scroller = findScroller(from, dx, dy);
      if (!continuing) this.latch = scroller ? "page" : "board";
      if (this.latch === "board") {
        e.preventDefault();
        this.emit({ kind: "pan", dx, dy });
        return;
      }
      if (!selecting) return;
      e.preventDefault();
      scroller == null ? void 0 : scroller.scrollBy({ left: dx, top: dy, behavior: "instant" });
      this.setHover(this.pick(e.clientX, e.clientY));
    }
    onKey(e) {
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if ((e.metaKey || e.ctrlKey) && key === "\\") {
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (this.mode === "select") {
        e.stopImmediatePropagation();
        if (HOST_SHORTCUT_KEYS.has(key) || plain) e.preventDefault();
      } else {
        if (!plain || isEditable(e.target) || key !== "v" && key !== "i") return;
        e.preventDefault();
      }
      this.emit({ kind: "key", key, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey });
    }
  }
  function normalise(delta, mode, page) {
    if (mode === WheelEvent.DOM_DELTA_LINE) return delta * LINE_HEIGHT;
    if (mode === WheelEvent.DOM_DELTA_PAGE) return delta * page;
    return delta;
  }
  function canScroll(el, dx, dy) {
    const s = getComputedStyle(el);
    const yOk = /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight;
    const xOk = /(auto|scroll|overlay)/.test(s.overflowX) && el.scrollWidth > el.clientWidth;
    const down = dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : dy < 0 ? el.scrollTop > 0 : false;
    const right = dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : dx < 0 ? el.scrollLeft > 0 : false;
    return yOk && down || xOk && right;
  }
  function findScroller(from, dx, dy) {
    for (let el = from; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (canScroll(el, dx, dy)) return el;
    }
    const doc = document.scrollingElement;
    if (!doc) return null;
    const down = dy > 0 ? doc.scrollTop + window.innerHeight < doc.scrollHeight - 1 : dy < 0 && doc.scrollTop > 0;
    const right = dx > 0 ? doc.scrollLeft + window.innerWidth < doc.scrollWidth - 1 : dx < 0 && doc.scrollLeft > 0;
    return down || right ? doc : null;
  }
  const ROOT = "#root";
  class TreeService {
    constructor(identity) {
      __publicField(this, "observed", /* @__PURE__ */ new Map());
      this.identity = identity;
    }
    locate(el) {
      return {
        node: infoOf(el, this.identity.id(el)),
        ancestors: ancestorsOf(el).map((a) => this.identity.id(a))
      };
    }
    children(parentId) {
      const parent = parentId === null ? document.body : this.identity.element(parentId);
      if (!parent) throw new Error(`Element ${parentId} no longer exists`);
      const list = childElements(parent).map((c) => infoOf(c, this.identity.id(c)));
      this.observed.set(parentId ?? ROOT, signature(list));
      return list;
    }
    release(parentIds) {
      for (const id of parentIds) this.observed.delete(id ?? ROOT);
    }
    reset() {
      this.observed.clear();
    }
    reveal(id) {
      const el = this.identity.element(id);
      if (!el || !isInspectable(el)) return null;
      const chain = ancestorsOf(el);
      const lists = [{ parentId: null, children: this.children(null) }];
      for (const a of chain) {
        const aid = this.identity.id(a);
        lists.push({ parentId: aid, children: this.children(aid) });
      }
      return { ancestors: chain.map((a) => this.identity.id(a)), lists };
    }
    relative(id, to) {
      const el = this.identity.element(id);
      if (!el) return null;
      let target = null;
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
    search(query, limit) {
      const q = query.toLowerCase();
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let truncated = false;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n;
        if (!nameOf(el).toLowerCase().includes(q)) continue;
        if (hits.length >= limit) {
          truncated = true;
          break;
        }
        hits.push({
          node: infoOf(el, this.identity.id(el)),
          path: ancestorsOf(el).map((a) => infoOf(a, this.identity.id(a)))
        });
      }
      return { hits, truncated };
    }
    /** Lists of observed parents whose children changed since we last sent them. */
    diff() {
      const changed = [];
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
  function signature(list) {
    return list.map((n) => `${n.id}:${n.name}:${n.hasChildren ? 1 : 0}`).join(",");
  }
  const MAX_QUEUED_EVENTS = 50;
  function boot() {
    if (window.__figrAgent || window.parent === window) return;
    window.__figrAgent = true;
    let port = null;
    const queue = [];
    let debug = { kind: "debug" };
    const send = (msg) => {
      if (port) port.postMessage(msg);
      else if (msg.t === "evt" && queue.length < MAX_QUEUED_EVENTS) queue.push(msg);
    };
    const emit = (evt) => send({ t: "evt", evt });
    const identity = new Identity();
    const tree = new TreeService(identity);
    const watcher = new GeometryWatcher(identity, emit);
    const picker = new Picker(emit, (el) => tree.locate(el));
    picker.setMode("select");
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
    const handlers = {
      children: ({ parentId }) => ({ children: tree.children(parentId) }),
      reveal: ({ id }) => tree.reveal(id),
      relative: ({ id, to }) => tree.relative(id, to),
      search: ({ query, limit }) => tree.search(query, limit),
      ping: () => ({ url: location.href }),
      scrollIntoView: ({ id }) => {
        const el = identity.element(id);
        return { scrolled: el ? scrollIntoViewWithinPage(el) : false };
      }
    };
    const answer = (rid, kind, payload) => {
      try {
        if (debug.throwOnNextRequest) {
          debug = { ...debug, throwOnNextRequest: false };
          throw new Error("Agent failed to handle the request (dev fault)");
        }
        const value = handlers[kind](payload);
        send({ t: "res", rid, ok: true, value });
      } catch (err) {
        send({ t: "res", rid, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    };
    const onPortMessage = (e) => {
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
        debug = { ...debug, delayNextChildrenMs: void 0 };
        setTimeout(() => answer(msg.rid, msg.kind, msg.payload), delay);
        return;
      }
      answer(msg.rid, msg.kind, msg.payload);
    };
    window.addEventListener("message", (e) => {
      var _a;
      if (e.source !== window.parent || ((_a = e.data) == null ? void 0 : _a.type) !== "figr:connect" || !e.ports[0]) return;
      if (e.data.protocol !== PROTOCOL_VERSION) return;
      port == null ? void 0 : port.close();
      port = e.ports[0];
      port.onmessage = onPortMessage;
      tree.reset();
      picker.setMode(e.data.mode);
      for (const msg of queue.splice(0)) port.postMessage(msg);
    });
    const hello = { type: "figr:hello", protocol: PROTOCOL_VERSION, url: location.href };
    window.parent.postMessage(hello, "*");
  }
  function isOwnMutation(r) {
    if (r.target instanceof Element && isOwnNode(r.target)) return true;
    if (r.type !== "childList") return false;
    const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
    return nodes.length > 0 && nodes.every((n) => n instanceof Element && isOwnNode(n));
  }
  function scrollIntoViewWithinPage(el) {
    let scrolled = false;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (p.scrollHeight <= p.clientHeight && p.scrollWidth <= p.clientWidth) continue;
      const s = getComputedStyle(p);
      if (!/(auto|scroll|overlay)/.test(s.overflowY + s.overflowX)) continue;
      const r2 = el.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      const dy2 = r2.top < pr.top ? r2.top - pr.top : r2.bottom > pr.bottom ? Math.min(r2.bottom - pr.bottom, r2.top - pr.top) : 0;
      const dx2 = r2.left < pr.left ? r2.left - pr.left : r2.right > pr.right ? Math.min(r2.right - pr.right, r2.left - pr.left) : 0;
      if (dx2 || dy2) {
        p.scrollBy({ left: dx2, top: dy2, behavior: "instant" });
        scrolled = true;
      }
    }
    const r = el.getBoundingClientRect();
    const dy = r.top < 0 ? r.top : r.bottom > window.innerHeight ? Math.min(r.bottom - window.innerHeight, r.top) : 0;
    const dx = r.left < 0 ? r.left : r.right > window.innerWidth ? Math.min(r.right - window.innerWidth, r.left) : 0;
    if (dx || dy) {
      window.scrollBy({ left: dx, top: dy, behavior: "instant" });
      scrolled = true;
    }
    return scrolled;
  }
  boot();
})();
