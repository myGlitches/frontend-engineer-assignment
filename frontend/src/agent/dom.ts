import type { LiveProps, NodeInfo, Rect } from "../protocol/messages";

export const GLASS_TAG = "figr-glass";

export function isOwnNode(el: Element): boolean {
  return el.localName === GLASS_TAG;
}

/** Elements the user can point at: anything except html, body and our own glass. */
export function isInspectable(el: Element | null): el is Element {
  return !!el && el !== document.documentElement && el !== document.body && !isOwnNode(el);
}

export function childElements(parent: Element): Element[] {
  const out: Element[] = [];
  for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
    if (!isOwnNode(c)) out.push(c);
  }
  return out;
}

export function nameOf(el: Element): string {
  const dataName = el.getAttribute("data-name");
  if (dataName) return dataName;
  const tag = el.localName;
  const firstClass = el.classList[0];
  if (firstClass) return `${tag}.${firstClass}`;
  if (el.id) return `${tag}#${el.id}`;
  return tag;
}

export function infoOf(el: Element, id: string): NodeInfo {
  return { id, name: nameOf(el), hasChildren: childElements(el).length > 0 };
}

/** The top-level-first chain of ancestors below <body>. */
export function ancestorsOf(el: Element): Element[] {
  const chain: Element[] = [];
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    chain.push(p);
  }
  return chain.reverse();
}

function toRect(r: DOMRect | { left: number; top: number; right: number; bottom: number }): Rect {
  return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
}

function clipsOverflow(el: Element): boolean {
  const s = getComputedStyle(el);
  return s.overflowX !== "visible" || s.overflowY !== "visible";
}

/**
 * The part of the element left visible after intersecting with the viewport
 * and with every clipping ancestor (inner scroll areas). Fixed-position
 * escapes from clipping ancestors are not modelled.
 */
export function visibleRectOf(el: Element, rect: DOMRect): Rect | null {
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
    // Zero-sized elements that sit inside the viewport are still "visible" as a line.
    if (rect.width === 0 || rect.height === 0) {
      const inside = rect.left >= 0 && rect.top >= 0 && rect.left <= window.innerWidth && rect.top <= window.innerHeight;
      return inside ? toRect(rect) : null;
    }
    return null;
  }
  return toRect({ left, top, right, bottom });
}

export function rectOf(el: Element): Rect {
  return toRect(el.getBoundingClientRect());
}

export function livePropsOf(el: Element): LiveProps {
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
    dataKey: el.getAttribute("data-key"),
  };
}

export function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return (el as HTMLElement).isContentEditable === true;
}
