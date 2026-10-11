import * as api from "./api";

const POLL_MS = 2000;
/// Lines kept in the output view.
const OUTPUT_LINES = 2000;

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing`);
  return el as T;
}

const stateEl = element("state");
const detailEl = element("detail");
const startButton = element<HTMLButtonElement>("start");
const stopButton = element<HTMLButtonElement>("stop");
const serverError = element("server-error");
const modsetSummary = element("modset-summary");
const presetInput = element<HTMLInputElement>("preset");
const modsetError = element("modset-error");
const warningsEl = element("warnings");
const modsEl = element("mods");
const outputEl = element("output");

function showError(el: HTMLElement, error: unknown) {
  el.textContent = error instanceof Error ? error.message : String(error);
  el.hidden = false;
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
      detailEl.textContent = `since ${new Date(state.since * 1000).toLocaleString()}`;
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
  modsEl.replaceChildren();
  if (!modset) {
    modsetSummary.textContent = "No preset yet. The server starts without mods.";
    return;
  }
  modsetSummary.textContent = `Preset “${modset.name}”, ${modset.mods.length} mods`;
  for (const mod of modset.mods) {
    const link = document.createElement("a");
    link.href = `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.id}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = mod.name;
    const item = document.createElement("li");
    item.append(link);
    modsEl.append(item);
  }
}

function renderWarnings(preset: api.Preset) {
  const warnings = [
    ...preset.local_mods.map((name) => `“${name}” is a local mod. The server can't download it, so it is left out.`),
    ...preset.dlcs.map((name) => `“${name}” is a DLC. The server doesn't load DLCs from presets.`),
  ];
  warningsEl.replaceChildren(
    ...warnings.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
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

let outputNext = 0;

async function refreshOutput() {
  const { lines, next } = await api.getOutput(outputNext);
  outputNext = next;
  if (lines.length === 0) return;
  const atBottom = outputEl.scrollTop + outputEl.clientHeight >= outputEl.scrollHeight - 4;
  const kept = (outputEl.textContent ?? "").split("\n").filter((line) => line !== "");
  outputEl.textContent = [...kept, ...lines].slice(-OUTPUT_LINES).join("\n") + "\n";
  if (atBottom) outputEl.scrollTop = outputEl.scrollHeight;
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

presetInput.addEventListener("change", async () => {
  const file = presetInput.files?.[0];
  presetInput.value = "";
  if (!file) return;
  modsetError.hidden = true;
  warningsEl.replaceChildren();
  try {
    const preset = await api.putModset(await file.text());
    renderModset(preset);
    renderWarnings(preset);
  } catch (error) {
    showError(modsetError, error);
  }
});

async function poll() {
  await Promise.allSettled([refreshState(), refreshOutput()]);
  setTimeout(poll, POLL_MS);
}

api.getModset().then(renderModset, (error) => showError(modsetError, error));
poll();
