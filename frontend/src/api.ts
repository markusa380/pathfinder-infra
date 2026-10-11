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

export interface FileInfo {
  id: string;
  label: string;
  file_name: string;
  docs: string;
  /** Unix time of the last change, null if not uploaded. */
  modified: number | null;
}

async function request<T>(method: string, path: string, body?: BodyInit): Promise<T> {
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
export const putModset = (html: Blob) => request<Preset>("PUT", "/api/modset", html);
export const getOutput = (after: number) => request<Lines>("GET", `/api/output?after=${after}`);
export const getFiles = () => request<FileInfo[]>("GET", "/api/files");
export const fileUrl = (id: string) => `/api/files/${encodeURIComponent(id)}`;
export const putFile = (id: string, content: Blob) => request<FileInfo>("PUT", fileUrl(id), content);

export interface Mission {
  name: string;
  size: number;
  /** Unix time of the last change. */
  modified: number;
}

export const getMissions = () => request<Mission[]>("GET", "/api/missions");
export const missionUrl = (name: string) => `/api/missions/${encodeURIComponent(name)}`;
export const putMission = (name: string, content: Blob) => request<Mission>("PUT", missionUrl(name), content);
export const deleteMission = (name: string) => request<void>("DELETE", missionUrl(name));
