import { useState } from "react";
import { connectionFor } from "../connection/hub";
import { useApp } from "../state/store";
import { useDevFaults, type Fault } from "./faults";

/** Dev-only: triggers each failure path on demand. Not rendered in production builds. */
export function DevMenu() {
  const [open, setOpen] = useState(false);
  const latency = useDevFaults((s) => s.latency);
  const armed = useDevFaults((s) => s.armed);
  const active = useApp((s) => s.activeScreenId ?? s.screens?.[0]?.id ?? null);

  const arm = (f: Fault) => useDevFaults.getState().arm(f);
  const items: { label: string; hint: string; run: () => void; fault?: Fault }[] = [
    {
      label: "Fail GET /screens",
      hint: "Board region",
      run: () => {
        arm("screens");
        useDevFaults.setState((s) => ({ boardReloads: s.boardReloads + 1 }));
      },
    },
    {
      label: "Break preview connection",
      hint: "Active preview: navigates to a page with no agent, times out after 10s",
      run: () => active && useDevFaults.setState({ brokenPreview: active }),
    },
    {
      label: "Throw in next preview message",
      hint: "Active preview region",
      fault: "preview-message",
      run: () => arm("preview-message"),
    },
    {
      label: "Next row load times out",
      hint: "Expand a row in the active preview afterwards",
      run: () => active && connectionFor(active)?.command({ kind: "debug", delayNextChildrenMs: 4000 }),
    },
    { label: "Throw rendering layers", hint: "Layers region", fault: "layers-render", run: () => arm("layers-render") },
    { label: "Fail next details request", hint: "Select an element with a data-key", fault: "details", run: () => arm("details") },
    { label: "Throw rendering inspector", hint: "Inspector region", fault: "inspector-render", run: () => arm("inspector-render") },
    { label: "Throw in inspector timer", hint: "Inspector region, from a setTimeout", fault: "inspector-timer", run: () => arm("inspector-timer") },
    { label: "Throw on next V / I / Tab / Enter", hint: "Routed to the region the key acts on", fault: "key-handler", run: () => arm("key-handler") },
  ];

  return (
    <div className={`devmenu${open ? " is-open" : ""}`}>
      <button type="button" className="devmenu__toggle" onClick={() => setOpen(!open)}>
        Dev
      </button>
      {open && (
        <div className="devmenu__panel">
          <label className="devmenu__latency">
            API latency
            <input
              type="number"
              min={0}
              step={100}
              value={latency}
              onChange={(e) => useDevFaults.getState().setLatency(Number(e.target.value) || 0)}
            />
            ms
          </label>
          {items.map((item) => (
            <button
              type="button"
              key={item.label}
              className={`devmenu__item${item.fault && armed[item.fault] ? " is-armed" : ""}`}
              onClick={item.run}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
          <p className="devmenu__note">
            Page errors: page 1 "Watch demo" (Interact mode) throws; page 6 rejects a promise after 4s.
          </p>
        </div>
      )}
    </div>
  );
}
