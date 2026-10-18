import { useRef } from "react";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "../config";
import { centerOn, fitBoard, zoomStep } from "../controller";
import { useApp } from "../state/store";
import { previewOrigin, worldBounds } from "./layout";

const MAP_WIDTH = 160;
const MAP_HEIGHT = 120;

/**
 * Overview of the whole board with the visible area drawn on top. Clicking or
 * dragging on it moves the view there, so the user can always find their way
 * back from empty canvas.
 */
export function Minimap({ count }: { count: number }) {
  const viewport = useApp((s) => s.viewport);
  const activeScreenId = useApp((s) => s.activeScreenId);
  const screens = useApp((s) => s.screens);
  const mapRef = useRef<HTMLDivElement>(null);

  const size = useApp((s) => s.boardSize);
  const view = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    w: size.width / viewport.zoom,
    h: size.height / viewport.zoom,
  };

  // Frame both the content and the current view, so the view never falls off
  // the map even when the user has panned far into empty canvas.
  const content = worldBounds(count);
  const left = Math.min(0, view.x);
  const top = Math.min(0, view.y);
  const right = Math.max(content.w, view.x + view.w);
  const bottom = Math.max(content.h, view.y + view.h);
  const scale = Math.min(MAP_WIDTH / (right - left), MAP_HEIGHT / (bottom - top));
  const offX = (MAP_WIDTH - (right - left) * scale) / 2 - left * scale;
  const offY = (MAP_HEIGHT - (bottom - top) * scale) / 2 - top * scale;

  const moveTo = (e: React.PointerEvent) => {
    const r = mapRef.current!.getBoundingClientRect();
    centerOn((e.clientX - r.left - offX) / scale, (e.clientY - r.top - offY) / scale);
  };

  return (
    <div className="minimap" data-no-pan onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div
        ref={mapRef}
        className="minimap__map"
        style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          moveTo(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && moveTo(e)}
      >
        {Array.from({ length: count }, (_, i) => {
          const o = previewOrigin(i);
          const active = screens?.[i]?.id === activeScreenId;
          return (
            <div
              key={i}
              className={`minimap__preview${active ? " is-active" : ""}`}
              style={{ left: offX + o.x * scale, top: offY + o.y * scale, width: PREVIEW_WIDTH * scale, height: PREVIEW_HEIGHT * scale }}
            />
          );
        })}
        <div
          className="minimap__view"
          style={{ left: offX + view.x * scale, top: offY + view.y * scale, width: view.w * scale, height: view.h * scale }}
        />
      </div>
      <div className="minimap__controls">
        <button type="button" onClick={() => zoomStep(-1)} aria-label="Zoom out">−</button>
        <span>{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomStep(1)} aria-label="Zoom in">+</button>
        <button type="button" className="minimap__fit" onClick={fitBoard}>Fit all</button>
      </div>
    </div>
  );
}
