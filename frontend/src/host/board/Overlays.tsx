import type { ElementSnapshot, Rect } from "../../protocol/messages";
import type { Screen } from "../api/client";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "../config";
import { useApp, type Viewport } from "../state/store";
import { previewOrigin, worldToBoard } from "./layout";

const LABEL_HEIGHT = 18;

/**
 * Outlines live in board (screen) space, outside the zoomed world, so they stay
 * 1px / 2px and labels keep their size at any zoom. Each preview gets a clip
 * box matching its frame, and each outline is further clipped to the part of
 * the element its page reports as visible (inner scroll areas included).
 */
export function Overlays({ screens }: { screens: Screen[] }) {
  const mode = useApp((s) => s.mode);
  const viewport = useApp((s) => s.viewport);
  const hover = useApp((s) => s.hover);
  const selection = useApp((s) => s.selection);
  const geometry = useApp((s) => s.geometry);
  const layers = useApp((s) => s.layers);

  if (mode !== "select") return null;

  const byScreen = new Map<string, { snap: ElementSnapshot; kind: "hover" | "selected"; name: string }[]>();
  const push = (screenId: string, item: { snap: ElementSnapshot; kind: "hover" | "selected"; name: string }) => {
    const list = byScreen.get(screenId) ?? [];
    list.push(item);
    byScreen.set(screenId, list);
  };
  if (selection.screenId) {
    for (const id of selection.ids) {
      const snap = geometry[selection.screenId]?.[id];
      const name = snap?.props?.name ?? layers[selection.screenId]?.nodes[id]?.name ?? "";
      if (snap) push(selection.screenId, { snap, kind: "selected", name });
    }
  }
  if (hover) {
    const snap = geometry[hover.screenId]?.[hover.id];
    if (snap) push(hover.screenId, { snap, kind: "hover", name: hover.name });
  }

  return (
    <div className="overlays" aria-hidden>
      {screens.map((screen, index) => {
        const items = byScreen.get(screen.id);
        if (!items) return null;
        return <PreviewOverlay key={screen.id} index={index} viewport={viewport} items={items} />;
      })}
    </div>
  );
}

function PreviewOverlay({
  index,
  viewport,
  items,
}: {
  index: number;
  viewport: Viewport;
  items: { snap: ElementSnapshot; kind: "hover" | "selected"; name: string }[];
}) {
  const origin = previewOrigin(index);
  const topLeft = worldToBoard(viewport, origin.x, origin.y);
  const z = viewport.zoom;
  return (
    <div
      className="overlay-clip"
      style={{ left: topLeft.x, top: topLeft.y, width: PREVIEW_WIDTH * z, height: PREVIEW_HEIGHT * z }}
    >
      {items.map(({ snap, kind, name }) =>
        snap.visible ? <Outline key={`${kind}:${snap.id}`} rect={snap.rect} visible={snap.visible} zoom={z} kind={kind} name={name} /> : null,
      )}
    </div>
  );
}

function Outline({ rect, visible, zoom, kind, name }: { rect: Rect; visible: Rect; zoom: number; kind: "hover" | "selected"; name: string }) {
  const box = { x: rect.x * zoom, y: rect.y * zoom, w: rect.w * zoom, h: rect.h * zoom };
  const clip = { x: visible.x * zoom, y: visible.y * zoom, w: visible.w * zoom, h: visible.h * zoom };
  const top = box.y - LABEL_HEIGHT >= 0 ? box.y - LABEL_HEIGHT : box.y + box.h;
  return (
    <>
      <div className="outline-clip" style={{ left: clip.x, top: clip.y, width: clip.w, height: clip.h }}>
        <div
          className={`outline outline--${kind}`}
          style={{ left: box.x - clip.x, top: box.y - clip.y, width: box.w, height: box.h }}
        />
      </div>
      <div className={`outline-label outline-label--${kind}`} style={{ left: Math.max(0, box.x), top, height: LABEL_HEIGHT }}>
        {name}
      </div>
    </>
  );
}
