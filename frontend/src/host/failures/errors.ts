/** The user moved on: the work is no longer wanted. Never shown, never reported. */
export class Cancelled extends Error {
  constructor(reason = "cancelled") {
    super(reason);
    this.name = "Cancelled";
  }
}

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not answer within ${ms / 1000}s`);
    this.name = "TimeoutError";
  }
}

export class BadResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadResponseError";
  }
}

export function isCancellation(err: unknown): boolean {
  return err instanceof Cancelled || (err instanceof DOMException && err.name === "AbortError");
}

export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
}
