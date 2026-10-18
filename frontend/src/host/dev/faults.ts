import { create } from "zustand";
import { useFailures } from "../failures/regions";

/** One-shot faults armed from the dev menu and consumed by the code they break. */
export type Fault =
  | "screens"
  | "details"
  | "inspector-render"
  | "inspector-timer"
  | "layers-render"
  | "preview-message"
  | "key-handler";

interface DevFaults {
  latency: number;
  boardReloads: number;
  brokenPreview: string | null;
  armed: Partial<Record<Fault, true>>;
  arm: (fault: Fault) => void;
  consume: (fault: Fault) => boolean;
  setLatency: (ms: number) => void;
}

export const useDevFaults = create<DevFaults>((set, get) => ({
  latency: 0,
  boardReloads: 0,
  brokenPreview: null,
  armed: {},
  arm: (fault) => set((s) => ({ armed: { ...s.armed, [fault]: true } })),
  consume: (fault) => {
    if (!get().armed[fault]) return false;
    set((s) => {
      const armed = { ...s.armed };
      delete armed[fault];
      return { armed };
    });
    return true;
  },
  setLatency: (latency) => set({ latency }),
}));

const PREFIX = "Injected fault: ";

export function throwIfArmed(fault: Fault) {
  if (useDevFaults.getState().consume(fault)) throw new Error(PREFIX + fault);
}

/**
 * React replays a failed render once before giving up, so a one-shot fault
 * would be spent on the first attempt and the replay would succeed. Render
 * faults therefore keep throwing until the failure is recorded.
 */
export function useThrowWhileArmed(fault: Fault) {
  const armed = useDevFaults((s) => !!s.armed[fault]);
  if (armed) throw new Error(PREFIX + fault);
}

useFailures.subscribe((s) => {
  const armed = useDevFaults.getState().armed;
  for (const f of Object.values(s.failures)) {
    if (!f.message.startsWith(PREFIX)) continue;
    const fault = f.message.slice(PREFIX.length) as Fault;
    if (armed[fault]) useDevFaults.getState().consume(fault);
  }
});
