import { useEffect, useRef, useState } from "react";
import { fetchScreens } from "../api/client";
import { bindBoardScope, panBy, screensLoaded, pointerEnteredPreview, setBoardSize, zoomAtBoardPoint } from "../controller";
import { Minimap } from "./Minimap";
import { clearSelection, useApp } from "../state/store";
import { Region, RegionError, useRegionScope } from "../failures/Region";
import { useDevFaults } from "../dev/faults";
import { Overlays } from "./Overlays";
import { Preview } from "./Preview";

const CLICK_SLOP = 3;

export function BoardRegion() {
  const reloads = useDevFaults((s) => s.boardReloads);
  return (
    <Region
      key={reloads}
      region={{ kind: "board", screenId: null }}
      fallback={({ message, retry }) => (
        <div className="board board--failed">
          <RegionError title="Couldn't load the board" message={message} retry={retry} />
        </div>
      )}
    >
      <Board />
    </Region>
  );
}

function Board() {
  const scope = useRegionScope();
  const screens = useApp((s) => s.screens);
  const viewport = useApp((s) => s.viewport);
  const ref = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    bindBoardScope(scope);
    useApp.setState({ screens: null });
    scope.settle(fetchScreens(scope.signal), (list) => useApp.setState({ screens: list }));
    return () => bindBoardScope(null);
  }, [scope]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoardSize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (screens) screensLoaded();
  }, [screens]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = scope.wrap((e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAtBoardPoint(e.clientX - r.left, e.clientY - r.top, e.deltaY);
      else panBy(e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, e.shiftKey && !e.deltaX ? 0 : e.deltaY);
    });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scope]);

  const onPointerDown = scope.wrap((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest("button, a, input, [data-no-pan]")) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let lastX = e.clientX;
    let lastY = e.clientY;
    let moved = false;
    const move = scope.wrap((ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < CLICK_SLOP) return;
      if (!moved) {
        moved = true;
        setPanning(true);
      }
      panBy(lastX - ev.clientX, lastY - ev.clientY);
      lastX = ev.clientX;
      lastY = ev.clientY;
    });
    const up = scope.wrap(() => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setPanning(false);
      if (!moved) clearSelection();
    });
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });

  return (
    <div
      ref={ref}
      className={`board${panning ? " board--panning" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={() => pointerEnteredPreview(null)}
    >
      <div
        className="board__world"
        style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
      >
        {screens?.map((screen, i) => <Preview key={screen.id} screen={screen} index={i} />)}
      </div>
      {screens && <Overlays screens={screens} />}
      {screens && <Minimap count={screens.length} />}
      {!screens && <div className="board__status">Loading screens…</div>}
    </div>
  );
}
