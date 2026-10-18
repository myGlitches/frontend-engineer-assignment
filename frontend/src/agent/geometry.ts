import type { AgentEvent, ElementSnapshot, NodeId } from "../protocol/messages";
import { livePropsOf, rectOf, visibleRectOf } from "./dom";
import type { Identity } from "./identity";

type Emit = (evt: AgentEvent) => void;

/**
 * Streams the boxes (and, for selected elements, live props) of the handful of
 * elements the host is drawing. Elements move for many reasons: page scroll,
 * inner scroll areas, layout shifts, animations, resizes, font loading. Rather
 * than chasing each cause we sample once per frame while something is watched
 * and send only snapshots that actually changed. With at most a few watched
 * elements this costs a few getBoundingClientRect calls per frame.
 */
export class GeometryWatcher {
  private hover: NodeId | null = null;
  private selected: NodeId[] = [];
  private readonly last = new Map<NodeId, string>();
  private frame = 0;

  constructor(
    private readonly identity: Identity,
    private readonly emit: Emit,
  ) {
    const kick = () => this.flush();
    window.addEventListener("scroll", kick, { capture: true, passive: true });
    window.addEventListener("resize", kick);
  }

  watch(hover: NodeId | null, selected: NodeId[]) {
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
    const changed: ElementSnapshot[] = [];
    for (const id of ids) {
      const el = this.identity.element(id);
      if (!el) continue;
      const rect = rectOf(el);
      const snap: ElementSnapshot = {
        id,
        rect,
        visible: visibleRectOf(el, el.getBoundingClientRect()),
        props: this.selected.includes(id) ? livePropsOf(el) : undefined,
      };
      const sig = JSON.stringify(snap);
      if (this.last.get(id) !== sig) {
        this.last.set(id, sig);
        changed.push(snap);
      }
    }
    if (changed.length) this.emit({ kind: "geometry", elements: changed });
  }

  private schedule() {
    if (this.frame || (!this.hover && this.selected.length === 0)) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.flush();
      this.schedule();
    });
  }
}
