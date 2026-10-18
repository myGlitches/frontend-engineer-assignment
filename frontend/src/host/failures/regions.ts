import { create } from "zustand";
import { report } from "../../../report.js";
import { isCancellation, toError } from "./errors";

export type RegionKind = "board" | "preview" | "layers" | "layers-row" | "details" | "inspector";

export interface RegionRef {
  kind: RegionKind;
  screenId: string | null;
  /** Disambiguates per-row regions inside one preview's layers panel. */
  rowId?: string;
  elementKey?: string;
}

export interface RegionFailure {
  ref: RegionRef;
  message: string;
}

export function regionKey(ref: RegionRef): string {
  return `${ref.kind}:${ref.screenId ?? "-"}:${ref.rowId ?? ""}:${ref.elementKey ?? ""}`;
}

/**
 * The only place failures are recorded and reported. A region that is already
 * failed swallows further errors until it is retried, so a cascade inside one
 * region (a render error followed by an effect error, say) is one failure.
 */
export const useFailures = create<{ failures: Record<string, RegionFailure> }>(() => ({ failures: {} }));

export function raise(ref: RegionRef, err: unknown): void {
  if (isCancellation(err)) return;
  const key = regionKey(ref);
  if (useFailures.getState().failures[key]) return;
  const error = toError(err);
  useFailures.setState((s) => ({ failures: { ...s.failures, [key]: { ref, message: error.message } } }));
  const context: { region: RegionKind; screenId: string | null; elementKey?: string } = {
    region: ref.kind,
    screenId: ref.screenId,
  };
  if (ref.elementKey) context.elementKey = ref.elementKey;
  report(error, context);
}

export function clearFailure(ref: RegionRef): void {
  const key = regionKey(ref);
  if (!useFailures.getState().failures[key]) return;
  useFailures.setState((s) => {
    const next = { ...s.failures };
    delete next[key];
    return { failures: next };
  });
}

export function clearFailuresWhere(match: (ref: RegionRef) => boolean): void {
  const entries = Object.entries(useFailures.getState().failures).filter(([, f]) => !match(f.ref));
  useFailures.setState({ failures: Object.fromEntries(entries) });
}

/**
 * The lifetime of one attempt at a region's work. Every entry point into the
 * region (handlers, timers, message callbacks, response continuations) goes
 * through a scope, so an error anywhere becomes the same region failure, and
 * anything that arrives after the scope is disposed is dropped silently.
 */
export class RegionScope {
  private readonly controller = new AbortController();
  private readonly timers = new Set<number>();
  private disposed = false;

  constructor(readonly ref: RegionRef) {}

  get alive(): boolean {
    return !this.disposed;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  run<T>(fn: () => T): T | undefined {
    if (this.disposed) return undefined;
    try {
      return fn();
    } catch (err) {
      this.fail(err);
      return undefined;
    }
  }

  wrap<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
    return (...args) => {
      this.run(() => fn(...args));
    };
  }

  setTimeout(fn: () => void, ms: number): () => void {
    const handle = window.setTimeout(() => {
      this.timers.delete(handle);
      this.run(fn);
    }, ms);
    this.timers.add(handle);
    return () => {
      window.clearTimeout(handle);
      this.timers.delete(handle);
    };
  }

  /** Runs `onValue` with the result if the scope is still alive; routes rejections to the region. */
  settle<T>(promise: Promise<T>, onValue: (value: T) => void): void {
    promise.then(
      (value) => this.run(() => onValue(value)),
      (err) => this.fail(err),
    );
  }

  fail(err: unknown): void {
    if (this.disposed) return;
    raise(this.ref, err);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
  }
}
