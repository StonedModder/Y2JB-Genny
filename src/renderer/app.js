const y2jbApi = window.y2jb;

const state = {
  activeProject: null,
  payloads: [],
  thumbnailDataUrl: null,
  payloadSources: [],
  recentProjects: [],
  environment: {},
  settings: {},
  buildLog: "",
  busy: false,
  dirty: false,
  showWelcome: true,
  settingsOpen: false,
  payloadLibraryOpen: false,
  lookEditorOpen: false,
  sourceInfoId: null,
  readmePromptOpen: false,
  clearSourcesPromptOpen: false,
  updatePrompt: null,
  lastBuildOutputPath: null,
  newSourceName: "",
  newSourceUrl: "",
  payloadSearch: "",
  payloadPage: 0,
  progress: {
    label: "Idle",
    detail: "No job running.",
    percent: 0
  }
};

const entryTypes = [
  { value: "payload", label: "Payload" },
  { value: "delay", label: "Delay" },
  { value: "message", label: "Message" }
];

const lookPresets = window.Y2JBGENNY_LOOK_PRESETS || [];
const defaultLookTheme = lookPresets[0]?.theme || {
  titleText: "Y2JB Autoloader",
  versionText: "v0.6.3-e655073",
  creditText: "StonedModder",
  loaderText: "Y2Genny",
  protocolTitleText: "Y2JB // Y2Genny",
  protocolDetailText: "Y2JB Autoloader v0.6.3-e655073 by PLK // Offline PS5 Exploit Chain",
  layoutId: "y2-cyberpunk",
  bgColor: "#060810",
  titleColor: "#fcee0a",
  logBgColor: "#060810",
  borderColor: "#fcee0a",
  progressBgColor: "#080b14",
  progressBarColor: "#ff2a6d",
  progressTextColor: "#fcee0a",
  footerColor: "#00f0ff",
  logInfoColor: "#00f0ff",
  logSuccessColor: "#43ff83",
  logErrorColor: "#ff2a6d",
  logWarningColor: "#fcee0a"
};

const lookColorControls = [
  ["bgColor", "Screen background"],
  ["titleColor", "Title text"],
  ["logBgColor", "Log box"],
  ["borderColor", "Borders"],
  ["progressBgColor", "Progress track"],
  ["progressBarColor", "Progress fill"],
  ["progressTextColor", "Progress text"],
  ["footerColor", "Footer"],
  ["logInfoColor", "Log info"],
  ["logSuccessColor", "Log success"],
  ["logErrorColor", "Log error"],
  ["logWarningColor", "Log warning"]
];

const app = document.getElementById("app");
const sourceAutosaveTimers = new Map();
const autoUpdateCheckedProjects = new Set();
let actionSequence = 0;

function focusSnapshot() {
  const element = document.activeElement;
  if (!element || !app.contains(element)) return null;
  if (!["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) return null;

  const selectorParts = [];
  for (const attr of [
    "data-field",
    "data-look-field",
    "data-entry-value",
    "data-entry-type",
    "data-payload-search",
    "data-source-name",
    "data-source-url",
    "data-source-note",
    "data-source-version"
  ]) {
    if (element.hasAttribute(attr)) {
      const value = element.getAttribute(attr);
      selectorParts.push(value === "" ? `[${attr}]` : `[${attr}="${CSS.escape(value)}"]`);
    }
  }
  if (!selectorParts.length) return null;

  return {
    selector: `${element.tagName.toLowerCase()}${selectorParts.join("")}`,
    start: typeof element.selectionStart === "number" ? element.selectionStart : null,
    end: typeof element.selectionEnd === "number" ? element.selectionEnd : null
  };
}

function restoreFocus(snapshot) {
  if (!snapshot) return;
  const element = app.querySelector(snapshot.selector);
  if (!element) return;
  element.focus({ preventScroll: true });
  if (snapshot.start !== null && typeof element.setSelectionRange === "function") {
    const length = String(element.value || "").length;
    element.setSelectionRange(Math.min(snapshot.start, length), Math.min(snapshot.end ?? snapshot.start, length));
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lookTheme() {
  const theme = { ...defaultLookTheme, ...(state.activeProject?.lookTheme || {}) };
  if (theme.versionText === "v0.5") theme.versionText = defaultLookTheme.versionText;
  return theme;
}

function setProgress(label, detail, percent) {
  state.progress = {
    label,
    detail,
    percent: Math.max(0, Math.min(100, percent))
  };
}

function progressFromLogLine(line) {
  const match = String(line || "").trim().match(/^\[(\d{1,3})%\]\s*([^:]+):\s*(.*)$/);
  if (!match) return null;
  return {
    percent: Number(match[1]),
    label: match[2].trim(),
    detail: match[3].trim()
  };
}

function setBusy(value, progress) {
  state.busy = value;
  if (progress) setProgress(progress.label, progress.detail, progress.percent);
  if (!value && !progress) setProgress("Idle", "No job running.", 0);
  render();
}

function applyAccent(accent) {
  const value = accent || "#fcee0a";
  document.documentElement.style.setProperty("--cp-yellow", value);
  document.documentElement.style.setProperty("--card-accent", value);
  document.documentElement.style.setProperty("--theme-accent", value);
}

function mutateProject(mutator) {
  if (!state.activeProject) return;
  mutator(state.activeProject);
  state.dirty = true;
  render();
}

function applyPayload(payload, options = {}) {
  if (!payload) return;
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  const payloadSources = Array.isArray(payload.payloadSources)
    ? payload.payloadSources
    : Array.isArray(payload.db?.payloadSources)
      ? payload.db.payloadSources
      : state.payloadSources;

  if (options.applyProject !== false && hasOwn("activeProject")) {
    const incoming = payload.activeProject;
    if (options.preserveAutoload && state.activeProject && incoming && state.activeProject.id === incoming.id) {
      state.activeProject = { ...incoming, autoload: state.activeProject.autoload };
    } else {
      state.activeProject = incoming;
    }
  }
  if (options.applyProject !== false && hasOwn("payloads")) state.payloads = payload.payloads || [];
  if (options.applyProject !== false && hasOwn("thumbnailDataUrl")) state.thumbnailDataUrl = payload.thumbnailDataUrl || null;
  state.payloadSources = payloadSources || [];
  if (hasOwn("recentProjects")) state.recentProjects = payload.recentProjects || [];
  if (hasOwn("environment")) state.environment = payload.environment || {};
  if (hasOwn("settings")) state.settings = payload.settings || {};
  if (hasOwn("lastBuildOutputPath")) state.lastBuildOutputPath = payload.lastBuildOutputPath || null;
  if (hasOwn("updateSummary")) {
    const summary = payload.updateSummary;
    state.updatePrompt = summary && (summary.checked?.length || summary.failed?.length) ? summary : null;
  }
  if (options.applyProject !== false && !options.preserveAutoload) state.dirty = false;
  render();
}

function switchToProject(payload) {
  if (payload?.canceled) return;
  applyPayload(payload);
  state.payloadSearch = "";
  state.payloadPage = 0;
  if (state.activeProject) state.showWelcome = false;
  render();
  maybeCheckInstalledPayloadUpdates();
}

async function runAction(action, progress = { label: "Working", detail: "Running action.", percent: 18 }, options = {}) {
  if (state.busy && !options.allowWhileBusy) return;
  const sequence = ++actionSequence;
  try {
    setBusy(true, progress);
    const payload = await action();
    if (sequence !== actionSequence) return;
    if (!options.preserveProgress) setProgress("Finishing", "Refreshing GUI state.", 92);
    if (payload) applyPayload(payload, options);
    if (!options.preserveProgress) setProgress("Done", "Last action finished.", 100);
  } catch (error) {
    state.buildLog += `\nERROR: ${error.message || error}`;
    setProgress("Failed", error.message || String(error), 100);
    render();
  } finally {
    setBusy(false, options.preserveProgress || state.progress.label === "Failed" ? state.progress : undefined);
  }
}

async function maybeCheckInstalledPayloadUpdates() {
  const project = state.activeProject;
  if (
    !project
    || state.settings.autoCheckUpdates === false
    || !state.payloads.length
    || autoUpdateCheckedProjects.has(project.id)
  ) return;
  autoUpdateCheckedProjects.add(project.id);

  try {
    setProgress("Checking updates", "Looking for newer versions of payloads already in this build.", 18);
    render();
    const payload = await y2jbApi.checkInstalledPayloadUpdates(project.id);
    const updateSummary = payload?.updateSummary || null;
    if (payload) applyPayload(payload, { preserveAutoload: true });
    if (updateSummary && (updateSummary.checked?.length || updateSummary.failed?.length)) {
      state.updatePrompt = updateSummary;
      setProgress(
        updateSummary.updates?.length ? "Updates found" : "Payloads checked",
        updateSummary.updates?.length ? `${updateSummary.updates.length} source(s) have newer versions.` : "No tracked payload updates found.",
        100
      );
      render();
      return;
    }
    setProgress("Payloads checked", "No tracked payload sources matched the files in this build.", 100);
    render();
  } catch (error) {
    state.buildLog += `\nERROR: ${error.message || error}`;
    setProgress("Update check failed", error.message || String(error), 100);
    render();
  }
}

function projectPayload() {
  return JSON.parse(JSON.stringify(state.activeProject));
}

function updateEntry(index, patch) {
  mutateProject((project) => {
    project.autoload[index] = { ...project.autoload[index], ...patch };
  });
}

function addEntry(type = "payload", value = "") {
  mutateProject((project) => {
    project.autoload.push({
      id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      value
    });
  });
}

function removeEntry(index) {
  mutateProject((project) => {
    project.autoload.splice(index, 1);
  });
}

function moveEntry(index, direction) {
  mutateProject((project) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= project.autoload.length) return;
    const [entry] = project.autoload.splice(index, 1);
    project.autoload.splice(nextIndex, 0, entry);
  });
}

function validateProject(project) {
  if (!project) return ["Create or open a workspace first."];
  const errors = [];
  if (!project.workspacePath) errors.push("Workspace path is required.");
  if (!project.discLabel) errors.push("Update ZIP name is required.");
  if (!project.discVersion) errors.push("Disc version is required.");
  for (const [index, entry] of project.autoload.entries()) {
    if (!entry.value || !String(entry.value).trim()) errors.push(`Autoload row ${index + 1} is empty.`);
    if (entry.type === "delay" && !/^\d+$/.test(String(entry.value).trim())) {
      errors.push(`Delay row ${index + 1} must be milliseconds.`);
    }
  }
  return errors;
}

function environmentPill(label, ok) {
  return `<span class="pill ${ok ? "ok" : "warn"}"><span></span>${label}</span>`;
}

function normalizePayloadPath(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function sourceForPayload(payload) {
  const normalizedPayload = normalizePayloadPath(payload);
  const payloadBase = normalizedPayload.split("/").pop();
  return (state.payloadSources || []).find((source) => {
    return (source.installedFiles || []).some((file) => {
      const normalizedFile = normalizePayloadPath(file);
      return normalizedFile === normalizedPayload || normalizedFile.split("/").pop() === payloadBase;
    });
  }) || null;
}

function renderFolderPayload(payload) {
  const source = sourceForPayload(payload);
  const localVersion = source?.installedVersion || "unknown";
  const latestRelease = source?.releases?.[0];
  const latestVersion = latestRelease?.tag || latestRelease?.name || null;
  const updateAvailable = Boolean(source?.updateAvailable);
  const status = source
    ? updateAvailable ? "Update available" : "Tracked"
    : "Untracked";

  return `
    <button class="folder-payload ${updateAvailable ? "needs-update" : source ? "tracked" : "untracked"}" data-add-existing="${escapeHtml(payload)}" title="Add ${escapeHtml(payload)} to autoload.txt">
      <span class="folder-payload-main">
        <strong>${escapeHtml(payload)}</strong>
        <em>${escapeHtml(source?.name || "No library source matched")}</em>
      </span>
      <span class="folder-payload-meta">
        <b>${escapeHtml(status)}</b>
        <small>Local: ${escapeHtml(localVersion)}${latestVersion ? ` | Latest: ${escapeHtml(latestVersion)}` : ""}</small>
      </span>
    </button>
  `;
}

function renderFolderPayloadGroup(payloads) {
  const source = sourceForPayload(payloads[0]);
  const baseName = normalizePayloadPath(payloads[0]).split("/").pop();
  const localVersion = source?.installedVersion || "unknown";
  const latestRelease = source?.releases?.[0];
  const latestVersion = latestRelease?.tag || latestRelease?.name || null;
  const updateAvailable = Boolean(source?.updateAvailable);
  const status = source
    ? updateAvailable ? "Update available" : "Tracked"
    : "Untracked";

  return `
    <div class="folder-payload folder-payload--group ${updateAvailable ? "needs-update" : source ? "tracked" : "untracked"}">
      <span class="folder-payload-main">
        <strong>${escapeHtml(baseName)}</strong>
        <em>${escapeHtml(source?.name || "No library source matched")} &mdash; ${payloads.length} copies</em>
      </span>
      <span class="folder-payload-meta">
        <b>${escapeHtml(status)}</b>
        <small>Local: ${escapeHtml(localVersion)}${latestVersion ? ` | Latest: ${escapeHtml(latestVersion)}` : ""}</small>
      </span>
      <div class="folder-payload-version-row">
        <select class="folder-payload-version-select" title="Choose which copy to add">
          ${payloads.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
        </select>
        <button class="folder-payload-add-btn" data-add-group title="Add selected copy to payload order">Add</button>
      </div>
    </div>
  `;
}

function renderFolderPayloadList(payloads) {
  if (!payloads.length) return `<p>No payloads copied yet.</p>`;
  const groups = new Map();
  for (const payload of payloads) {
    const key = normalizePayloadPath(payload).split("/").pop();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(payload);
  }
  return [...groups.values()]
    .map((group) => group.length === 1 ? renderFolderPayload(group[0]) : renderFolderPayloadGroup(group))
    .join("");
}

const PAYLOAD_PAGE_SIZE = 6;

function getFilteredPayloads() {
  const search = state.payloadSearch.trim().toLowerCase();
  if (!search) return state.payloads;
  return state.payloads.filter((p) => p.toLowerCase().includes(search));
}

function getPagedPayloads() {
  const filtered = getFilteredPayloads();
  const start = state.payloadPage * PAYLOAD_PAGE_SIZE;
  return filtered.slice(start, start + PAYLOAD_PAGE_SIZE);
}

function renderEmpty() {
  const recentProjects = state.recentProjects || [];
  return `
    <main class="empty-state">
      <div class="brand-block">
        <div class="mark">Y2</div>
        <div>
          <h1 class="cyber-heading cyber-glitch cyber-glitch--subtle" data-text="y2JBGenny">y2JBGenny</h1>
          <p>Make focused Y2JB update packs for the community.</p>
        </div>
      </div>
      <div class="builder-options builder-options--single">
        <button class="builder-option primary cyber-button" data-action="create">
          <strong>Create Y2JB Update</strong>
          <span>Start from the bundled Y2JB update template and cyberpunk theme.</span>
        </button>
      </div>
      <div class="start-actions">
        <button class="cyber-button" data-action="open">Open existing folder</button>
        ${state.activeProject ? `<button class="cyber-button" data-action="continue">Continue last update</button>` : ""}
      </div>
      ${recentProjects.length ? `
        <section class="recent-projects" aria-label="Recent projects">
          <div class="recent-projects-title">
            <span>Recent Y2JB updates</span>
            <small>${recentProjects.length} saved</small>
          </div>
          <div class="recent-project-list">
            ${recentProjects.map((project) => `
              <button class="recent-project" data-open-project="${escapeHtml(project.id)}">
                <strong>${escapeHtml(project.name || "Untitled update")}</strong>
                <span>Y2JB | ${escapeHtml(project.workspacePath || "")}</span>
              </button>
            `).join("")}
          </div>
        </section>
      ` : ""}
      <div class="creator-link">
        <span class="x-logo">X</span>
        <button data-action="creator-link">@StonedModder</button>
      </div>
    </main>
  `;
}

function renderProject() {
  const project = state.activeProject;
  const errors = validateProject(project);
  const autoload = project.autoload || [];
  const isY2 = true;
  const autoloadText = autoload
    .map((entry) => {
      if (entry.type === "delay") return `!${entry.value}`;
      if (entry.type === "message") return `@ ${entry.value}`;
      return entry.value;
    })
    .join("\n");

  return `
    <header class="topbar">
      <div class="brand">
        <div class="mark small">Y2</div>
        <div>
          <h1 class="cyber-glitch cyber-glitch--subtle" data-text="y2JBGenny">y2JBGenny</h1>
          <p>${escapeHtml(project.workspacePath)}</p>
        </div>
      </div>
      <div class="env">
        ${environmentPill("Template", state.environment.templateFound)}
        ${environmentPill("Native ZIP", state.environment.zipFound)}
        <button data-action="home">Home</button>
        <button data-action="reveal">Open Project Folder</button>
        <button class="icon-button" title="Settings" data-action="settings">&#9881;</button>
        <button class="primary" data-action="save" ${state.busy ? "disabled" : ""}>${state.dirty ? "Save it" : "Saved"}</button>
        <button class="primary" data-action="build" ${state.busy || errors.length ? "disabled" : ""}>Build Update ZIP</button>
        ${state.lastBuildOutputPath ? `<button data-action="reveal-build-output">ZIP Folder</button>` : ""}
        ${state.lastBuildOutputPath && isY2 ? `<button class="primary" data-action="copy-to-usb">Copy to USB</button>` : ""}
      </div>
    </header>

    <main class="layout">
      <section class="panel cyber-card cyber-card--holo project-panel">
        <div class="panel-title">
          <span>Build folder</span>
          <strong>${escapeHtml(project.name)}</strong>
        </div>
        <label>
          Project name
          <input data-field="name" value="${escapeHtml(project.name)}" />
        </label>
        <label>
          Update ZIP name
          <input data-field="discLabel" value="${escapeHtml(project.discLabel)}" />
        </label>
        <label>
          Version
          <input data-field="discVersion" value="${escapeHtml(project.discVersion)}" />
        </label>
        <label>
          Package title
          <input data-field="discTitle" value="${escapeHtml(project.discTitle)}" />
        </label>

        <div class="action-stack">
          <div class="icon-preview-card">
            <div class="icon-preview-frame">
              ${state.thumbnailDataUrl ? `<img src="${state.thumbnailDataUrl}" alt="Current disc icon" />` : `<span>No icon</span>`}
            </div>
          <button data-action="thumbnail">Swap icon image</button>
        </div>
        <button data-action="look-editor">Edit autoloader look</button>
        
        <button class="danger nc-stage-active" data-action="build" ${state.busy || errors.length ? "disabled" : ""}>Build Update ZIP</button>
        </div>

        <div class="status-box">
          <h2>Check</h2>
          ${errors.length ? `<p class="bad">Failed</p>${errors.map((error) => `<p class="bad detail">${escapeHtml(error)}</p>`).join("")}` : `<p class="good">Valid</p>`}
        </div>
      </section>

      <section class="panel cyber-card cyber-card--holo sequence-panel">
        <div class="panel-title row">
          <span>Payload order</span>
          <div>
            <button data-action="add-payload">Payload</button>
            <button data-action="add-delay">Wait</button>
            <button data-action="add-message">Message</button>
          </div>
        </div>

        <div class="sequence">
          ${autoload.map((entry, index) => renderEntry(entry, index)).join("") || `<div class="placeholder">No payload plan yet.</div>`}
        </div>

        <div class="preview">
          <div class="panel-title"><span>autoload.txt</span></div>
          <pre>${escapeHtml(autoloadText)}</pre>
        </div>
      </section>

      <aside class="panel cyber-card cyber-card--holo build-panel">
        <div class="panel-title"><span>Payloads in folder</span><button data-action="payloads">Import files</button></div>
        <div class="payload-list-controls">
          <input class="payload-search-input" type="search" placeholder="Search payloads..." data-payload-search value="${escapeHtml(state.payloadSearch)}" />
        </div>
        <div class="payload-list">
          ${renderFolderPayloadList(getPagedPayloads())}
        </div>
        ${(() => {
          const total = getFilteredPayloads().length;
          const totalPages = Math.max(1, Math.ceil(total / PAYLOAD_PAGE_SIZE));
          const page = state.payloadPage;
          return `<div class="payload-pagination">
            <button class="payload-page-btn" data-action="payload-prev" ${page === 0 ? "disabled" : ""}>&#8249;</button>
            <span>${page + 1} / ${totalPages}</span>
            <button class="payload-page-btn" data-action="payload-next" ${page + 1 >= totalPages ? "disabled" : ""}>&#8250;</button>
          </div>`;
        })()}

        <div class="panel-title"><span>Payload database</span></div>
        <div class="payload-db-summary">
          <span class="payload-db-count">${state.payloadSources.length} source(s)</span>
          <button data-action="payload-library">Open Library</button>
        </div>

        <div class="panel-title"><span>Build log</span><button data-action="copy-log" class="copy-log-btn" title="Copy log to clipboard">Copy</button></div>
        <pre class="log">${escapeHtml(state.buildLog || "Nothing ran yet.")}</pre>
      </aside>
    </main>
    ${renderProgressBar()}
    ${state.settingsOpen ? renderSettings(project) : ""}
    ${state.payloadLibraryOpen ? renderPayloadLibrary() : ""}
    ${state.lookEditorOpen ? renderLookEditor() : ""}
    ${state.sourceInfoId ? renderSourceInfoModal() : ""}
    ${state.readmePromptOpen ? renderReadmePrompt() : ""}
    ${state.clearSourcesPromptOpen ? renderClearSourcesPrompt() : ""}
    ${state.updatePrompt ? renderUpdatePrompt() : ""}
  `;
}

function renderProgressBar() {
  const progress = state.progress || { label: "Idle", detail: "No job running.", percent: 0 };
  return `
    <section class="verbose-progress" aria-label="Progress">
      <div class="progress-copy">
        <strong>${escapeHtml(progress.label)}</strong>
        <span>${escapeHtml(progress.detail)}</span>
      </div>
      <div class="cyber-progress cyber-progress--yellow verbose-progress-track" style="--value: ${progress.percent}; --progress-width: ${progress.percent}%">
        <div class="cyber-progress__bar verbose-progress-fill"></div>
      </div>
      <div class="progress-percent">${Math.round(progress.percent)}%</div>
    </section>
  `;
}

function renderSettings(project) {
  const isY2 = project.projectType === "y2jb";
  return `
    <div class="modal-backdrop" data-action="close-settings">
      <section class="settings-modal cyber-card cyber-card--holo">
        <div class="panel-title row">
          <span>Settings</span>
          <button data-action="close-settings">Close</button>
        </div>
        <label class="color-setting">
          Cyber color
          <div class="color-row">
            <input type="color" data-field="themeAccent" value="${escapeHtml(project.themeAccent || "#fcee0a")}" />
            <input data-field="themeAccent" value="${escapeHtml(project.themeAccent || "#fcee0a")}" />
          </div>
        </label>
        <label class="toggle-setting">
          <input type="checkbox" data-setting="autoCheckUpdates" ${state.settings.autoCheckUpdates !== false ? "checked" : ""} />
          Check for payload updates when opening a project
        </label>
        <label class="toggle-setting">
          <input type="checkbox" data-setting="openLastProjectOnStart" ${state.settings.openLastProjectOnStart === true ? "checked" : ""} />
          Open the last project on startup
        </label>
        <div class="status-box settings-actions">
          <h2>Payload source list</h2>
          <p>Build the list manually, export it here, then it can be hardcoded later.</p>
          <div class="settings-button-row">
            <button data-action="export-sources" ${state.busy ? "disabled" : ""}>Export JSON</button>
            <button data-action="import-sources" ${state.busy ? "disabled" : ""}>Import JSON</button>
          </div>
          <button class="danger clear-db-button" data-action="clear-sources" ${state.busy ? "disabled" : ""}>Clear payload database</button>
        </div>
      </section>
    </div>
  `;
}

function renderLookEditor() {
  const theme = lookTheme();

  return `
    <div class="modal-backdrop" data-action="close-look-editor">
      <section class="look-editor-modal cyber-card cyber-card--holo">
        <div class="panel-title row">
          <span>Autoloader Look</span>
          <div class="look-actions">
            <button data-action="reset-look">Reset</button>
            <button class="primary" data-action="save-look">Save Look</button>
            <button data-action="close-look-editor">Close</button>
          </div>
        </div>
        <div class="look-editor-grid">
          <aside class="look-controls">
            <label>
              Preset
              <select data-look-preset>
                <option value="">Custom</option>
                ${lookPresets.map((preset) => `<option value="${escapeHtml(preset.id)}" ${theme.presetId === preset.id || theme.layoutId === preset.layoutId ? "selected" : ""}>${escapeHtml(preset.name)}</option>`).join("")}
              </select>
            </label>
            <label>
              Screen title
              <input data-look-field="titleText" value="${escapeHtml(theme.titleText)}" />
            </label>
            <label>
              Version text
              <input data-look-field="versionText" value="${escapeHtml(theme.versionText || "v1.0")}" />
            </label>
            <label>
              Top credit text
              <input data-look-field="creditText" value="${escapeHtml(theme.creditText || "StonedModder")}" />
            </label>
            <label>
              Top loader text
              <input data-look-field="loaderText" value="${escapeHtml(theme.loaderText || "Y2Genny")}" />
            </label>
            <label>
              Protocol title text
              <input data-look-field="protocolTitleText" value="${escapeHtml(theme.protocolTitleText || "Y2JB // Y2Genny")}" />
            </label>
            <label>
              Protocol detail text
              <input data-look-field="protocolDetailText" value="${escapeHtml(theme.protocolDetailText || `Y2JB Autoloader ${theme.versionText || defaultLookTheme.versionText} by PLK // Offline PS5 Exploit Chain`)}" />
            </label>
            <div class="look-control-list">
              ${lookColorControls.map(([key, label]) => `
                <label class="look-color-row">
                  <span>${escapeHtml(label)}</span>
                  <div class="color-row">
                    <input type="color" data-look-field="${escapeHtml(key)}" value="${escapeHtml(theme[key])}" />
                    <input data-look-field="${escapeHtml(key)}" value="${escapeHtml(theme[key])}" />
                  </div>
                </label>
              `).join("")}
            </div>
          </aside>
          <main class="look-preview-shell">
            <div class="look-preview-label">
              <span>Live preview</span>
              <strong>1920x1080</strong>
            </div>
            <div class="look-preview-frame">
              ${renderLookPreview(theme)}
            </div>
          </main>
        </div>
      </section>
    </div>
  `;
}

function lookPreviewVars(theme) {
  return `
    --look-bg: ${escapeHtml(theme.bgColor)};
    --look-title: ${escapeHtml(theme.titleColor)};
    --look-log-bg: ${escapeHtml(theme.logBgColor)};
    --look-border: ${escapeHtml(theme.borderColor)};
    --look-progress-bg: ${escapeHtml(theme.progressBgColor)};
    --look-progress-fill: ${escapeHtml(theme.progressBarColor)};
    --look-progress-text: ${escapeHtml(theme.progressTextColor)};
    --look-footer: ${escapeHtml(theme.footerColor)};
    --look-info: ${escapeHtml(theme.logInfoColor)};
    --look-success: ${escapeHtml(theme.logSuccessColor)};
    --look-error: ${escapeHtml(theme.logErrorColor)};
    --look-warning: ${escapeHtml(theme.logWarningColor)};
  `;
}

function renderLookPreview(theme) {
  if (theme.layoutId === "y2-cyberpunk") return renderCyberpunkLookPreview(theme);
  const previewLogs = [
    ["logSuccessColor", "> Loaded autoload.txt"],
    ["logInfoColor", "> payload: etaHEN.elf"],
    ["logWarningColor", "> waiting 1000ms"],
    ["logInfoColor", "> payload: itemzflow.elf"],
    ["logErrorColor", "> sample error text"],
    ["logSuccessColor", "> done"]
  ];

  return `
    <div class="look-preview-canvas" style="${lookPreviewVars(theme)}">
      <h2>${escapeHtml(theme.titleText)} ${escapeHtml(theme.versionText || "v1.0")}</h2>
      <div class="look-preview-log">
        ${previewLogs.map(([colorKey, text]) => `<p style="color: ${escapeHtml(theme[colorKey])}">${escapeHtml(text)}</p>`).join("")}
      </div>
      <div class="look-preview-progress-wrap">
        <div class="look-preview-progress"><span></span></div>
        <strong>75%</strong>
      </div>
      <p class="look-preview-progress-text">Loading next payload...</p>
      <footer>Y2JB Autoloader ${escapeHtml(theme.versionText || defaultLookTheme.versionText)} by PLK (preview)</footer>
    </div>
  `;
}

function renderCyberpunkLookPreview(theme) {
  const logs = [
    ["logWarningColor", "RUNNING USERLAND EXPLOIT"],
    ["logInfoColor", "CHAIN INITIALIZED"],
    ["logSuccessColor", "UNSTABLE PRIMITIVE ACHIEVED"],
    ["logWarningColor", "RUNNING KERNEL EXPLOIT"],
    ["logSuccessColor", "KERNEL EXPLOIT FINISHED"],
    ["logInfoColor", "AUTOLOAD MANIFEST READY"],
    ["logWarningColor", "PAYLOAD QUEUE RUNNING"],
    ["logSuccessColor", "AUTOLOAD FINISHED"]
  ];

  return `
    <div class="look-preview-canvas look-preview-cyberpunk cyber-noise cyber-scanlines" style="${lookPreviewVars(theme)}">
      <h2 class="cyber-heading cyber-glitch cyber-glitch--subtle" data-text="${escapeHtml(theme.titleText)}">${escapeHtml(theme.titleText)}</h2>
      <div class="look-cyber-effects">
        <span class="look-effect-badge look-effect-brand">${escapeHtml(theme.versionText || defaultLookTheme.versionText)}</span>
        <span class="look-effect-badge look-effect-credit">${escapeHtml(theme.creditText || "StonedModder")}</span>
        <span class="look-effect-badge look-effect-spin">${escapeHtml(theme.loaderText || "Y2Genny")}</span>
        <strong class="look-cyber-status cyber-glitch" data-text="PAYLOAD QUEUE RUNNING">PAYLOAD QUEUE RUNNING</strong>
      </div>
      <section class="look-cyber-protocol">
        <strong>${escapeHtml(theme.protocolTitleText || "Y2JB // Y2Genny")}</strong>
        <span>${escapeHtml(theme.protocolDetailText || `Y2JB Autoloader ${theme.versionText || defaultLookTheme.versionText} by PLK // Offline PS5 Exploit Chain`)}</span>
      </section>
      <div class="look-cyber-modules">
        ${[
          ["EXPLOIT CHAIN", "INITIALIZING", "look-meter-a"],
          ["KERNEL STAGE", "STANDING BY", "look-meter-b"],
          ["PAYLOAD RUNNER", "QUEUE READY", "look-meter-c"]
        ].map(([label, value, meter]) => `
          <section class="look-cyber-module cyber-card cyber-card--holo">
            <span>// ${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <em><i class="${escapeHtml(meter)}"></i></em>
          </section>
        `).join("")}
      </div>
      <section class="look-cyber-log cyber-card cyber-card--holo">
        <header>AUTOLOADER EVENT STREAM</header>
        ${logs.map(([colorKey, text]) => `<p style="color: ${escapeHtml(theme[colorKey])}">> ${escapeHtml(text)}</p>`).join("")}
      </section>
      <section class="look-cyber-progress cyber-progress cyber-progress--magenta">
        <div></div>
        <strong>AUTOLOAD FINISHED</strong>
      </section>
      <footer>CYBERPUNK CSS LAYOUT // Y2JB PRESET</footer>
    </div>
  `;
}

function renderPayloadLibrary() {
  const sources = state.payloadSources || [];
  return `
    <div class="modal-backdrop" data-action="close-payload-library">
      <section class="payload-library-modal cyber-card cyber-card--holo">
        <div class="panel-title row">
          <span>Payload Library</span>
          <button data-action="close-payload-library">Close</button>
        </div>

        <div class="source-form source-form-modal">
          <input data-source-name value="${escapeHtml(state.newSourceName)}" placeholder="Name" />
          <input data-source-url value="${escapeHtml(state.newSourceUrl)}" placeholder="GitHub/GitLab repo, release page, or direct payload ZIP/ELF" />
          <button data-action="add-source" ${state.busy ? "disabled" : ""}>Add source</button>
        </div>

        <div class="library-toolbar">
          <button data-action="check-all-sources" ${sources.length && !state.busy ? "" : "disabled"}>Check all</button>
          <button data-action="get-all-sources" ${sources.length && state.activeProject && !state.busy ? "" : "disabled"}>Get all</button>
          <button data-action="update-all-sources" ${sources.some((source) => source.updateAvailable) && state.activeProject && !state.busy ? "" : "disabled"}>Update all</button>
        </div>

        <div class="source-list source-list-modal">
          ${sources.map((source) => renderPayloadSourceCard(source)).join("") || `<p>No sources yet.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderPayloadSourceCard(source) {
  const releases = source.releases || [];
  const selected = source.selectedReleaseId || releases[0]?.id || "";
  const selectedRelease = releases.find((release) => release.id === selected) || releases[0];
  const selectedAssetUrls = source.selectedAssetUrls || [];
  const latest = releases[0];
  const installed = source.installedVersion || "none";
  const updateText = source.updateAvailable ? "Update available" : source.installedVersion ? "Installed" : "Not installed";
  return `
    <div class="source-card">
      <div>
        <strong>${escapeHtml(source.name)}</strong>
        <span>${escapeHtml(source.kind || "url")} | ${escapeHtml(updateText)}</span>
        <p>${escapeHtml(source.url)}</p>
        <textarea data-source-note="${escapeHtml(source.id)}" placeholder="Description">${escapeHtml(source.note || "")}</textarea>
        <p>Latest: ${escapeHtml(latest?.tag || latest?.name || "check needed")} | Local: ${escapeHtml(installed)}</p>
        <select data-source-version="${escapeHtml(source.id)}" ${releases.length ? "" : "disabled"}>
          ${releases.map((release) => `<option value="${escapeHtml(release.id)}" ${release.id === selected ? "selected" : ""}>${escapeHtml(release.tag || release.name)} (${release.assets.length} asset${release.assets.length === 1 ? "" : "s"})</option>`).join("")}
        </select>
        <div class="asset-list">
          ${selectedRelease?.assets?.map((asset) => renderAssetChoice(source, asset, selectedAssetUrls)).join("") || `<p>Check this source to see assets.</p>`}
        </div>
      </div>
      <div class="source-actions">
        <button data-info-source="${escapeHtml(source.id)}">Info</button>
        <button data-save-source="${escapeHtml(source.id)}">Save</button>
        <button data-check-source="${escapeHtml(source.id)}" ${state.busy ? "disabled" : ""}>Check</button>
        <button data-download-source="${escapeHtml(source.id)}" ${state.busy || !state.activeProject ? "disabled" : ""}>Get</button>
      </div>
    </div>
  `;
}

function assetTypeLabel(asset) {
  const lower = String(asset.name || asset.url || "").toLowerCase();
  if (lower.endsWith(".zip")) return "ZIP package";
  if (lower.endsWith(".elf")) return "ELF payload";
  if (lower.endsWith(".bin")) return "BIN payload";
  if (lower.endsWith(".jar")) return "JAR payload";
  return asset.kind || "asset";
}

function renderAssetChoice(source, asset, selectedAssetUrls) {
  const checked = !selectedAssetUrls.length || selectedAssetUrls.includes(asset.url);
  return `
    <label class="asset-choice">
      <input type="checkbox" data-source-asset="${escapeHtml(source.id)}" value="${escapeHtml(asset.url)}" ${checked ? "checked" : ""} />
      <span>
        <strong>${escapeHtml(asset.name || asset.url)}</strong>
        <em>${escapeHtml(assetTypeLabel(asset))}</em>
      </span>
    </label>
  `;
}

function renderSourceInfoModal() {
  const source = state.payloadSources.find((item) => item.id === state.sourceInfoId);
  if (!source) return "";
  const releases = source.releases || [];
  return `
    <div class="modal-backdrop modal-layer-top" data-action="close-source-info">
      <section class="source-info-modal cyber-card cyber-card--holo">
        <div class="panel-title row">
          <span>${escapeHtml(source.name)}</span>
          <button data-action="close-source-info">Close</button>
        </div>
        <div class="info-grid">
          <strong>Description</strong>
          <p>${escapeHtml(source.note || "No description saved.")}</p>
          <strong>URL</strong>
          <p>${escapeHtml(source.url)}</p>
          <strong>Type</strong>
          <p>${escapeHtml(source.kind || "url")}</p>
          <strong>Installed</strong>
          <p>${escapeHtml(source.installedVersion || "none")}</p>
          <strong>Available versions</strong>
          <p>${releases.length ? releases.map((release) => escapeHtml(release.tag || release.name)).join(", ") : "Not checked yet."}</p>
        </div>
      </section>
    </div>
  `;
}

function renderReadmePrompt() {
  return `
    <div class="modal-backdrop modal-layer-top" data-action="close-readme-prompt">
      <section class="inline-dialog-modal cyber-card cyber-card--holo">
        <div class="panel-title row">
          <span>Fetch descriptions?</span>
          <button data-action="close-readme-prompt">Close</button>
        </div>
        <p>Check every payload source now. Want y2JBGenny to pull README text too and use it for descriptions?</p>
        <div class="dialog-actions">
          <button data-action="check-all-no-readmes">No, versions only</button>
          <button class="primary" data-action="check-all-with-readmes">Yes, fetch READMEs</button>
        </div>
      </section>
    </div>
  `;
}

function renderClearSourcesPrompt() {
  return `
    <div class="modal-backdrop modal-layer-top" data-action="close-clear-sources-prompt">
      <section class="inline-dialog-modal cyber-card cyber-card--holo">
        <div class="panel-title row">
          <span>Clear Payload Library?</span>
          <button data-action="close-clear-sources-prompt">Close</button>
        </div>
        <p>This only clears saved source URLs and notes. It does not delete projects, downloaded payloads, or autoload.txt.</p>
        <div class="dialog-actions">
          <button data-action="close-clear-sources-prompt">Cancel</button>
          <button class="danger" data-action="confirm-clear-sources">Clear database</button>
        </div>
      </section>
    </div>
  `;
}

function renderUpdatePrompt() {
  const summary = state.updatePrompt;
  if (!summary) return "";
  const updates = summary.updates || [];
  const checked = summary.checked || [];
  const failed = summary.failed || [];
  return `
    <div class="modal-backdrop modal-layer-top" data-action="close-update-prompt">
      <section class="inline-dialog-modal update-dialog cyber-card cyber-card--holo">
        <div class="panel-title row">
          <span>${updates.length ? "Payload updates found" : "Payloads checked"}</span>
          <button data-action="close-update-prompt">Close</button>
        </div>
        <p>Found ${summary.payloadCount || 0} payload file(s) in this build and checked ${checked.length} tracked source(s).</p>
        <div class="update-summary-list">
          ${checked.map((item) => `
            <div class="${item.updateAvailable ? "has-update" : ""}">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.local)} -> ${escapeHtml(item.latest)}${item.updateAvailable ? " | update ready" : " | current"}</span>
            </div>
          `).join("")}
          ${failed.map((item) => `
            <div class="failed">
              <strong>${escapeHtml(item.name)}</strong>
              <span>Failed: ${escapeHtml(item.error)}</span>
            </div>
          `).join("")}
        </div>
        <div class="dialog-actions">
          <button data-action="close-update-prompt">${updates.length ? "Not now" : "Done"}</button>
          ${updates.length ? `<button class="primary" data-action="install-found-updates">Update found payloads</button>` : ""}
        </div>
      </section>
    </div>
  `;
}

function renderEntry(entry, index) {
  const placeholder = entry.type === "delay" ? "1000" : entry.type === "message" ? "PS5 popup text" : "payload.elf";
  return `
    <div class="entry" data-index="${index}">
      <div class="drag-index">${String(index + 1).padStart(2, "0")}</div>
      <select data-entry-type="${index}">
        ${entryTypes.map((type) => `<option value="${type.value}" ${entry.type === type.value ? "selected" : ""}>${type.label}</option>`).join("")}
      </select>
      <input data-entry-value="${index}" value="${escapeHtml(entry.value)}" placeholder="${placeholder}" />
      <button title="Move up" data-move-up="${index}">Up</button>
      <button title="Move down" data-move-down="${index}">Down</button>
      <button title="Remove" data-remove="${index}">Del</button>
    </div>
  `;
}

function render() {
  const snapshot = focusSnapshot();
  const accent = state.activeProject?.themeAccent || "#fcee0a";
  applyAccent(accent);
  app.innerHTML = state.showWelcome ? renderEmpty() : renderProject();
  restoreFocus(snapshot);
}

app.addEventListener("click", (event) => {
  const target = event.target.closest("button, [data-action]");
  if (!target) return;

  const action = target.dataset.action;
  if ((action === "close-settings" || action === "close-payload-library" || action === "close-look-editor" || action === "close-source-info" || action === "close-readme-prompt" || action === "close-clear-sources-prompt" || action === "close-update-prompt") && event.target !== target && target.classList.contains("modal-backdrop")) {
    return;
  }
  if (action === "create" || action === "y2jb-home") {
    runAction(async () => {
      const payload = await y2jbApi.createUpdateWorkspace();
      switchToProject(payload);
      return null;
    }, { label: "Creating update", detail: "Copying the bundled Y2JB template.", percent: 22 });
  }
  if (action === "open") runAction(async () => {
    const payload = await y2jbApi.openWorkspace();
    switchToProject(payload);
    return null;
  }, { label: "Opening project", detail: "Checking the selected folder.", percent: 20 });
  if (action === "continue") {
    state.showWelcome = false;
    render();
    maybeCheckInstalledPayloadUpdates();
  }
  if (action === "creator-link") {
    runAction(() => y2jbApi.openExternal("https://x.com/StonedModder"), { label: "Opening link", detail: "Launching your browser.", percent: 70 }, { applyProject: false });
  }
  if (action === "home") {
    state.showWelcome = true;
    render();
  }
  if (action === "settings") {
    state.settingsOpen = true;
    render();
  }
  if (action === "payload-library") {
    state.payloadLibraryOpen = true;
    render();
  }
  if (action === "look-editor") {
    state.lookEditorOpen = true;
    render();
  }
  if (action === "close-settings") {
    state.settingsOpen = false;
    render();
  }
  if (action === "close-payload-library") {
    state.payloadLibraryOpen = false;
    render();
  }
  if (action === "close-look-editor") {
    state.lookEditorOpen = false;
    render();
  }
  if (action === "close-source-info") {
    state.sourceInfoId = null;
    render();
  }
  if (action === "close-readme-prompt") {
    state.readmePromptOpen = false;
    render();
  }
  if (action === "close-clear-sources-prompt") {
    state.clearSourcesPromptOpen = false;
    render();
  }
  if (action === "close-update-prompt") {
    state.updatePrompt = null;
    render();
  }
  if (action === "reset-look") {
    mutateProject((project) => {
      project.lookTheme = { ...defaultLookTheme };
    });
  }
  if (action === "save-look") {
    runAction(() => y2jbApi.saveLookTheme(state.activeProject.id, lookTheme()), { label: "Saving look", detail: "Patching autoloader theme.", percent: 35 }, { preserveAutoload: true });
  }
  if (action === "save") runAction(() => y2jbApi.saveProject(projectPayload()), { label: "Saving", detail: "Writing autoload.txt and theme CSS.", percent: 35 });
  if (action === "payloads") runAction(() => y2jbApi.addPayloads(state.activeProject.id), { label: "Importing payloads", detail: "Copying selected files to project folder.", percent: 25 }, { preserveAutoload: true });
  if (action === "thumbnail") runAction(() => y2jbApi.setThumbnail(state.activeProject.id), {
    label: "Replacing icon",
    detail: state.activeProject?.projectType === "y2jb" ? "Cropping and resizing to 512x512 PNG." : "Cropping and resizing to 640x360 PNG.",
    percent: 30
  }, { preserveAutoload: true });
  if (action === "reveal") runAction(() => y2jbApi.revealWorkspace(state.activeProject.id), { label: "Opening folder", detail: "Launching Windows Explorer.", percent: 65 }, { applyProject: false });
  if (action === "build") {
    state.buildLog = "";
    state.lastBuildOutputPath = null;
    runAction(
      () => y2jbApi.buildUpdateZip(projectPayload()),
      { label: "Building update ZIP", detail: "Starting native ZIP pipeline.", percent: 3 },
      { preserveProgress: true }
    );
  }
  if (action === "copy-log") {
    const text = state.buildLog || "";
    navigator.clipboard.writeText(text).then(() => {
      const btn = app.querySelector('[data-action="copy-log"]');
      if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy"; }, 1500); }
    });
  }
  if (action === "reveal-build-output") {
    runAction(() => y2jbApi.revealPath(state.lastBuildOutputPath), { label: "Opening folder", detail: "Launching Windows Explorer.", percent: 65 }, { applyProject: false });
  }
  if (action === "copy-to-usb") {
    runAction(() => y2jbApi.copyToUsb(state.activeProject.id), { label: "Copying to USB", detail: "Writing y2jb_update.zip to selected USB.", percent: 50 }, { applyProject: false });
  }
  if (action === "payload-prev") {
    state.payloadPage = Math.max(0, state.payloadPage - 1);
    const list = app.querySelector(".payload-list");
    if (list) list.innerHTML = renderFolderPayloadList(getPagedPayloads());
    const pag = app.querySelector(".payload-pagination");
    if (pag) {
      const total = getFilteredPayloads().length;
      const totalPages = Math.max(1, Math.ceil(total / PAYLOAD_PAGE_SIZE));
      pag.querySelector('[data-action="payload-prev"]').disabled = state.payloadPage === 0;
      pag.querySelector('[data-action="payload-next"]').disabled = state.payloadPage + 1 >= totalPages;
      pag.querySelector("span").textContent = `${state.payloadPage + 1} / ${totalPages}`;
    }
  }
  if (action === "payload-next") {
    const total = getFilteredPayloads().length;
    const totalPages = Math.max(1, Math.ceil(total / PAYLOAD_PAGE_SIZE));
    state.payloadPage = Math.min(totalPages - 1, state.payloadPage + 1);
    const list = app.querySelector(".payload-list");
    if (list) list.innerHTML = renderFolderPayloadList(getPagedPayloads());
    const pag = app.querySelector(".payload-pagination");
    if (pag) {
      pag.querySelector('[data-action="payload-prev"]').disabled = state.payloadPage === 0;
      pag.querySelector('[data-action="payload-next"]').disabled = state.payloadPage + 1 >= totalPages;
      pag.querySelector("span").textContent = `${state.payloadPage + 1} / ${totalPages}`;
    }
  }
  if (action === "add-payload") addEntry("payload");
  if (action === "add-delay") addEntry("delay", "1000");
  if (action === "add-message") addEntry("message", "Launching payload");
  if (action === "add-source") {
    const submitted = { name: state.newSourceName, url: state.newSourceUrl };
    runAction(async () => {
      const payload = await y2jbApi.addPayloadSource(submitted);
      state.newSourceName = "";
      state.newSourceUrl = "";
      return payload;
    }, { label: "Saving source", detail: "Adding URL to payload database.", percent: 40 }, { applyProject: false });
  }
  if (action === "check-all-sources") {
    state.readmePromptOpen = true;
    render();
  }
  if (action === "check-all-with-readmes" || action === "check-all-no-readmes") {
    const fetchReadmes = action === "check-all-with-readmes";
    state.readmePromptOpen = false;
    runAction(() => y2jbApi.checkAllPayloadSources(fetchReadmes), { label: "Checking all", detail: fetchReadmes ? "Reading releases and README descriptions." : "Reading release metadata for every source.", percent: 12 }, { applyProject: false });
  }
  if (action === "get-all-sources") {
    runAction(() => y2jbApi.downloadAllPayloadSources(state.activeProject.id, false), { label: "Getting all", detail: "Installing selected versions from every source.", percent: 12 }, { preserveAutoload: true });
  }
  if (action === "update-all-sources") {
    runAction(() => y2jbApi.downloadAllPayloadSources(state.activeProject.id, true), { label: "Updating all", detail: "Installing sources with available updates.", percent: 12 }, { preserveAutoload: true });
  }
  if (action === "export-sources") runAction(() => y2jbApi.exportPayloadSources(), { label: "Exporting", detail: "Writing payload source JSON.", percent: 45 }, { applyProject: false });
  if (action === "import-sources") runAction(() => y2jbApi.importPayloadSources(), { label: "Importing", detail: "Reading payload source JSON.", percent: 45 }, { applyProject: false });
  if (action === "clear-sources") {
    state.clearSourcesPromptOpen = true;
    render();
  }
  if (action === "confirm-clear-sources") {
    state.clearSourcesPromptOpen = false;
    runAction(() => y2jbApi.clearPayloadSources(), { label: "Clearing", detail: "Clearing saved payload source URLs and notes.", percent: 35 }, { applyProject: false });
  }
  if (action === "install-found-updates") {
    const sourceIds = (state.updatePrompt?.updates || []).map((item) => item.id);
    state.updatePrompt = null;
    runAction(() => y2jbApi.downloadPayloadSourceUpdates(state.activeProject.id, sourceIds), { label: "Updating payloads", detail: "Installing newer tracked payload versions.", percent: 12 }, { preserveAutoload: true });
  }

  if (target.dataset.addExisting) addEntry("payload", target.dataset.addExisting);
  if (target.dataset.openProject) {
    runAction(async () => {
      const payload = await y2jbApi.openRecentProject(target.dataset.openProject);
      switchToProject(payload);
      return null;
    }, { label: "Opening project", detail: "Loading saved project state.", percent: 25 });
  }
  if (target.dataset.addGroup !== undefined) {
    const select = target.closest(".folder-payload--group")?.querySelector("select.folder-payload-version-select");
    if (select) addEntry("payload", select.value);
  }
  if (target.dataset.downloadSource) {
    const source = state.payloadSources.find((item) => item.id === target.dataset.downloadSource);
    runAction(() => y2jbApi.downloadPayloadSource(state.activeProject.id, target.dataset.downloadSource, source?.selectedReleaseId, source?.selectedAssetUrls), { label: "Downloading payload", detail: "Fetching selected version and assets.", percent: 15 }, { preserveAutoload: true });
  }
  if (target.dataset.checkSource) {
    runAction(() => y2jbApi.checkPayloadSource(target.dataset.checkSource), { label: "Checking versions", detail: "Reading release metadata.", percent: 20 }, { applyProject: false });
  }
  if (target.dataset.infoSource) {
    state.sourceInfoId = target.dataset.infoSource;
    render();
  }
  if (target.dataset.saveSource) {
    const source = state.payloadSources.find((item) => item.id === target.dataset.saveSource);
    if (source) runAction(() => y2jbApi.updatePayloadSource(source), { label: "Saving source", detail: "Saving source description.", percent: 45 }, { applyProject: false });
  }
  if (target.dataset.remove) removeEntry(Number(target.dataset.remove));
  if (target.dataset.moveUp) moveEntry(Number(target.dataset.moveUp), -1);
  if (target.dataset.moveDown) moveEntry(Number(target.dataset.moveDown), 1);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.settingsOpen) {
    state.settingsOpen = false;
    render();
  }
  if (event.key === "Escape" && state.payloadLibraryOpen) {
    state.payloadLibraryOpen = false;
    render();
  }
  if (event.key === "Escape" && state.lookEditorOpen) {
    state.lookEditorOpen = false;
    render();
  }
  if (event.key === "Escape" && state.sourceInfoId) {
    state.sourceInfoId = null;
    render();
  }
  if (event.key === "Escape" && state.readmePromptOpen) {
    state.readmePromptOpen = false;
    render();
  }
  if (event.key === "Escape" && state.clearSourcesPromptOpen) {
    state.clearSourcesPromptOpen = false;
    render();
  }
  if (event.key === "Escape" && state.updatePrompt) {
    state.updatePrompt = null;
    render();
  }
});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target.dataset.field) {
    if (target.dataset.field === "themeAccent") {
      const value = target.value;
      if (state.activeProject) {
        state.activeProject.themeAccent = value;
        state.dirty = true;
        for (const input of app.querySelectorAll('input[data-field="themeAccent"]')) {
          if (input !== target) input.value = value;
        }
        const saveButton = app.querySelector('button[data-action="save"]');
        if (saveButton) saveButton.textContent = "Save it";
        if (/^#[0-9a-f]{6}$/i.test(value)) applyAccent(value);
      }
      return;
    }
    if (state.activeProject) {
      state.activeProject[target.dataset.field] = target.value;
      state.dirty = true;
      const saveBtn = app.querySelector('button[data-action="save"]');
      if (saveBtn) saveBtn.textContent = "Save it";
      const fieldErrors = validateProject(state.activeProject);
      for (const buildBtn of app.querySelectorAll('button[data-action="build"]')) {
        buildBtn.disabled = !!(state.busy || fieldErrors.length);
      }
      const statusBox = app.querySelector('.status-box');
      if (statusBox) {
        statusBox.innerHTML = `<h2>Check</h2>` + (fieldErrors.length
          ? `<p class="bad">Failed</p>${fieldErrors.map((e) => `<p class="bad detail">${escapeHtml(e)}</p>`).join("")}`
          : `<p class="good">Valid</p>`);
      }
    }
  }
  if (target.dataset.lookField) {
    if (state.activeProject) {
      state.activeProject.lookTheme = { ...defaultLookTheme, ...(state.activeProject.lookTheme || {}), [target.dataset.lookField]: target.value };
      state.dirty = true;
      for (const input of app.querySelectorAll(`[data-look-field="${CSS.escape(target.dataset.lookField)}"]`)) {
        if (input !== target) input.value = target.value;
      }
      const previewFrame = app.querySelector('.look-preview-frame');
      if (previewFrame) previewFrame.innerHTML = renderLookPreview(lookTheme());
    }
  }
  if (target.dataset.entryValue) {
    if (state.activeProject) {
      const entryIdx = Number(target.dataset.entryValue);
      if (state.activeProject.autoload[entryIdx]) {
        state.activeProject.autoload[entryIdx] = { ...state.activeProject.autoload[entryIdx], value: target.value };
        state.dirty = true;
        const saveBtn = app.querySelector('button[data-action="save"]');
        if (saveBtn) saveBtn.textContent = "Save it";
        const previewPre = app.querySelector('.preview pre');
        if (previewPre) {
          previewPre.textContent = state.activeProject.autoload
            .map((entry) => {
              if (entry.type === "delay") return `!${entry.value}`;
              if (entry.type === "message") return `@ ${entry.value}`;
              return entry.value;
            })
            .join("\n");
        }
      }
    }
  }
  if (target.dataset.payloadSearch !== undefined) {
    state.payloadSearch = target.value;
    state.payloadPage = 0;
    const list = app.querySelector(".payload-list");
    if (list) list.innerHTML = renderFolderPayloadList(getPagedPayloads());
    const pag = app.querySelector(".payload-pagination");
    if (pag) {
      const total = getFilteredPayloads().length;
      const totalPages = Math.max(1, Math.ceil(total / PAYLOAD_PAGE_SIZE));
      pag.querySelector('[data-action="payload-prev"]').disabled = true;
      pag.querySelector('[data-action="payload-next"]').disabled = totalPages <= 1;
      pag.querySelector("span").textContent = `1 / ${totalPages}`;
    }
  }
  if (target.dataset.sourceName !== undefined) {
    state.newSourceName = target.value;
  }
  if (target.dataset.sourceUrl !== undefined) {
    state.newSourceUrl = target.value;
  }
  if (target.dataset.sourceNote) {
    const source = state.payloadSources.find((item) => item.id === target.dataset.sourceNote);
    if (source) {
      source.note = target.value;
      clearTimeout(sourceAutosaveTimers.get(source.id));
      sourceAutosaveTimers.set(source.id, setTimeout(() => {
        y2jbApi.updatePayloadSource(source)
          .then((payload) => {
            if (payload) applyPayload(payload, { applyProject: false });
            setProgress("Saved", `Saved description for ${source.name}.`, 100);
          })
          .catch((error) => {
            state.buildLog += `\nERROR: ${error.message || error}`;
            setProgress("Failed", error.message || String(error), 100);
            render();
          });
      }, 450));
    }
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.entryType) {
    updateEntry(Number(target.dataset.entryType), { type: target.value });
  }
  if (target.dataset.sourceVersion) {
    runAction(() => y2jbApi.setPayloadSourceVersion(target.dataset.sourceVersion, target.value), { label: "Selecting version", detail: "Saving selected payload version.", percent: 55 }, { applyProject: false });
  }
  if (target.dataset.sourceAsset) {
    const checkboxes = [...app.querySelectorAll(`input[data-source-asset="${CSS.escape(target.dataset.sourceAsset)}"]`)];
    const checked = checkboxes.filter((input) => input.checked).map((input) => input.value);
    runAction(() => y2jbApi.setPayloadSourceAssets(target.dataset.sourceAsset, checked), { label: "Selecting assets", detail: "Saving selected release assets.", percent: 55 }, { applyProject: false });
  }
  if (target.dataset.lookPreset !== undefined) {
    const preset = lookPresets.find((item) => item.id === target.value);
    if (preset) {
      mutateProject((project) => {
        project.lookTheme = { ...defaultLookTheme, ...preset.theme, presetId: preset.id };
      });
    }
  }
  if (target.dataset.setting) {
    const value = target.type === "checkbox" ? target.checked : target.value;
    state.settings[target.dataset.setting] = value;
    y2jbApi.saveSettings({ [target.dataset.setting]: value }).catch(() => {});
  }
});

y2jbApi.onBuildLog((line) => {
  state.buildLog += line;
  const parsedProgress = progressFromLogLine(line);
  if (parsedProgress) {
    setProgress(parsedProgress.label, parsedProgress.detail, parsedProgress.percent);
  } else {
    const nextPercent = state.progress.label === "Downloading payload"
      ? Math.min(88, Math.max(state.progress.percent + 3, 18))
      : state.progress.percent;
    setProgress(state.progress.label || "Running", String(line).trim().slice(0, 160) || "Reading output.", nextPercent);
  }
  render();
  const log = document.querySelector(".log");
  if (log) log.scrollTop = log.scrollHeight;
});

runAction(() => y2jbApi.getState()).then(() => {
  if (state.activeProject && state.settings.openLastProjectOnStart === true) {
    state.showWelcome = false;
    render();
  }
  if (state.activeProject && !state.showWelcome && state.settings.autoCheckUpdates !== false) {
    maybeCheckInstalledPayloadUpdates();
  }
});
