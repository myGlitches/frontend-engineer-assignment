import { API_ORIGIN } from "../config";
import { useDevFaults } from "../dev/faults";
import { BadResponseError } from "../failures/errors";

export interface Screen {
  id: string;
  name: string;
  url: string;
}

export interface ElementDetails {
  component: string;
  description: string;
  status: string;
  owner: string;
}

export type DetailsResult = { kind: "found"; details: ElementDetails } | { kind: "missing" };

async function getJson(path: string, signal: AbortSignal, failOnce: boolean): Promise<{ status: number; body: unknown }> {
  const { latency } = useDevFaults.getState();
  const params = new URLSearchParams();
  if (latency) params.set("latency", String(latency));
  if (failOnce) params.set("fail", "1");
  const qs = params.toString();
  const res = await fetch(`${API_ORIGIN}${path}${qs ? `?${qs}` : ""}`, { signal });
  const text = await res.text();
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new BadResponseError(`${path} returned ${res.status}`);
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    throw new BadResponseError(`${path} returned a malformed body`);
  }
}

const isString = (v: unknown): v is string => typeof v === "string";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function fetchScreens(signal: AbortSignal): Promise<Screen[]> {
  const { body, status } = await getJson("/screens", signal, useDevFaults.getState().consume("screens"));
  if (status === 404 || !Array.isArray(body)) throw new BadResponseError("/screens did not return a list");
  return body.map((s, i) => {
    if (!isRecord(s) || !isString(s.id) || !isString(s.name) || !isString(s.url)) {
      throw new BadResponseError(`/screens item ${i} is malformed`);
    }
    return { id: s.id, name: s.name, url: s.url };
  });
}

export async function fetchElementDetails(key: string, signal: AbortSignal): Promise<DetailsResult> {
  const path = `/elements/${encodeURIComponent(key)}`;
  const { body, status } = await getJson(path, signal, useDevFaults.getState().consume("details"));
  if (status === 404) return { kind: "missing" };
  if (!isRecord(body)) throw new BadResponseError(`${path} returned bad data`);
  const { component, description, status: st, owner } = body;
  if (![component, description, st, owner].every(isString)) throw new BadResponseError(`${path} returned bad data`);
  return { kind: "found", details: { component, description, status: st, owner } as ElementDetails };
}
