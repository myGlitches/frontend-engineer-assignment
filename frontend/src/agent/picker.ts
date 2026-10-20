import type { AgentEvent, Located, Mode } from "../protocol/messages";
import { HOST_SHORTCUT_KEYS } from "../protocol/messages";
import { GLASS_TAG, isEditable, isInspectable } from "./dom";

type Emit = (evt: AgentEvent) => void;

const LINE_HEIGHT = 16;
const WHEEL_LATCH_MS = 250;

/**
 * Owns all user input inside the page.
 *
 * In Select mode a transparent full-viewport "glass" sits above the page and
 * absorbs every pointer event, so the page never sees clicks, focus or form
 * submission. It is attached to <html>, not <body>, so it is not part of the
 * layers tree. Targets are found with elementsFromPoint, which unlike event
 * targets also reports disabled controls and elements with no listeners.
 */
export class Picker {
  private mode: Mode = "select";
  private readonly glass: HTMLElement;
  private hovered: Element | null = null;
  private lastWheel = 0;
  private latch: "page" | "board" = "page";

  constructor(
    private readonly emit: Emit,
    private readonly locate: (el: Element) => Located,
  ) {
    this.glass = document.createElement(GLASS_TAG);
    Object.assign(this.glass.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "transparent",
      cursor: "default",
      display: "block",
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

  setMode(mode: Mode) {
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

  private pick(x: number, y: number): Element | null {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === this.glass) continue;
      return isInspectable(el) ? el : null;
    }
    return null;
  }

  private setHover(el: Element | null) {
    if (el === this.hovered) return;
    this.hovered = el;
    this.emit({ kind: "hover", target: el ? this.locate(el) : null });
  }

  private onPointerMove(e: PointerEvent) {
    this.setHover(this.pick(e.clientX, e.clientY));
  }

  private onPointerDown(e: PointerEvent) {
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
  private onWheel(e: WheelEvent) {
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
    // The glass would otherwise only ever scroll the document; scroll whatever
    // is actually under the pointer, as the browser would.
    e.preventDefault();
    scroller?.scrollBy({ left: dx, top: dy, behavior: "instant" as ScrollBehavior });
    this.setHover(this.pick(e.clientX, e.clientY));
  }

  private onKey(e: KeyboardEvent) {
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ((e.metaKey || e.ctrlKey) && key === "\\") {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (this.mode === "select") {
      e.stopImmediatePropagation();
      if (HOST_SHORTCUT_KEYS.has(key) || plain) e.preventDefault();
    } else {
      if (!plain || isEditable(e.target) || (key !== "v" && key !== "i")) return;
      e.preventDefault();
    }
    this.emit({ kind: "key", key, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey });
  }
}

function normalise(delta: number, mode: number, page: number): number {
  if (mode === WheelEvent.DOM_DELTA_LINE) return delta * LINE_HEIGHT;
  if (mode === WheelEvent.DOM_DELTA_PAGE) return delta * page;
  return delta;
}

function canScroll(el: Element, dx: number, dy: number): boolean {
  const s = getComputedStyle(el);
  const yOk = /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight;
  const xOk = /(auto|scroll|overlay)/.test(s.overflowX) && el.scrollWidth > el.clientWidth;
  const down = dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : dy < 0 ? el.scrollTop > 0 : false;
  const right = dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : dx < 0 ? el.scrollLeft > 0 : false;
  return (yOk && down) || (xOk && right);
}

/** The nearest thing that can still scroll in this direction, the document included. */
function findScroller(from: Element | null, dx: number, dy: number): Element | null {
  for (let el = from; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (canScroll(el, dx, dy)) return el;
  }
  const doc = document.scrollingElement;
  if (!doc) return null;
  const down = dy > 0 ? doc.scrollTop + window.innerHeight < doc.scrollHeight - 1 : dy < 0 && doc.scrollTop > 0;
  const right = dx > 0 ? doc.scrollLeft + window.innerWidth < doc.scrollWidth - 1 : dx < 0 && doc.scrollLeft > 0;
  return down || right ? doc : null;
}
