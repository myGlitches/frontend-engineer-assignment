import { Component, createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearFailure, raise, regionKey, RegionScope, useFailures, type RegionRef } from "./regions";

const ScopeContext = createContext<RegionScope | null>(null);

export function useRegionScope(): RegionScope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("useRegionScope must be used inside <Region>");
  return scope;
}

interface RegionProps {
  region: RegionRef;
  /** Rendered instead of the children while the region is failed. */
  fallback: (failure: { message: string; retry: () => void }) => ReactNode;
  onRetry?: () => void;
  /** Forget the failure when the region goes away, so a later mount starts clean. */
  clearOnUnmount?: boolean;
  children: ReactNode;
}

/**
 * A failure boundary. Render errors (via the error boundary below) and
 * errors raised through the region's scope (handlers, timers, async work)
 * converge on the same failure record, so they render and report the same way.
 * Retry discards the scope, which cancels everything in flight, and mounts
 * the children fresh.
 */
export function Region({ region, fallback, onRetry, clearOnUnmount, children }: RegionProps) {
  const key = regionKey(region);
  const failure = useFailures((s) => s.failures[key]);
  const [attempt, setAttempt] = useState(0);
  const scope = useMemo(() => new RegionScope(region), [key, attempt]);

  useEffect(() => () => scope.dispose(), [scope]);
  useEffect(() => (clearOnUnmount ? () => clearFailure(region) : undefined), [key]);

  const retry = () => {
    scope.dispose();
    clearFailure(region);
    setAttempt((n) => n + 1);
    onRetry?.();
  };

  if (failure) return <>{fallback({ message: failure.message, retry })}</>;
  return (
    <ScopeContext.Provider value={scope}>
      <RenderBoundary key={attempt} scope={scope}>
        {children}
      </RenderBoundary>
    </ScopeContext.Provider>
  );
}

class RenderBoundary extends Component<{ scope: RegionScope; children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    raise(this.props.scope.ref, error);
  }

  render() {
    return this.state.crashed ? null : this.props.children;
  }
}

export function RegionError({ message, retry, title }: { message: string; retry: () => void; title: string }) {
  return (
    <div className="region-error" role="alert">
      <div className="region-error__title">{title}</div>
      <div className="region-error__message">{message}</div>
      <button type="button" className="btn" onClick={retry}>
        Retry
      </button>
    </div>
  );
}
