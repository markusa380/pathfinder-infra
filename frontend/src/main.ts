import * as api from "./api";

const POLL_MS = 2000;
/** Lines kept in the log view. */
const LOG_LINES = 2000;
const TABS = ["server", "mods", "missions", "config"] as const;

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing`);
  return el as T;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
}

const stateEl = element("state");
const detailEl = element("detail");
const startButton = element<HTMLButtonElement>("start");
const stopButton = element<HTMLButtonElement>("stop");
const serverError = element("server-error");
const modsetSummary = element("modset-summary");
const modsetError = element("modset-error");
const warningsEl = element("warnings");
const modsEl = element("mods");
const missionsEl = element("missions");
const missionsEmpty = element("missions-empty");
const missionsError = element("missions-error");
const filesEl = element("files");
const filesError = element("files-error");
const logEl = element("log");

function showError(el: HTMLElement, error: unknown) {
  el.textContent = error instanceof Error ? error.message : String(error);
  el.hidden = false;
}

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`;
}

function showTab() {
  const tab = TABS.find((t) => location.hash === `#${t}`) ?? "server";
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    panel.hidden = panel.dataset.panel !== tab;
  }
  for (const link of document.querySelectorAll<HTMLElement>("[data-tab]")) {
    link.classList.toggle("active", link.dataset.tab === tab);
  }
  if (tab === "server") logEl.scrollTop = logEl.scrollHeight;
}

/**
 * A button that lets the user pick files and passes each to `upload`. An
 * error for one file doesn't stop the others.
 */
function uploadButton(
  text: string,
  errorEl: HTMLElement,
  upload: (file: File) => Promise<void>,
  options: { accept?: string; multiple?: boolean } = {},
) {
  const input = h("input", { type: "file", accept: options.accept ?? "", multiple: options.multiple ?? false, hidden: true });
  input.addEventListener("change", async () => {
    const files = [...(input.files ?? [])];
    input.value = "";
    errorEl.hidden = true;
    const errors: string[] = [];
    for (const file of files) {
      try {
        await upload(file);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(files.length > 1 ? `${file.name}: ${message}` : message);
      }
    }
    if (errors.length > 0) showError(errorEl, errors.join("\n"));
  });
  return h("label", { className: "button" }, text, input);
}

interface FileRow {
  title: Node | string;
  subtitle: string;
  /** Unix time of the last change, null if the file doesn't exist. */
  modified: number | null;
  downloadUrl: string;
  errorEl: HTMLElement;
  upload?: (file: File) => Promise<void>;
  remove?: () => Promise<void>;
}

/** A row of a file table: name, date, and the actions for the file. */
function fileRow(file: FileRow): HTMLTableRowElement {
  const exists = file.modified !== null;
  const actions: (Node | string)[] = [];
  if (exists) actions.push(h("a", { className: "button secondary", href: file.downloadUrl }, "Download"));
  if (file.upload) actions.push(uploadButton("Upload…", file.errorEl, file.upload));
  if (file.remove) {
    const remove = file.remove;
    const button = h("button", { className: "secondary danger" }, "Delete");
    button.addEventListener("click", async () => {
      file.errorEl.hidden = true;
      try {
        await remove();
      } catch (error) {
        showError(file.errorEl, error);
      }
    });
    actions.push(button);
  }
  return h(
    "tr",
    {},
    h("td", {}, file.title, h("div", { className: "muted small" }, file.subtitle)),
    h("td", { className: "muted" }, file.modified !== null ? `Changed ${formatTime(file.modified)}` : "Not uploaded"),
    h("td", { className: "actions" }, ...actions),
  );
}

function configRow(file: api.FileInfo): HTMLTableRowElement {
  const row = fileRow({
    title: h("a", { href: file.docs, target: "_blank", rel: "noreferrer" }, file.label),
    subtitle: file.file_name,
    modified: file.modified,
    downloadUrl: api.fileUrl(file.id),
    errorEl: filesError,
    upload: async (content) => {
      row.replaceWith(configRow(await api.putFile(file.id, content)));
    },
  });
  return row;
}

function missionRow(mission: api.Mission): HTMLTableRowElement {
  return fileRow({
    title: mission.name,
    subtitle: formatSize(mission.size),
    modified: mission.modified,
    downloadUrl: api.missionUrl(mission.name),
    errorEl: missionsError,
    remove: async () => {
      if (!confirm(`Delete the mission ${mission.name}?`)) return;
      await api.deleteMission(mission.name);
      await refreshMissions();
    },
  });
}

async function refreshMissions() {
  try {
    const missions = await api.getMissions();
    missionsEl.replaceChildren(...missions.map(missionRow));
    missionsEmpty.hidden = missions.length > 0;
  } catch (error) {
    showError(missionsError, error);
  }
}

function renderState(state: api.State) {
  const labels: Record<api.State["state"], string> = {
    stopped: "Stopped",
    updating: "Updating",
    running: "Running",
    stopping: "Stopping",
    failed: "Failed",
  };
  stateEl.textContent = labels[state.state];
  stateEl.className = `badge ${state.state}`;
  switch (state.state) {
    case "updating":
      detailEl.textContent = state.step;
      break;
    case "running":
      detailEl.textContent = `Running since ${formatTime(state.since)}`;
      break;
    case "failed":
      detailEl.textContent = state.error;
      break;
    default:
      detailEl.textContent = labels[state.state];
  }
  stateEl.title = detailEl.textContent;
  const stopped = state.state === "stopped" || state.state === "failed";
  startButton.disabled = !stopped;
  stopButton.disabled = stopped || state.state === "stopping";
}

function renderModset(modset: api.Modset | null) {
  if (!modset) {
    modsetSummary.textContent = "No preset yet. The server starts without mods.";
    modsEl.replaceChildren();
    return;
  }
  modsetSummary.textContent = `Preset “${modset.name}”, ${modset.mods.length} mods`;
  modsEl.replaceChildren(
    ...modset.mods.map((mod) =>
      h(
        "li",
        {},
        h(
          "a",
          {
            href: `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.id}`,
            target: "_blank",
            rel: "noreferrer",
          },
          mod.name,
        ),
      ),
    ),
  );
}

function renderWarnings(preset: api.Preset) {
  warningsEl.replaceChildren(
    ...preset.local_mods.map((name) => h("li", {}, `“${name}” is a local mod. The server can't download it, so it is left out.`)),
    ...preset.dlcs.map((name) => h("li", {}, `“${name}” is a DLC. The server doesn't load DLCs from presets.`)),
  );
}

async function refreshState() {
  try {
    renderState(await api.getStatus());
  } catch (error) {
    stateEl.textContent = "Unreachable";
    stateEl.className = "badge failed";
    detailEl.textContent = error instanceof Error ? error.message : "";
  }
}

function lineKind(line: string): string {
  if (/\berror\b/i.test(line)) return "error";
  if (/\bwarning\b/i.test(line)) return "warning";
  return "";
}

let logNext = 0;

async function refreshLog() {
  const { lines, next } = await api.getOutput(logNext);
  logNext = next;
  if (lines.length === 0) return;
  const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 4;
  logEl.append(...lines.map((line) => h("div", { className: lineKind(line) }, line)));
  while (logEl.childElementCount > LOG_LINES) logEl.firstElementChild?.remove();
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}

async function control(action: () => Promise<void>) {
  serverError.hidden = true;
  try {
    await action();
  } catch (error) {
    showError(serverError, error);
  }
  await refreshState();
}

startButton.addEventListener("click", () => control(api.start));
stopButton.addEventListener("click", () => control(api.stop));

element("preset-upload").append(
  uploadButton(
    "Upload preset…",
    modsetError,
    async (file) => {
      warningsEl.replaceChildren();
      const preset = await api.putModset(file);
      renderModset(preset);
      renderWarnings(preset);
    },
    { accept: ".html,text/html" },
  ),
);

element("mission-upload").append(
  uploadButton(
    "Upload missions…",
    missionsError,
    async (file) => {
      await api.putMission(file.name, file);
      await refreshMissions();
    },
    { accept: ".pbo", multiple: true },
  ),
);

async function poll() {
  await Promise.allSettled([refreshState(), refreshLog()]);
  setTimeout(poll, POLL_MS);
}

window.addEventListener("hashchange", showTab);
showTab();
api.getModset().then(renderModset, (error) => showError(modsetError, error));
api.getFiles().then(
  (files) => filesEl.replaceChildren(...files.map(configRow)),
  (error) => showError(filesError, error),
);
refreshMissions();
poll();
