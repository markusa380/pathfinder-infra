export type State =
  | { state: "stopped" }
  | { state: "updating"; step: string }
  | { state: "running"; since: number }
  | { state: "stopping" }
  | { state: "failed"; error: string };

export interface Mod {
  id: number;
  name: string;
}

export interface Modset {
  name: string;
  mods: Mod[];
}

export interface Preset extends Modset {
  local_mods: string[];
  dlcs: string[];
}

export interface Lines {
  lines: string[];
  next: number;
}

async function request<T>(method: string, path: string, body?: string): Promise<T> {
  const response = await fetch(path, body === undefined ? { method } : { method, body });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const getStatus = () => request<State>("GET", "/api/status");
export const start = () => request<void>("POST", "/api/start");
export const stop = () => request<void>("POST", "/api/stop");
export const getModset = () => request<Modset | null>("GET", "/api/modset");
export const putModset = (html: string) => request<Preset>("PUT", "/api/modset", html);
export const getOutput = (after: number) => request<Lines>("GET", `/api/output?after=${after}`);
