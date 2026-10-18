import {
  BOARD_COLUMNS,
  MAX_ZOOM,
  MIN_ZOOM,
  PREVIEW_GAP,
  PREVIEW_HEIGHT,
  PREVIEW_TITLE_HEIGHT,
  PREVIEW_WIDTH,
} from "../config";
import type { Viewport } from "../state/store";

/** World-space origin of a preview's frame (below its title). */
export function previewOrigin(index: number): { x: number; y: number } {
  const col = index % BOARD_COLUMNS;
  const row = Math.floor(index / BOARD_COLUMNS);
  return {
    x: col * (PREVIEW_WIDTH + PREVIEW_GAP),
    y: row * (PREVIEW_HEIGHT + PREVIEW_TITLE_HEIGHT + PREVIEW_GAP) + PREVIEW_TITLE_HEIGHT,
  };
}

export function worldToBoard(v: Viewport, x: number, y: number) {
  return { x: v.x + x * v.zoom, y: v.y + y * v.zoom };
}

export function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zoom keeping the board point (bx, by) fixed under the pointer. */
export function zoomAround(v: Viewport, bx: number, by: number, factor: number): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  if (zoom === v.zoom) return v;
  const wx = (bx - v.x) / v.zoom;
  const wy = (by - v.y) / v.zoom;
  return { zoom, x: bx - wx * zoom, y: by - wy * zoom };
}

export function wheelZoomFactor(deltaY: number) {
  return Math.exp(-deltaY * 0.0025);
}

/** World-space bounds of all previews, titles included. */
export function worldBounds(count: number) {
  const cols = Math.min(BOARD_COLUMNS, Math.max(1, count));
  const rows = Math.max(1, Math.ceil(count / BOARD_COLUMNS));
  return {
    w: cols * PREVIEW_WIDTH + (cols - 1) * PREVIEW_GAP,
    h: rows * (PREVIEW_HEIGHT + PREVIEW_TITLE_HEIGHT) + (rows - 1) * PREVIEW_GAP,
  };
}

export function fitViewport(count: number, width: number, height: number, padding = 48): Viewport {
  const b = worldBounds(count);
  const zoom = clampZoom(Math.min((width - padding * 2) / b.w, (height - padding * 2) / b.h));
  // Centre what fits; when the board is larger than the view even at minimum
  // zoom, start from its top-left corner rather than cropping every side.
  const x = b.w * zoom <= width - padding * 2 ? (width - b.w * zoom) / 2 : padding;
  const y = b.h * zoom <= height - padding * 2 ? (height - b.h * zoom) / 2 : padding;
  return { zoom, x, y };
}
