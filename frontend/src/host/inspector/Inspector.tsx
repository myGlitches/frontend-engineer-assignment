import { useEffect, useState } from "react";
import type { LiveProps } from "../../protocol/messages";
import { fetchElementDetails, type DetailsResult } from "../api/client";
import { useThrowWhileArmed, useDevFaults } from "../dev/faults";
import { Region, RegionError, useRegionScope } from "../failures/Region";
import { useApp } from "../state/store";

export function Inspector() {
  const screenId = useApp((s) => s.selection.screenId);
  return (
    <section className="panel inspector" aria-label="Inspector">
      <header className="panel__header">Inspector</header>
      <Region
        region={{ kind: "inspector", screenId }}
        fallback={({ message, retry }) => <RegionError title="The inspector crashed" message={message} retry={retry} />}
      >
        <InspectorBody />
      </Region>
    </section>
  );
}

const FIELDS: { label: string; get: (p: LiveProps) => string }[] = [
  { label: "Name", get: (p) => p.name },
  { label: "Tag", get: (p) => p.tag },
  { label: "ID", get: (p) => p.domId || "—" },
  { label: "Classes", get: (p) => p.classes || "—" },
  { label: "Size", get: (p) => `${p.width} × ${p.height}` },
  { label: "Position", get: (p) => `${p.pageX}, ${p.pageY}` },
  { label: "Text", get: (p) => p.text || "—" },
  { label: "Color", get: (p) => p.color },
  { label: "Background", get: (p) => p.background },
  { label: "Font", get: (p) => p.fontFamily },
  { label: "Font size", get: (p) => p.fontSize },
  { label: "Font weight", get: (p) => p.fontWeight },
];

function InspectorBody() {
  useThrowWhileArmed("inspector-render");
  const scope = useRegionScope();
  const selection = useApp((s) => s.selection);
  const lost = useApp((s) => s.selectionLost);
  const snapshots = useApp((s) => (s.selection.screenId ? s.geometry[s.selection.screenId] : undefined));
  const timerFault = useDevFaults((s) => !!s.armed["inspector-timer"]);

  useEffect(() => {
    if (!timerFault || !useDevFaults.getState().consume("inspector-timer")) return;
    scope.setTimeout(() => {
      throw new Error("Injected fault: inspector-timer");
    }, 0);
  }, [timerFault, scope]);

  if (selection.ids.length === 0) {
    return <div className="panel__empty">{lost ? "This element no longer exists" : "Select an element"}</div>;
  }

  const props = selection.ids.map((id) => snapshots?.[id]?.props);
  if (props.some((p) => !p)) return <div className="panel__empty">Reading element…</div>;
  const live = props as LiveProps[];

  if (live.length > 1) {
    return (
      <div className="inspector__body">
        <div className="inspector__title">{live.length} elements</div>
        <PropsTable rows={FIELDS.map((f) => [f.label, shared(live.map(f.get))])} />
      </div>
    );
  }

  const p = live[0];
  const screenId = selection.screenId!;
  return (
    <div className="inspector__body">
      <div className="inspector__title">{p.name}</div>
      <h3 className="inspector__section">Live</h3>
      <PropsTable rows={FIELDS.map((f) => [f.label, f.get(p)])} swatches />
      <h3 className="inspector__section">Details</h3>
      {p.dataKey === null ? (
        <div className="muted">No details</div>
      ) : (
        <Region
          key={`${selection.ids[0]}:${p.dataKey}`}
          region={{ kind: "details", screenId, elementKey: p.dataKey }}
          clearOnUnmount
          fallback={({ message, retry }) => (
            <RegionError title="Couldn't load details" message={message} retry={retry} />
          )}
        >
          <Details elementKey={p.dataKey} />
        </Region>
      )}
    </div>
  );
}

function shared(values: string[]): string {
  return values.every((v) => v === values[0]) ? values[0] : "Mixed";
}

function PropsTable({ rows, swatches }: { rows: [string, string][]; swatches?: boolean }) {
  return (
    <dl className="props">
      {rows.map(([label, value]) => (
        <div className="props__row" key={label}>
          <dt>{label}</dt>
          <dd>
            {swatches && (label === "Color" || label === "Background") && (
              <span className="swatch" style={{ background: value }} />
            )}
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Mounted per selected element, so a selection change unmounts it, which
 * disposes its scope and aborts the request. Only the latest selection's
 * response can ever render, and the aborted one is never reported.
 */
function Details({ elementKey }: { elementKey: string }) {
  const scope = useRegionScope();
  const [result, setResult] = useState<DetailsResult | null>(null);

  useEffect(() => {
    scope.settle(fetchElementDetails(elementKey, scope.signal), setResult);
  }, [scope, elementKey]);

  if (!result) return <div className="muted">Loading…</div>;
  if (result.kind === "missing") return <div className="muted">No details for this element</div>;
  const d = result.details;
  return (
    <PropsTable
      rows={[
        ["Component", d.component],
        ["Description", d.description],
        ["Status", d.status],
        ["Owner", d.owner],
      ]}
    />
  );
}
