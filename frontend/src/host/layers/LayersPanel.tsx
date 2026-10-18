import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NodeId } from "../../protocol/messages";
import {
  clickRow,
  ensureRootLoaded,
  hoverRow,
  rememberScroll,
  retryRow,
  setExpanded,
  setSearchQuery,
} from "../controller";
import { useThrowWhileArmed } from "../dev/faults";
import { Region, RegionError, useRegionScope } from "../failures/Region";
import { regionKey, useFailures } from "../failures/regions";
import { ROOT, useApp, type LayersState } from "../state/store";
import { searchRows, treeRows, type Row } from "./rows";

const ROW_HEIGHT = 24;
const INDENT = 12;
const OVERSCAN = 8;

export function LayersPanel() {
  const active = useApp((s) => s.activeScreenId);
  return (
    <section className="panel layers" aria-label="Layers">
      <header className="panel__header">Layers</header>
      {!active ? (
        <div className="panel__empty">Click something in a preview</div>
      ) : (
        <Region
          key={active}
          region={{ kind: "layers", screenId: active }}
          onRetry={() => retryRow(active, null)}
          fallback={({ message, retry }) => <RegionError title="Couldn't load layers" message={message} retry={retry} />}
        >
          <LayersTree screenId={active} />
        </Region>
      )}
    </section>
  );
}

function LayersTree({ screenId }: { screenId: string }) {
  useThrowWhileArmed("layers-render");
  const scope = useRegionScope();
  const layers = useApp((s) => s.layers[screenId]);
  const sessionId = layers?.sessionId;

  useEffect(() => {
    if (sessionId !== undefined) scope.run(() => ensureRootLoaded(screenId));
  }, [scope, screenId, sessionId]);

  if (!layers) return <div className="panel__empty">Connecting to preview…</div>;
  return <LayersBody key={layers.sessionId} screenId={screenId} layers={layers} />;
}

function LayersBody({ screenId, layers }: { screenId: string; layers: LayersState }) {
  const scope = useRegionScope();
  const hover = useApp((s) => (s.hover?.screenId === screenId ? s.hover : null));
  const selection = useApp((s) => s.selection);
  const searching = layers.search.query !== "";
  const rows = useMemo(
    () => (searching ? searchRows(layers.search.hits) : treeRows(layers)),
    [searching, layers.search.hits, layers.children, layers.nodes, layers.expanded, layers.loading],
  );
  const index = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const selected = useMemo(
    () => new Set(selection.screenId === screenId ? selection.ids : []),
    [selection, screenId],
  );

  const hoveredRow = useMemo(() => {
    if (!hover) return null;
    if (index.has(hover.id)) return hover.id;
    for (let i = hover.ancestors.length - 1; i >= 0; i--) if (index.has(hover.ancestors[i])) return hover.ancestors[i];
    return null;
  }, [hover, index]);

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(layers.scrollTop);
  const [height, setHeight] = useState(400);
  const anchor = useRef<{ rows: Row[]; scrollTop: number } | null>(null);
  const seenTarget = useRef(layers.scrollTarget?.seq ?? 0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = layers.scrollTop;
    setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the first visible row where it was when rows are inserted or removed above it.
  useLayoutEffect(() => {
    const el = listRef.current;
    const prev = anchor.current;
    if (el && prev && prev.rows !== rows) {
      const first = Math.floor(prev.scrollTop / ROW_HEIGHT);
      const row = prev.rows[first];
      const now = row ? index.get(row.id) : undefined;
      if (now !== undefined && now !== first) {
        el.scrollTop = now * ROW_HEIGHT + (prev.scrollTop - first * ROW_HEIGHT);
        setScrollTop(el.scrollTop);
      }
    }
    anchor.current = { rows, scrollTop: el?.scrollTop ?? 0 };
  }, [rows, index]);

  useLayoutEffect(() => {
    const target = layers.scrollTarget;
    const el = listRef.current;
    if (!target || !el || target.seq === seenTarget.current) return;
    const i = index.get(target.id);
    if (i === undefined) return;
    seenTarget.current = target.seq;
    const top = i * ROW_HEIGHT;
    if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2);
      setScrollTop(el.scrollTop);
      if (anchor.current) anchor.current.scrollTop = el.scrollTop;
    }
    const left = rows[i].depth * INDENT;
    if (left < el.scrollLeft || left + 120 > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, left - 48);
  }, [layers.scrollTarget, index, rows]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    if (anchor.current) anchor.current.scrollTop = el.scrollTop;
    rememberScroll(screenId, el.scrollTop);
  };

  const onKeyDown = scope.wrap((e: React.KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const current = selection.screenId === screenId ? selection.ids[selection.ids.length - 1] : undefined;
    const i = current !== undefined ? index.get(current) : undefined;
    if (i === undefined) {
      if (rows[0]) clickRow(screenId, rows[0].id, false);
      return;
    }
    const row = rows[i];
    if (e.key === "ArrowDown" && rows[i + 1]) clickRow(screenId, rows[i + 1].id, false);
    else if (e.key === "ArrowUp" && rows[i - 1]) clickRow(screenId, rows[i - 1].id, false);
    else if (e.key === "ArrowRight") {
      if (!row.hasChildren) return;
      if (!row.expanded) setExpanded(screenId, row.id, true);
      else if (rows[i + 1]?.depth === row.depth + 1) clickRow(screenId, rows[i + 1].id, false);
    } else if (e.key === "ArrowLeft") {
      if (row.expanded && !searching) setExpanded(screenId, row.id, false);
      else {
        const parent = parentRow(rows, i);
        if (parent) clickRow(screenId, parent.id, false);
      }
    }
  });

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const rootLoading = !!layers.loading[ROOT] && !layers.children[ROOT];

  return (
    <div className="layers__body">
      <div className="layers__search">
        <input
          type="search"
          placeholder="Search layers"
          value={layers.search.query}
          onChange={(e) => setSearchQuery(screenId, e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setSearchQuery(screenId, "")}
        />
        {searching && layers.search.status === "loading" && <span className="layers__hint">Searching…</span>}
        {searching && layers.search.status === "ready" && (
          <span className="layers__hint">
            {layers.search.hits.length}
            {layers.search.truncated ? "+" : ""} found
          </span>
        )}
      </div>
      <div
        ref={listRef}
        className="layers__list"
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onMouseLeave={() => hoverRow(screenId, null)}
      >
        {rootLoading && <div className="panel__empty">Loading…</div>}
        <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
          {rows.slice(start, end).map((row, k) => (
            <LayerRow
              key={row.id}
              screenId={screenId}
              row={row}
              top={(start + k) * ROW_HEIGHT}
              searching={searching}
              selected={selected.has(row.id)}
              hovered={hoveredRow === row.id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function parentRow(rows: Row[], i: number): Row | undefined {
  const depth = rows[i].depth;
  for (let j = i - 1; j >= 0; j--) if (rows[j].depth < depth) return rows[j];
  return undefined;
}

function LayerRow({
  screenId,
  row,
  top,
  searching,
  selected,
  hovered,
}: {
  screenId: string;
  row: Row;
  top: number;
  searching: boolean;
  selected: boolean;
  hovered: boolean;
}) {
  const scope = useRegionScope();
  const failure = useFailures(
    (s) => s.failures[regionKey({ kind: "layers-row", screenId, rowId: row.id })],
  );
  const cls = ["layer-row", selected && "is-selected", hovered && "is-hovered", !row.match && "is-context"]
    .filter(Boolean)
    .join(" ");
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!searching) setExpanded(screenId, row.id, !row.expanded);
  };
  return (
    <div
      className={cls}
      style={{ top, height: ROW_HEIGHT, paddingLeft: 8 + row.depth * INDENT }}
      onMouseEnter={scope.wrap(() => hoverRow(screenId, row.id))}
      onClick={scope.wrap((e: React.MouseEvent) => clickRow(screenId, row.id, e.shiftKey))}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
    >
      <span className={`layer-row__chevron${row.hasChildren ? "" : " is-empty"}`} onClick={row.hasChildren ? toggle : undefined}>
        {row.hasChildren ? (row.expanded ? "▾" : "▸") : ""}
      </span>
      <span className="layer-row__name">{row.name}</span>
      {row.expanded && row.loading && <span className="layer-row__status">Loading…</span>}
      {row.expanded && failure && !row.loading && (
        <span className="layer-row__status is-error">
          Couldn't load
          <button
            type="button"
            className="link"
            onClick={(e) => {
              e.stopPropagation();
              retryRow(screenId, row.id as NodeId);
            }}
          >
            Retry
          </button>
        </span>
      )}
    </div>
  );
}
