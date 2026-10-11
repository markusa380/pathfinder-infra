import * as api from "./api";

const POLL_MS = 2000;
/** Lines kept in the log view. */
const LOG_LINES = 2000;

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

/** A button that lets the user pick a file and passes it to `upload`. */
function uploadButton(text: string, accept: string, errorEl: HTMLElement, upload: (file: File) => Promise<void>) {
  const input = h("input", { type: "file", accept, hidden: true });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    errorEl.hidden = true;
    try {
      await upload(file);
    } catch (error) {
      showError(errorEl, error);
    }
  });
  return h("label", { className: "button" }, text, input);
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
      detailEl.textContent = `since ${formatTime(state.since)}`;
      break;
    case "failed":
      detailEl.textContent = state.error;
      break;
    default:
      detailEl.textContent = "";
  }
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

function fileRow(file: api.FileInfo): HTMLTableRowElement {
  const modified = file.modified;
  const row = h(
    "tr",
    {},
    h(
      "td",
      {},
      h("a", { href: file.docs, target: "_blank", rel: "noreferrer" }, file.label),
      h("div", { className: "muted small" }, file.file_name),
    ),
    h("td", { className: "muted" }, modified !== null ? `Changed ${formatTime(modified)}` : "Not uploaded"),
    h(
      "td",
      { className: "actions" },
      modified !== null ? h("a", { className: "button secondary", href: api.fileUrl(file.id) }, "Download") : "",
      uploadButton("Upload…", "", filesError, async (content) => {
        row.replaceWith(fileRow(await api.putFile(file.id, content)));
      }),
    ),
  );
  return row;
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
  uploadButton("Upload preset…", ".html,text/html", modsetError, async (file) => {
    warningsEl.replaceChildren();
    const preset = await api.putModset(file);
    renderModset(preset);
    renderWarnings(preset);
  }),
);

async function poll() {
  await Promise.allSettled([refreshState(), refreshLog()]);
  setTimeout(poll, POLL_MS);
}

api.getModset().then(renderModset, (error) => showError(modsetError, error));
api.getFiles().then(
  (files) => filesEl.replaceChildren(...files.map(fileRow)),
  (error) => showError(filesError, error),
);
poll();
