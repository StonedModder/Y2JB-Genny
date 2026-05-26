const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require("electron");
const fs = require("fs");
const fsp = require("fs/promises");
const https = require("https");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");
const { LOOK_PRESETS } = require("../shared/look-presets");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const SUPPORTED_PAYLOADS = new Set([".elf", ".bin", ".jar", ".js"]);
const DEFAULT_LOOK_THEME = LOOK_PRESETS[0].theme;
const LEGACY_Y2JB_VERSION_TEXT = "v0.5";
let mainWindow;
let dbPath;
let db;
let saveDbQueue = Promise.resolve();

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultDb() {
  return { version: 1, appName: "y2JBGenny", projects: [], payloadSources: [], activeProjectId: null };
}

async function readDbFile(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

async function readDbFileOrNull(filePath) {
  try {
    return await readDbFile(filePath);
  } catch (_error) {
    return null;
  }
}

function mergePayloadSources(target, sourceDb) {
  if (!Array.isArray(sourceDb?.payloadSources) || !sourceDb.payloadSources.length) return 0;
  const existingUrls = new Set((target.payloadSources || []).map((source) => payloadSourceKey(source)));
  let imported = 0;

  for (const source of sourceDb.payloadSources) {
    let normalized;
    try {
      normalized = normalizePayloadSource(source);
    } catch (_error) {
      continue;
    }
    const key = payloadSourceKey(normalized);
    if (!key || existingUrls.has(key)) continue;
    target.payloadSources.unshift(normalized);
    existingUrls.add(key);
    imported += 1;
  }

  return imported;
}

function payloadSourceKey(source) {
  return String(source?.url || "").trim().toLowerCase();
}

function upsertPayloadSource(sourceInput, { preserveExistingMetadata = true } = {}) {
  const source = normalizePayloadSource(sourceInput);
  const key = payloadSourceKey(source);
  const existing = db.payloadSources.findIndex((item) => payloadSourceKey(item) === key);

  if (existing < 0) {
    db.payloadSources.unshift(source);
    return { source, created: true };
  }

  const current = db.payloadSources[existing];
  db.payloadSources[existing] = preserveExistingMetadata
    ? {
        ...source,
        id: current.id,
        releases: current.releases || source.releases,
        selectedReleaseId: current.selectedReleaseId || source.selectedReleaseId,
        selectedAssetUrls: current.selectedAssetUrls?.length ? current.selectedAssetUrls : source.selectedAssetUrls,
        installedReleaseId: current.installedReleaseId || source.installedReleaseId,
        installedVersion: current.installedVersion || source.installedVersion,
        installedFiles: current.installedFiles?.length ? current.installedFiles : source.installedFiles,
        checkedAt: current.checkedAt || source.checkedAt,
        installedAt: current.installedAt || source.installedAt,
        note: source.note || current.note || "",
        updatedAt: now()
      }
    : { ...current, ...source, id: current.id, updatedAt: now() };

  return { source: db.payloadSources[existing], created: false };
}

function mergeProjects(target, sourceDb) {
  if (!Array.isArray(sourceDb?.projects) || !sourceDb.projects.length) return 0;
  const existingIds = new Set((target.projects || []).map((project) => project.id));
  const existingPaths = new Set((target.projects || []).map((project) => String(project.workspacePath || "").toLowerCase()));
  let imported = 0;

  for (const project of sourceDb.projects) {
    const projectPath = String(project.workspacePath || "").toLowerCase();
    if ((project.id && existingIds.has(project.id)) || (projectPath && existingPaths.has(projectPath))) continue;
    target.projects.push(project);
    if (project.id) existingIds.add(project.id);
    if (projectPath) existingPaths.add(projectPath);
    imported += 1;
  }

  return imported;
}

async function migrateLegacyDb() {
  // Standalone app keeps its own project database and does not import legacy mixed-tool projects.
}

async function loadDb() {
  dbPath = path.join(app.getPath("userData"), "y2jbgenny-db.json");
  try {
    db = await readDbFile(dbPath);
  } catch (error) {
    const backupPath = `${dbPath}.corrupt-${Date.now()}.bak`;
    await fsp.copyFile(dbPath, backupPath);
    db = await readDbFileOrNull(`${dbPath}.bak`);
    if (!db) {
      db = defaultDb();
      db.startupWarning = `Main database could not be read and no backup was available. Corrupt copy saved to ${backupPath}.`;
    }
  }
  if (!db) {
    db = defaultDb();
  }
  if (!Array.isArray(db.payloadSources)) db.payloadSources = [];
  if (!Array.isArray(db.projects)) db.projects = [];
  if (!db.appName) db.appName = "y2JBGenny";
  if (!db.settings) db.settings = {};
  if (db.settings.openLastProjectOnStart === true && !db.settings.startupPreferenceMigrated) {
    db.settings.openLastProjectOnStart = false;
  }
  db.settings = {
    autoCheckUpdates: db.settings.autoCheckUpdates !== false,
    openLastProjectOnStart: db.settings.openLastProjectOnStart === true,
    startupPreferenceMigrated: true,
    ...db.settings
  };
  await migrateLegacyDb();
  db.payloadSources = db.payloadSources.map((source) => normalizePayloadSource(source));
  await saveDb();
}

async function saveDb() {
  saveDbQueue = saveDbQueue.catch(() => {}).then(async () => {
    await fsp.mkdir(path.dirname(dbPath), { recursive: true });
    if (await exists(dbPath)) {
      await fsp.copyFile(dbPath, `${dbPath}.bak`);
    }
    const tempPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tempPath, JSON.stringify(db, null, 2), "utf8");
    await fsp.rename(tempPath, dbPath);
  });
  return saveDbQueue;
}

function activeProject() {
  return db.projects.find((project) => project.id === db.activeProjectId) || db.projects[0] || null;
}

function findProject(projectId) {
  const project = db.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found.");
  return project;
}

function recentProjectSummaries() {
  return [...(db.projects || [])]
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .map((project) => ({
      id: project.id,
      name: project.name || path.basename(project.workspacePath || ""),
      projectType: project.projectType || workspaceType(project.workspacePath || ""),
      workspacePath: project.workspacePath || "",
      updatedAt: project.updatedAt || project.createdAt || null
    }));
}

async function getDirSizeBytes(dirPath) {
  let total = 0;
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await getDirSizeBytes(full);
      } else {
        const stat = await fsp.stat(full);
        total += stat.size;
      }
    }
  } catch (_err) {}
  return total;
}

async function buildUpdateInfo(dir, baseDir = dir) {
  const lines = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.name === "update-info.txt") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      lines.push(...await buildUpdateInfo(full, baseDir));
    } else {
      const stat = await fsp.stat(full);
      const rel = path.relative(baseDir, full).replace(/\\/g, "/");
      lines.push(`${rel}|${stat.size}`);
    }
  }
  return lines;
}

async function zipEntries(dir, baseDir = dir) {
  const archiveEntries = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(baseDir, full).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      archiveEntries.push({ full, rel: `${rel}/`, directory: true });
      archiveEntries.push(...await zipEntries(full, baseDir));
    } else {
      archiveEntries.push({ full, rel, directory: false });
    }
  }
  return archiveEntries;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function unixTime(date = new Date()) {
  return Math.floor(date.getTime() / 1000);
}

function infoZipExtra(mtime, atime, includeAccessTime) {
  const ux = Buffer.from([
    0x75, 0x78, 0x0b, 0x00, // "ux" extra field, 11 bytes.
    0x01, // version
    0x04, 0xe8, 0x03, 0x00, 0x00, // uid 1000
    0x04, 0xe8, 0x03, 0x00, 0x00 // gid 1000
  ]);
  const utLength = includeAccessTime ? 9 : 5;
  const ut = Buffer.alloc(4 + utLength);
  ut.writeUInt16LE(0x5455, 0); // "UT" extended timestamp field.
  ut.writeUInt16LE(utLength, 2);
  ut.writeUInt8(0x03, 4); // Info-ZIP writes mtime+atime flag even in central headers.
  ut.writeUInt32LE(unixTime(mtime), 5);
  if (includeAccessTime) ut.writeUInt32LE(unixTime(atime), 9);
  return Buffer.concat([ut, ux]);
}

function isTextZipEntry(relPath) {
  return [".css", ".html", ".js", ".txt"].includes(path.extname(relPath).toLowerCase());
}

async function writeClassicZipEntry(chunks, offset, entry, centralDirectory) {
  const nameBuffer = Buffer.from(entry.rel, "ascii");
  if (nameBuffer.length !== entry.rel.length) {
    throw new Error(`ZIP path must be ASCII for PS5 compatibility: ${entry.rel}`);
  }

  const stat = await fsp.stat(entry.full);
  const data = entry.directory ? Buffer.alloc(0) : await fsp.readFile(entry.full);
  const compressedData = entry.directory ? Buffer.alloc(0) : zlib.deflateRawSync(data, { level: 6 });
  if (data.length > 0xffffffff || offset > 0xffffffff) {
    throw new Error("ZIP64 archives are not supported by the PS5-safe ZIP writer.");
  }

  const { dosTime, dosDate } = dosDateTime(stat.mtime);
  const crc = entry.directory ? 0 : crc32(data);
  const localExtra = infoZipExtra(stat.mtime, stat.atime, true);
  const centralExtra = infoZipExtra(stat.mtime, stat.atime, false);
  const versionNeeded = entry.directory ? 10 : 20;
  const method = entry.directory ? 0 : 8;
  const externalAttributes = entry.directory ? 0x41ff0010 : 0x81ff0000;
  const internalAttributes = entry.directory ? 0 : isTextZipEntry(entry.rel) ? 1 : 0;
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(versionNeeded, 4);
  localHeader.writeUInt16LE(0, 6); // No data descriptor, UTF flag, or encryption.
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(compressedData.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(nameBuffer.length, 26);
  localHeader.writeUInt16LE(localExtra.length, 28);

  chunks.push(localHeader, nameBuffer, localExtra);
  if (compressedData.length) chunks.push(compressedData);

  centralDirectory.push({
    nameBuffer,
    centralExtra,
    crc,
    compressedSize: compressedData.length,
    uncompressedSize: data.length,
    dosTime,
    dosDate,
    versionNeeded,
    method,
    offset,
    internalAttributes,
    externalAttributes
  });

  return offset + localHeader.length + nameBuffer.length + localExtra.length + compressedData.length;
}

async function createForwardSlashZip(sourceDir, outputZip) {
  const entries = await zipEntries(sourceDir);

  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  for (const entry of entries) {
    offset = await writeClassicZipEntry(chunks, offset, entry, centralDirectory);
  }

  const centralStart = offset;
  for (const entry of centralDirectory) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x031e, 4); // Match Info-ZIP 3.x on Unix.
    header.writeUInt16LE(entry.versionNeeded, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(entry.dosTime, 12);
    header.writeUInt16LE(entry.dosDate, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressedSize, 20);
    header.writeUInt32LE(entry.uncompressedSize, 24);
    header.writeUInt16LE(entry.nameBuffer.length, 28);
    header.writeUInt16LE(entry.centralExtra.length, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(entry.internalAttributes, 36);
    header.writeUInt32LE(entry.externalAttributes, 38);
    header.writeUInt32LE(entry.offset, 42);
    chunks.push(header, entry.nameBuffer, entry.centralExtra);
    offset += header.length + entry.nameBuffer.length + entry.centralExtra.length;
  }

  const centralSize = offset - centralStart;
  if (centralDirectory.length > 0xffff || centralStart > 0xffffffff || centralSize > 0xffffffff) {
    throw new Error("ZIP64 archives are not supported by the PS5-safe ZIP writer.");
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralDirectory.length, 8);
  end.writeUInt16LE(centralDirectory.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);

  await fsp.writeFile(outputZip, Buffer.concat(chunks));

  return entries.length;
}

async function ensureOutputDirectory(folderPath) {
  const resolved = path.resolve(folderPath);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || resolved === "\\\\?") return;
  await fsp.mkdir(resolved, { recursive: true });
}

function sendBuildLog(message) {
  mainWindow.webContents.send("build:log", `${message}\n`);
}

function sendBuildProgress(percent, label, detail) {
  sendBuildLog(`[${Math.round(percent)}%] ${label}: ${detail}`);
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return candidates[0];
}

async function templatePath() {
  return firstExistingPath([
    path.join(process.resourcesPath || "", "project-templates", "y2jb"),
    path.join(APP_ROOT, "src", "shared", "project-templates", "y2jb")
  ]);
}

async function copyDirectory(source, destination) {
  await fsp.mkdir(destination, { recursive: true });
  await fsp.cp(source, destination, {
    recursive: true,
    force: true,
    filter: (src) => !src.includes(`${path.sep}.git${path.sep}`) && !src.endsWith(`${path.sep}.git`)
  });
}

function escapeForPowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function workspaceType(workspacePath) {
  if (fs.existsSync(path.join(workspacePath, "main.js")) && fs.existsSync(path.join(workspacePath, "ps5_autoloader", "autoload.txt"))) return "y2jb";
  return "unknown";
}

function validateWorkspace(workspacePath) {
  const required = ["main.js", "update.js", path.join("ps5_autoloader", "autoload.txt")];
  const missing = required.filter((item) => !fs.existsSync(path.join(workspacePath, item)));
  if (missing.length) {
    throw new Error("Workspace is missing required Y2JB update files: " + missing.join(", "));
  }
}

function parseAutoload(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      if (line.startsWith("!")) return { id: id("entry"), type: "delay", value: line.slice(1).trim() };
      if (line.startsWith("@")) return { id: id("entry"), type: "message", value: line.slice(1).trim() };
      return { id: id("entry"), type: "payload", value: line };
    });
}

function formatAutoload(entries) {
  const usableEntries = (entries || []).filter((entry) => String(entry.value || "").trim());
  if (!usableEntries.length) return "";

  const lines = [
    "#",
    "# Generated by y2JBGenny",
    "# Payload names are case-sensitive. Delay commands are milliseconds.",
    "#",
    ""
  ];

  for (const entry of usableEntries) {
    const value = String(entry.value || "").trim();
    if (entry.type === "delay") lines.push(`!${value}`);
    else if (entry.type === "message") lines.push(`@ ${value}`);
    else lines.push(value);
  }

  return `${lines.join("\n")}\n`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeMakeValue(value, fallback) {
  const clean = String(value || "").trim().replace(/[^\w.\-]/g, "-").replace(/-+/g, "-");
  return clean || fallback;
}

function normalizeHexColor(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  }
  return fallback;
}

function normalizeLookTheme(input = {}) {
  const theme = { ...DEFAULT_LOOK_THEME, ...input };
  for (const key of Object.keys(DEFAULT_LOOK_THEME)) {
    if (key.endsWith("Color")) theme[key] = normalizeHexColor(theme[key], DEFAULT_LOOK_THEME[key]);
  }
  theme.titleText = String(theme.titleText || DEFAULT_LOOK_THEME.titleText).trim().slice(0, 80) || DEFAULT_LOOK_THEME.titleText;
  theme.versionText = String(theme.versionText || DEFAULT_LOOK_THEME.versionText || "v1.0").trim().slice(0, 32) || (DEFAULT_LOOK_THEME.versionText || "v1.0");
  if (theme.versionText === LEGACY_Y2JB_VERSION_TEXT) {
    theme.versionText = DEFAULT_LOOK_THEME.versionText;
  }
  theme.creditText = String(theme.creditText || DEFAULT_LOOK_THEME.creditText || "StonedModder").trim().slice(0, 40) || (DEFAULT_LOOK_THEME.creditText || "StonedModder");
  theme.loaderText = String(theme.loaderText || DEFAULT_LOOK_THEME.loaderText || "Y2Genny").trim().slice(0, 60) || (DEFAULT_LOOK_THEME.loaderText || "Y2Genny");
  theme.protocolTitleText = String(theme.protocolTitleText || DEFAULT_LOOK_THEME.protocolTitleText || "Y2JB // Y2Genny").trim().slice(0, 80) || (DEFAULT_LOOK_THEME.protocolTitleText || "Y2JB // Y2Genny");
  theme.protocolDetailText = String(theme.protocolDetailText || DEFAULT_LOOK_THEME.protocolDetailText || `Y2JB Autoloader ${theme.versionText} by PLK // Offline PS5 Exploit Chain`).trim().slice(0, 140) || (DEFAULT_LOOK_THEME.protocolDetailText || `Y2JB Autoloader ${theme.versionText} by PLK // Offline PS5 Exploit Chain`);
  return theme;
}

function presetForTheme(theme) {
  return LOOK_PRESETS.find((preset) => preset.id === theme.presetId || preset.layoutId === theme.layoutId) || null;
}

async function applyPresetAssets(project, theme) {
  const assets = requiredThemeAssets(theme);
  if (!assets.length) return;

  for (const asset of assets) {
    const sourcePath = path.resolve(APP_ROOT, asset.from);
    const destinationPath = path.join(project.workspacePath, asset.to);
    if (!(await exists(sourcePath))) continue;
    await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
    await fsp.copyFile(sourcePath, destinationPath);
  }
}

function javaColor(value) {
  return `new Color(0x${normalizeHexColor(value, "#000000").slice(1).toUpperCase()})`;
}

function javaString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r?\n/g, " ");
}

async function readY2UiOverrideBlock(theme) {
  if (theme.layoutId === "y2-cyberpunk") {
    const overridePath = path.join(APP_ROOT, "src", "shared", "y2-ui-overrides", "cyberpunk-ui-block.js");
    if (!(await exists(overridePath))) return "";
    return fsp.readFile(overridePath, "utf8");
  }
  if (theme.layoutId === "y2-default") {
    const templateMainPath = path.join(APP_ROOT, "src", "shared", "project-templates", "y2jb", "main.js");
    if (!(await exists(templateMainPath))) return "";
    const templateMain = await fsp.readFile(templateMainPath, "utf8");
    return extractY2UiBlock(templateMain, "    window.autoloader_ui = function()");
  }
  return "";
}

function extractY2UiBlock(js, startNeedle) {
  const start = js.indexOf(startNeedle);
  const end = js.indexOf("\n    try {\n        if (typeof window.autoloader_ui === 'function')", start);
  if (start < 0 || end < 0) return "";
  return `${js.slice(start, end).trimEnd()}\n`;
}

function applyY2UiOverride(js, overrideBlock) {
  if (!overrideBlock) return js;
  const existingOverrideStart = js.indexOf("    window.setSystemStatus = function");
  const stockUiStart = js.indexOf("    window.autoloader_ui = function()");
  const start = existingOverrideStart >= 0 ? existingOverrideStart : stockUiStart;
  const end = js.indexOf("\n    try {\n        if (typeof window.autoloader_ui === 'function')", start);
  if (start < 0 || end < 0) return js;
  return `${js.slice(0, start)}${overrideBlock.trimEnd()}\n${js.slice(end)}`;
}

async function writeY2SplashTheme(project, theme) {
  const splashPath = path.join(project.workspacePath, "splash.html");
  if (!(await exists(splashPath))) return;
  let splash = await fsp.readFile(splashPath, "utf8");
  const head = theme.layoutId === "y2-cyberpunk"
    ? `<head>
    <title>Y2JB</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="cybercore.ps5.css">
    <link rel="stylesheet" href="host-ui.css">
</head>`
    : `<head>
    <title>Y2JB</title>
    <style>
        body {
            font-family: monospace;
            background: #000;
            color: #fff;
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
        #output div {
            white-space: pre;
        }
    </style>
</head>`;
  splash = splash.replace(/<head>[\s\S]*?<\/head>/, head);
  await fsp.writeFile(splashPath, splash, "utf8");
}

function activeLookPreset(theme) {
  return LOOK_PRESETS.find((preset) => preset.id === theme?.presetId || preset.layoutId === theme?.layoutId) || null;
}

function requiredThemeAssets(theme) {
  const presetAssets = activeLookPreset(theme)?.assets || [];
  if (theme?.layoutId !== "y2-cyberpunk") return presetAssets;
  const required = [
    { from: "src/shared/look-preset-assets/y2-cyberpunk-preview/host-ui.css", to: "host-ui.css" },
    { from: "src/shared/look-preset-assets/y2-cyberpunk-preview/cybercore.ps5.css", to: "cybercore.ps5.css" }
  ];
  const byDestination = new Map([...presetAssets, ...required].map((asset) => [asset.to, asset]));
  return [...byDestination.values()];
}

function replaceJsStringAssignment(js, pattern, value) {
  return js.replace(pattern, (_match, prefix) => `${prefix}"${javaString(value)}";`);
}

function replaceJsStyleAssignment(js, pattern, value) {
  return js.replace(pattern, (_match, prefix) => `${prefix}"${javaString(value)}";`);
}

function applyY2TextTheme(js, theme) {
  return js
    .replace(/const autoloader_version = ".*?";/, `const autoloader_version = "${javaString(theme.versionText)}";`)
    .replace(/credit\.textContent = ".*?";/, `credit.textContent = "${javaString(theme.creditText)}";`)
    .replace(/sonicBadge\.textContent = ".*?";/, `sonicBadge.textContent = "${javaString(theme.loaderText)}";`)
    .replace(/detailTitle\.textContent = ".*?";/, `detailTitle.textContent = "${javaString(theme.protocolTitleText)}";`)
    .replace(/detailText\.textContent = ".*?";/, `detailText.textContent = "${javaString(theme.protocolDetailText)}";`);
}

function applyY2DefaultInlineTheme(js, theme) {
  if (theme.layoutId !== "y2-default") return js;
  let themed = js;
  themed = replaceJsStringAssignment(themed, /(title\.textContent = ).*?;/, theme.titleText);
  themed = replaceJsStyleAssignment(themed, /(autoloader_ui\.style\.backgroundColor = ).*?;/, theme.bgColor);
  themed = replaceJsStyleAssignment(themed, /(title\.style\.color = ).*?;/, theme.titleColor);
  themed = replaceJsStyleAssignment(themed, /(logWrapper\.style\.color = ).*?;/, theme.logInfoColor);
  themed = replaceJsStyleAssignment(themed, /(logWrapper\.style\.backgroundColor = ).*?;/, theme.logBgColor);
  themed = replaceJsStyleAssignment(themed, /(logWrapper\.style\.border = ).*?;/, `2px solid ${theme.borderColor}`);
  themed = replaceJsStyleAssignment(themed, /(progressBarContainer\.style\.backgroundColor = ).*?;/, theme.progressBgColor);
  themed = replaceJsStyleAssignment(themed, /(progressBarContainer\.style\.border = ).*?;/, `2px solid ${theme.borderColor}`);
  themed = replaceJsStyleAssignment(themed, /(progressLabel\.style\.color = ).*?;/, theme.progressTextColor);
  themed = replaceJsStyleAssignment(themed, /(progressBar\.style\.backgroundColor = ).*?;/, theme.progressBarColor);
  themed = replaceJsStyleAssignment(themed, /(logEntry\.style\.color = )"red";/, theme.logErrorColor);
  themed = replaceJsStyleAssignment(themed, /(logEntry\.style\.color = )"lightgreen";/, theme.logSuccessColor);
  themed = replaceJsStyleAssignment(themed, /(logEntry\.style\.color = )"yellow";/, theme.logWarningColor);
  themed = replaceJsStyleAssignment(themed, /(logEntry\.style\.color = )"#ccc";/, theme.logInfoColor);
  return themed;
}

async function writeLookTheme(project) {
  await writeY2LookTheme(project);
}

async function writeY2LookTheme(project) {
  const theme = normalizeLookTheme(project.lookTheme);
  await applyPresetAssets(project, theme);

  const cssPath = path.join(project.workspacePath, "host-ui.css");
  let css = null;
  if (theme.layoutId === "y2-cyberpunk" && await exists(cssPath)) {
    css = await fsp.readFile(cssPath, "utf8");
    const replacements = {
      "--cp-yellow": theme.titleColor,
      "--cp-cyan": theme.logInfoColor,
      "--cp-red": theme.logErrorColor,
      "--cp-bg": theme.bgColor,
      "--cp-bg-card": theme.progressBgColor
    };

    for (const [variable, value] of Object.entries(replacements)) {
      const pattern = new RegExp(`(${variable}:\\s*)#[0-9a-fA-F]{6}`, "g");
      css = css.replace(pattern, `$1${value}`);
    }
  }

  project.lookTheme = theme;
  const jsPath = path.join(project.workspacePath, "main.js");
  if (await exists(jsPath)) {
    let js = await fsp.readFile(jsPath, "utf8");
    js = applyY2UiOverride(js, await readY2UiOverrideBlock(theme));
    js = applyY2DefaultInlineTheme(applyY2TextTheme(js, theme), theme);
    await fsp.writeFile(jsPath, js, "utf8");
  }
  await writeY2SplashTheme(project, theme);
  if (css !== null) await fsp.writeFile(cssPath, css, "utf8");
}

function requestUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "User-Agent": "y2JBGenny",
        "Accept": "application/vnd.github+json, text/plain, */*"
      }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects < 5) {
        response.resume();
        resolve(requestUrl(new URL(response.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("error", reject);
  });
}

async function downloadToFile(url, filePath) {
  const data = await requestUrl(url);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, data);
}

function inferSourceKind(url) {
  const lower = url.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if ([...SUPPORTED_PAYLOADS].some((ext) => lower.endsWith(ext))) return "file";
  if (lower.includes("github.com/")) return "github";
  if (lower.includes("gitlab.com/") || lower.includes("git.earthonion.com/")) return "gitlab";
  if (lower.endsWith(".md") || lower.includes("raw.githubusercontent.com")) return "readme";
  return "url";
}

function normalizePayloadSource(sourceInput) {
  const source = {
    id: sourceInput.id || id("src"),
    name: String(sourceInput.name || "Payload source").trim(),
    url: String(sourceInput.url || "").trim(),
    kind: sourceInput.kind || inferSourceKind(sourceInput.url || ""),
    note: String(sourceInput.note || "").trim(),
    releases: Array.isArray(sourceInput.releases) ? sourceInput.releases : [],
    selectedReleaseId: sourceInput.selectedReleaseId || null,
    installedReleaseId: sourceInput.installedReleaseId || null,
    selectedAssetUrls: Array.isArray(sourceInput.selectedAssetUrls) ? sourceInput.selectedAssetUrls : [],
    installedVersion: sourceInput.installedVersion || null,
    installedFiles: Array.isArray(sourceInput.installedFiles) ? sourceInput.installedFiles : [],
    checkedAt: sourceInput.checkedAt || null,
    installedAt: sourceInput.installedAt || null,
    updatedAt: sourceInput.updatedAt || now()
  };
  if (!source.url) throw new Error("Source URL is required.");
  return source;
}

function githubParts(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("github.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch (_error) {
    return null;
  }
}

function gitHostParts(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const releasesIndex = parts.indexOf("releases");
    const projectParts = releasesIndex >= 0 ? parts.slice(0, releasesIndex) : parts.slice(0, 2);
    if (projectParts.length < 2) return null;
    return {
      host: parsed.origin,
      namespace: projectParts[0],
      project: projectParts[1].replace(/\.git$/, ""),
      projectPath: projectParts.slice(0, 2).join("/")
    };
  } catch (_error) {
    return null;
  }
}

function isPayloadAssetName(nameOrUrl) {
  const lower = String(nameOrUrl).toLowerCase().split("?")[0].split("#")[0];
  return lower.endsWith(".zip") || [...SUPPORTED_PAYLOADS].some((ext) => lower.endsWith(ext));
}

function isSourceArchiveAsset(nameOrUrl) {
  const lower = String(nameOrUrl).toLowerCase();
  return lower.includes("/archive/refs/")
    || lower.includes("/-/archive/")
    || lower.includes("/repository/archive")
    || lower.endsWith("source.zip")
    || lower.endsWith("source.tar.gz")
    || lower.endsWith("source.tar.bz2")
    || lower.endsWith("source.tar")
    || lower.endsWith("source.7z");
}

function isPayloadDownloadAsset(nameOrUrl) {
  return isPayloadAssetName(nameOrUrl) && !isSourceArchiveAsset(nameOrUrl);
}

function assetNameFromUrl(url, fallback = "payload-download") {
  try {
    const name = path.basename(decodeURIComponent(new URL(url).pathname));
    return name || fallback;
  } catch (_error) {
    return fallback;
  }
}

function releasePageUrl(source) {
  const github = githubParts(source.url);
  if (github) return `https://github.com/${github.owner}/${github.repo}/releases`;
  const gitHost = gitHostParts(source.url);
  if (gitHost) return `${gitHost.host}/${gitHost.projectPath}/releases`;
  return source.url;
}

function truncateDescription(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n")
    .slice(0, 1200);
}

async function fetchSourceReadme(source) {
  const github = githubParts(source.url);
  if (github) {
    const apiUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/readme`;
    const readme = JSON.parse((await requestUrl(apiUrl)).toString("utf8"));
    if (readme.content) return truncateDescription(Buffer.from(readme.content, "base64").toString("utf8"));
  }

  const gitHost = gitHostParts(source.url);
  if (gitHost) {
    const candidates = [
      `${gitHost.host}/${gitHost.projectPath}/raw/branch/main/README.md`,
      `${gitHost.host}/${gitHost.projectPath}/raw/branch/master/README.md`,
      `${gitHost.host}/${gitHost.projectPath}/-/raw/main/README.md`,
      `${gitHost.host}/${gitHost.projectPath}/-/raw/master/README.md`
    ];
    for (const url of candidates) {
      try {
        return truncateDescription((await requestUrl(url)).toString("utf8"));
      } catch (_error) {
        // Try the next common raw README shape.
      }
    }
  }

  return "";
}

function releaseIdFromParts(provider, value) {
  return `${provider}:${String(value || "direct").replace(/[^\w.\-]+/g, "-")}`;
}

function makeRelease(provider, release, assets) {
  const tag = release.tag_name || release.tag || release.name || release.id || "release";
  const name = release.name || tag;
  return {
    id: releaseIdFromParts(provider, release.id || tag),
    name,
    tag,
    publishedAt: release.published_at || release.created_at || release.created || null,
    assets
  };
}

async function latestGithubReleaseAssets(source) {
  const parts = githubParts(source.url);
  if (!parts) return [];
  const mapAsset = (asset) => ({
    name: asset.name,
    url: asset.browser_download_url,
    kind: inferSourceKind(asset.browser_download_url)
  });

  try {
    const apiUrl = `https://api.github.com/repos/${parts.owner}/${parts.repo}/releases/latest`;
    const release = JSON.parse((await requestUrl(apiUrl)).toString("utf8"));
    const assets = (release.assets || []).filter((asset) => isPayloadDownloadAsset(asset.name) && isPayloadDownloadAsset(asset.browser_download_url)).map(mapAsset);
    if (assets.length) return assets;
  } catch (error) {
    mainWindow.webContents.send("build:log", `GitHub latest release fallback: ${error.message}`);
  }

  try {
    const apiUrl = `https://api.github.com/repos/${parts.owner}/${parts.repo}/releases`;
    const releases = JSON.parse((await requestUrl(apiUrl)).toString("utf8"));
    for (const release of releases || []) {
      const assets = (release.assets || []).filter((asset) => isPayloadDownloadAsset(asset.name) && isPayloadDownloadAsset(asset.browser_download_url)).map(mapAsset);
      if (assets.length) return assets;
    }
  } catch (error) {
    mainWindow.webContents.send("build:log", `GitHub releases API fallback: ${error.message}`);
  }

  const scraped = await scrapeReleaseAssets({ ...source, url: releasePageUrl(source) });
  if (scraped.length) return scraped;

  return [];
}

async function githubReleaseVersions(source) {
  const parts = githubParts(source.url);
  if (!parts) return [];
  const apiUrl = `https://api.github.com/repos/${parts.owner}/${parts.repo}/releases`;
  const releases = JSON.parse((await requestUrl(apiUrl)).toString("utf8"));
  return (releases || [])
    .map((release) => makeRelease("github", release, (release.assets || [])
      .filter((asset) => isPayloadDownloadAsset(asset.name) && isPayloadDownloadAsset(asset.browser_download_url))
      .map((asset) => ({
        name: asset.name,
        url: asset.browser_download_url,
        kind: inferSourceKind(asset.browser_download_url)
      }))))
    .filter((release) => release.assets.length);
}

async function latestGitlabReleaseAssets(source) {
  const parts = gitHostParts(source.url);
  if (!parts) return [];
  const encoded = encodeURIComponent(parts.projectPath);
  const apiUrl = `${parts.host}/api/v4/projects/${encoded}/releases`;
  const releases = JSON.parse((await requestUrl(apiUrl)).toString("utf8"));
  const ordered = Array.isArray(releases) ? releases : [releases];
  for (const release of ordered) {
    const links = [
      ...((release?.assets?.links || []).map((asset) => ({ name: asset.name, url: asset.direct_asset_url || asset.url }))),
      ...((release?.assets?.sources || []).map((asset) => ({ name: asset.format ? `${release.tag_name || "source"}.${asset.format}` : asset.url, url: asset.url })))
    ];
    const assets = links
      .filter((asset) => asset.url && isPayloadDownloadAsset(asset.name || asset.url) && isPayloadDownloadAsset(asset.url))
      .map((asset) => ({
        name: asset.name || assetNameFromUrl(asset.url),
        url: asset.url,
        kind: inferSourceKind(asset.url)
      }));
    if (assets.length) return assets;
  }
  return [];
}

async function gitlabReleaseVersions(source) {
  const parts = gitHostParts(source.url);
  if (!parts) return [];
  const encoded = encodeURIComponent(parts.projectPath);
  const apiUrl = `${parts.host}/api/v4/projects/${encoded}/releases`;
  const releases = JSON.parse((await requestUrl(apiUrl)).toString("utf8"));
  return (Array.isArray(releases) ? releases : [releases])
    .map((release) => {
      const links = [
        ...((release?.assets?.links || []).map((asset) => ({ name: asset.name, url: asset.direct_asset_url || asset.url }))),
        ...((release?.assets?.sources || []).map((asset) => ({ name: asset.format ? `${release.tag_name || "source"}.${asset.format}` : asset.url, url: asset.url })))
      ];
      const assets = links
        .filter((asset) => asset.url && isPayloadDownloadAsset(asset.name || asset.url) && isPayloadDownloadAsset(asset.url))
        .map((asset) => ({ name: asset.name || assetNameFromUrl(asset.url), url: asset.url, kind: inferSourceKind(asset.url) }));
      return makeRelease("gitlab", release, assets);
    })
    .filter((release) => release.assets.length);
}

async function latestGiteaReleaseAssets(source) {
  const parts = gitHostParts(source.url);
  if (!parts) return [];
  const apiUrl = `${parts.host}/api/v1/repos/${parts.projectPath}/releases`;
  const releases = JSON.parse((await requestUrl(apiUrl)).toString("utf8"));
  for (const release of releases || []) {
    const assets = (release.assets || [])
      .map((asset) => ({
        name: asset.name,
        url: asset.browser_download_url || asset.download_url || asset.url
      }))
      .filter((asset) => asset.url && isPayloadDownloadAsset(asset.name || asset.url) && isPayloadDownloadAsset(asset.url))
      .map((asset) => ({
        name: asset.name || assetNameFromUrl(asset.url),
        url: asset.url,
        kind: inferSourceKind(asset.url)
      }));
    if (assets.length) return assets;
  }
  return [];
}

async function giteaReleaseVersions(source) {
  const parts = gitHostParts(source.url);
  if (!parts) return [];
  const apiUrl = `${parts.host}/api/v1/repos/${parts.projectPath}/releases`;
  const releases = JSON.parse((await requestUrl(apiUrl)).toString("utf8"));
  return (releases || [])
    .map((release) => {
      const assets = (release.assets || [])
        .map((asset) => ({ name: asset.name, url: asset.browser_download_url || asset.download_url || asset.url }))
        .filter((asset) => asset.url && isPayloadDownloadAsset(asset.name || asset.url) && isPayloadDownloadAsset(asset.url))
        .map((asset) => ({ name: asset.name || assetNameFromUrl(asset.url), url: asset.url, kind: inferSourceKind(asset.url) }));
      return makeRelease("gitea", release, assets);
    })
    .filter((release) => release.assets.length);
}

async function scrapeReleaseAssets(source) {
  const html = (await requestUrl(source.url)).toString("utf8");
  const found = new Map();
  const hrefPattern = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefPattern.exec(html))) {
    const href = match[1].replace(/&amp;/g, "&");
    const url = new URL(href, source.url).toString();
    if ((!isPayloadDownloadAsset(href) && !isPayloadDownloadAsset(url)) || isSourceArchiveAsset(url)) continue;
    if (!found.has(url)) {
      found.set(url, {
        name: assetNameFromUrl(url),
        url,
        kind: inferSourceKind(url)
      });
    }
  }
  return [...found.values()];
}

async function scrapeReleaseVersions(source) {
  const assets = await scrapeReleaseAssets({ ...source, url: releasePageUrl(source) });
  return assets.length ? [{
    id: releaseIdFromParts("scrape", releasePageUrl(source)),
    name: "Release page assets",
    tag: "release-page",
    publishedAt: null,
    assets
  }] : [];
}

function directSourceVersion(source) {
  if (!isPayloadDownloadAsset(source.url)) return [];
  return [{
    id: releaseIdFromParts("direct", source.url),
    name: "Direct URL",
    tag: assetNameFromUrl(source.url, source.name),
    publishedAt: null,
    assets: [{ name: assetNameFromUrl(source.url, source.name), url: source.url, kind: inferSourceKind(source.url) }]
  }];
}

async function sourceReleaseVersions(source) {
  const direct = directSourceVersion(source);
  if (direct.length) return direct;

  if (source.kind === "github" || githubParts(source.url)) {
    try {
      const releases = await githubReleaseVersions(source);
      if (releases.length) return releases;
    } catch (error) {
      mainWindow.webContents.send("build:log", `GitHub version check fallback: ${error.message}`);
    }
    return scrapeReleaseVersions(source);
  }

  if (source.kind === "gitlab" || String(source.url).includes("gitlab.com/") || String(source.url).includes("git.earthonion.com/")) {
    try {
      const releases = await gitlabReleaseVersions(source);
      if (releases.length) return releases;
    } catch (error) {
      mainWindow.webContents.send("build:log", `GitLab version check fallback: ${error.message}`);
    }
    try {
      const releases = await giteaReleaseVersions(source);
      if (releases.length) return releases;
    } catch (error) {
      mainWindow.webContents.send("build:log", `Gitea version check fallback: ${error.message}`);
    }
    return scrapeReleaseVersions(source);
  }

  return direct;
}

async function sourceDownloadCandidates(source, releaseId = null, assetUrls = null) {
  const releases = source.releases?.length ? source.releases : await sourceReleaseVersions(source);
  if (releases.length) {
    const selected = releases.find((release) => release.id === releaseId)
      || releases.find((release) => release.id === source.selectedReleaseId)
      || releases[0];
    const selectedUrls = Array.isArray(assetUrls) && assetUrls.length ? assetUrls : source.selectedAssetUrls;
    const assets = selectedUrls?.length
      ? selected.assets.filter((asset) => selectedUrls.includes(asset.url))
      : selected.assets;
    return assets.map((asset) => ({ ...asset, release: selected }));
  }

  if (isPayloadDownloadAsset(source.url)) {
    return [{ name: assetNameFromUrl(source.url, source.name), url: source.url, kind: inferSourceKind(source.url) }];
  }
  if (source.kind === "github" || githubParts(source.url)) {
    return latestGithubReleaseAssets(source);
  }
  if (source.kind === "gitlab" || String(source.url).includes("gitlab.com/") || String(source.url).includes("git.earthonion.com/")) {
    try {
      const assets = await latestGitlabReleaseAssets(source);
      if (assets.length) return assets;
    } catch (error) {
      mainWindow.webContents.send("build:log", `GitLab API fallback: ${error.message}`);
    }
    try {
      const assets = await latestGiteaReleaseAssets(source);
      if (assets.length) return assets;
    } catch (error) {
      mainWindow.webContents.send("build:log", `Gitea API fallback: ${error.message}`);
    }
    return scrapeReleaseAssets({ ...source, url: releasePageUrl(source) });
  }
  return [{ name: assetNameFromUrl(source.url, source.name), url: source.url, kind: inferSourceKind(source.url) }];
}

async function extractZip(zipPath, destination) {
  await fsp.mkdir(destination, { recursive: true });
  await new Promise((resolve, reject) => {
    const command = `Expand-Archive -LiteralPath ${escapeForPowerShell(zipPath)} -DestinationPath ${escapeForPowerShell(destination)} -Force`;
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Expand-Archive exited with code ${code}`)));
  });
}

async function findPayloadFiles(root) {
  const results = [];
  async function walk(dir) {
    const items = await fsp.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await walk(full);
      else if (SUPPORTED_PAYLOADS.has(path.extname(item.name).toLowerCase())) results.push(full);
    }
  }
  await walk(root);
  return results;
}

function safeFolderName(value) {
  return String(value || "payload-package")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "payload-package";
}

function relativeAutoloadPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

async function directoryHasSidecars(dir) {
  const items = await fsp.readdir(dir, { withFileTypes: true });
  return items.some((item) => {
    if (item.name.startsWith(".")) return false;
    if (item.isDirectory()) return true;
    return !SUPPORTED_PAYLOADS.has(path.extname(item.name).toLowerCase());
  });
}

async function copyPayloadPackage(project, packageDir, payloadFiles, packageName, entries) {
  const destinationDir = path.join(project.workspacePath, "ps5_autoloader");
  const installFolder = safeFolderName(packageName);
  const targetDir = path.join(destinationDir, installFolder);
  await fsp.rm(targetDir, { recursive: true, force: true });
  await fsp.cp(packageDir, targetDir, {
    recursive: true,
    force: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== ".git" && base !== ".github" && base !== "__MACOSX";
    }
  });

  const imported = [];
  for (const payloadFile of payloadFiles) {
    const relativeToPackage = path.relative(packageDir, payloadFile);
    const autoloadPath = relativeAutoloadPath(path.join(installFolder, relativeToPackage));
    if (entries !== null && !entries.some((entry) => entry.type === "payload" && entry.value === autoloadPath)) {
      entries.push({ id: id("entry"), type: "payload", value: autoloadPath });
    }
    imported.push(autoloadPath);
  }
  return imported;
}

async function importExtractedPayloads(project, extractDir, packageName, entries) {
  const payloadFiles = await findPayloadFiles(extractDir);
  if (!payloadFiles.length) return [];

  const payloadDirs = [...new Set(payloadFiles.map((file) => path.dirname(file)))];
  if (payloadDirs.length === 1 && await directoryHasSidecars(payloadDirs[0])) {
    return copyPayloadPackage(project, payloadDirs[0], payloadFiles, packageName, entries);
  }

  const imported = [];
  for (const payloadFile of payloadFiles) {
    imported.push(await importPayloadFile(project, payloadFile, entries));
  }
  return imported;
}

async function importPayloadFile(project, filePath, entries) {
  const destinationDir = path.join(project.workspacePath, "ps5_autoloader");
  await fsp.mkdir(destinationDir, { recursive: true });
  const fileName = path.basename(filePath);
  await fsp.copyFile(filePath, path.join(destinationDir, fileName));
  if (entries !== null && !entries.some((entry) => entry.type === "payload" && entry.value === fileName)) {
    entries.push({ id: id("entry"), type: "payload", value: fileName });
  }
  return fileName;
}

async function readWorkspaceProject(workspacePath, baseProject = {}) {
  validateWorkspace(workspacePath);

  const autoloadPath = path.join(workspacePath, "ps5_autoloader", "autoload.txt");

  return {
    id: baseProject.id || id("project"),
    name: baseProject.name || path.basename(workspacePath),
    projectType: "y2jb",
    workspacePath,
    sourceTemplatePath: baseProject.sourceTemplatePath || null,
    discLabel: baseProject.discLabel || "y2jb-update",
    discVersion: baseProject.discVersion || "1.0",
    discTitle: baseProject.discTitle || "Y2JB Autoloader",
    themeAccent: baseProject.themeAccent || "#fcee0a",
    lookTheme: normalizeLookTheme(baseProject.lookTheme),
    thumbnailPath: path.join(workspacePath, "icon0.png"),
    autoload: parseAutoload(await fsp.readFile(autoloadPath, "utf8")),
    createdAt: baseProject.createdAt || now(),
    updatedAt: now()
  };
}

async function payloadInventory(project) {
  const dir = path.join(project.workspacePath, "ps5_autoloader");
  try {
    const files = await findPayloadFiles(dir);
    return files
      .map((file) => relativeAutoloadPath(path.relative(dir, file)))
      .sort((a, b) => a.localeCompare(b));
  } catch (_error) {
    return [];
  }
}

function sourceInstalledInPayloadFolder(source, payloads) {
  const payloadNames = new Set(payloads.map((payload) => path.basename(payload).toLowerCase()));
  return (source.installedFiles || []).some((file) => payloadNames.has(path.basename(file).toLowerCase()));
}

function releaseLabel(release) {
  return release?.tag || release?.name || "unknown";
}

function isUpdateAvailable(source, latestRelease) {
  if (!source.installedReleaseId || !latestRelease) return false;
  if (source.installedReleaseId === latestRelease.id) return false;
  const installedTag = source.installedVersion;
  const latestTag = releaseLabel(latestRelease);
  if (installedTag && latestTag && installedTag === latestTag) return false;
  return true;
}

async function checkInstalledPayloadSources(project) {
  const payloads = await payloadInventory(project);
  const matched = (db.payloadSources || []).filter((source) => sourceInstalledInPayloadFolder(source, payloads));
  const summary = {
    checkedAt: now(),
    payloadCount: payloads.length,
    checked: [],
    updates: [],
    failed: []
  };

  if (!payloads.length || !matched.length) return summary;

  for (const source of matched) {
    try {
      const releases = await sourceReleaseVersions(source);
      source.releases = releases;
      source.checkedAt = summary.checkedAt;
      if (!source.selectedReleaseId && releases[0]) source.selectedReleaseId = releases[0].id;
      source.updateAvailable = isUpdateAvailable(source, releases[0]);
      source.updatedAt = summary.checkedAt;

      const item = {
        id: source.id,
        name: source.name,
        local: source.installedVersion || "unknown",
        latest: releaseLabel(releases[0]),
        updateAvailable: source.updateAvailable
      };
      summary.checked.push(item);
      if (source.updateAvailable) summary.updates.push(item);
      mainWindow.webContents.send("build:log", `Checked installed source ${source.name}: ${releases.length} version(s).`);
    } catch (error) {
      const item = {
        id: source.id,
        name: source.name,
        error: error.message || String(error)
      };
      summary.failed.push(item);
      mainWindow.webContents.send("build:log", `Installed source check failed for ${source.name}: ${item.error}`);
    }
  }

  await saveDb();
  return summary;
}

async function thumbnailDataUrl(project) {
  if (!project?.thumbnailPath) return null;
  try {
    const data = await fsp.readFile(project.thumbnailPath);
    return `data:image/png;base64,${data.toString("base64")}`;
  } catch (_error) {
    return null;
  }
}

function iconTarget(project) {
  return {
    width: 512,
    height: 512,
    destination: path.join(project.workspacePath, "icon0.png"),
    label: "Y2JB update icon"
  };
}

function centerCropRect(sourceSize, targetSize) {
  const sourceAspect = sourceSize.width / sourceSize.height;
  const targetAspect = targetSize.width / targetSize.height;
  if (sourceAspect > targetAspect) {
    const width = Math.round(sourceSize.height * targetAspect);
    return {
      x: Math.floor((sourceSize.width - width) / 2),
      y: 0,
      width,
      height: sourceSize.height
    };
  }

  const height = Math.round(sourceSize.width / targetAspect);
  return {
    x: 0,
    y: Math.floor((sourceSize.height - height) / 2),
    width: sourceSize.width,
    height
  };
}

async function writeResizedIcon(sourcePath, target) {
  const source = nativeImage.createFromPath(sourcePath);
  if (source.isEmpty()) {
    throw new Error("Selected image could not be read. Use a valid PNG, JPG, or JPEG file.");
  }

  const cropped = source.crop(centerCropRect(source.getSize(), target));
  const resized = cropped.resize({
    width: target.width,
    height: target.height,
    quality: "best"
  });
  await fsp.mkdir(path.dirname(target.destination), { recursive: true });
  await fsp.writeFile(target.destination, resized.toPNG());
}

async function environmentStatus() {
  const y2Template = await templatePath();
  return {
    templateFound: await exists(y2Template),
    zipFound: true,
    zipHint: "Native ZIP builder ready."
  };
}

async function statePayload() {
  const project = activeProject();
  const y2Template = await templatePath();
  return {
    db,
    activeProject: project,
    payloads: project ? await payloadInventory(project) : [],
    thumbnailDataUrl: project ? await thumbnailDataUrl(project) : null,
    payloadSources: db.payloadSources || [],
    recentProjects: recentProjectSummaries(),
    environment: await environmentStatus(),
    settings: db.settings || {},
    defaultTemplate: y2Template,
    dbPath
  };
}

async function writeProjectFiles(project) {
  const hasRuntime = fs.existsSync(path.join(project.workspacePath, "main.js"))
    && fs.existsSync(path.join(project.workspacePath, "update.js"));
  if (!hasRuntime) {
    const tmpl = await templatePath();
    await fsp.cp(tmpl, project.workspacePath, { recursive: true, force: false });
  }

  validateWorkspace(project.workspacePath);

  project.projectType = "y2jb";
  project.discLabel = sanitizeMakeValue(project.discLabel, "y2jb-update");
  project.discVersion = sanitizeMakeValue(project.discVersion, "1.0");
  project.discTitle = String(project.discTitle || "Y2JB Autoloader").trim();
  project.name = String(project.name || path.basename(project.workspacePath)).trim();
  project.updatedAt = now();

  const autoloadPath = path.join(project.workspacePath, "ps5_autoloader", "autoload.txt");
  await fsp.mkdir(path.dirname(autoloadPath), { recursive: true });
  await fsp.writeFile(autoloadPath, formatAutoload(project.autoload || []), "utf8");
  await writeLookTheme(project);
}

function upsertProject(project) {
  const existing = db.projects.findIndex((item) => item.id === project.id);
  if (existing >= 0) db.projects[existing] = project;
  else db.projects.unshift(project);
  db.activeProjectId = project.id;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#090b10",
    title: "y2JBGenny",
    webPreferences: {
      preload: path.join(APP_ROOT, "src", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(APP_ROOT, "src", "renderer", "index.html"));
}

ipcMain.handle("app:get-state", async () => statePayload());

ipcMain.handle("project:create-y2-from-template", async () => {
  const y2Template = await templatePath();
  if (!(await exists(y2Template))) {
    throw new Error(`Y2JB template not found at ${y2Template}`);
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose where to create the y2JBGenny workspace",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled) return { ...(await statePayload()), canceled: true };

  const destination = path.join(result.filePaths[0], `y2jbgenny-update-${Date.now()}`);
  await copyDirectory(y2Template, destination);
  const project = await readWorkspaceProject(destination, {
    name: path.basename(destination),
    projectType: "y2jb",
    sourceTemplatePath: y2Template,
    lookTheme: LOOK_PRESETS.find((preset) => preset.id === "y2-cyberpunk-preview")?.theme
  });
  upsertProject(project);
  await writeProjectFiles(project);
  await saveDb();
  return statePayload();
});

ipcMain.handle("project:open-workspace", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open an existing Y2JB update workspace",
    properties: ["openDirectory"]
  });
  if (result.canceled) return { ...(await statePayload()), canceled: true };

  const workspacePath = result.filePaths[0];
  const existing = db.projects.find((project) => project.workspacePath === workspacePath);
  const project = await readWorkspaceProject(workspacePath, existing || {});
  upsertProject(project);
  await saveDb();
  return statePayload();
});

ipcMain.handle("project:open-recent", async (_event, { projectId }) => {
  const project = findProject(projectId);
  db.activeProjectId = project.id;
  project.updatedAt = now();
  await saveDb();
  return statePayload();
});

ipcMain.handle("project:save", async (_event, projectInput) => {
  const project = { ...findProject(projectInput.id), ...projectInput };
  await writeProjectFiles(project);
  upsertProject(project);
  await saveDb();
  return statePayload();
});

ipcMain.handle("project:save-look", async (_event, { projectId, lookTheme }) => {
  const project = findProject(projectId);
  project.lookTheme = normalizeLookTheme(lookTheme);
  await writeLookTheme(project);
  project.updatedAt = now();
  upsertProject(project);
  await saveDb();
  mainWindow.webContents.send("build:log", "Saved autoloader look theme.");
  return statePayload();
});

ipcMain.handle("project:add-payloads", async (_event, { projectId }) => {
  const project = findProject(projectId);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import payload files to folder",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Payloads or ZIP archives", extensions: ["elf", "bin", "jar", "js", "zip"] }]
  });
  if (result.canceled) return statePayload();

  const destinationDir = path.join(project.workspacePath, "ps5_autoloader");
  await fsp.mkdir(destinationDir, { recursive: true });
  const keepAutoloadManual = null;
  for (const filePath of result.filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    if (SUPPORTED_PAYLOADS.has(ext)) {
      await importPayloadFile(project, filePath, keepAutoloadManual);
    } else if (ext === ".zip") {
      const tempRoot = await fsp.mkdtemp(path.join(app.getPath("temp"), "bdjb-local-zip-"));
      try {
        await extractZip(filePath, tempRoot);
        const imported = await importExtractedPayloads(project, tempRoot, path.basename(filePath), keepAutoloadManual);
        mainWindow.webContents.send("build:log", `Imported ${imported.length} payload file(s) from ${path.basename(filePath)}.`);
      } finally {
        await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
  return statePayload();
});

ipcMain.handle("payload-source:add", async (_event, sourceInput) => {
  upsertPayloadSource(sourceInput, { preserveExistingMetadata: true });
  await saveDb();
  return statePayload();
});

ipcMain.handle("payload-source:export", async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export payload source list",
    defaultPath: "y2jbgenny-payload-sources.json",
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled) return statePayload();

  const content = {
    version: 1,
    exportedAt: now(),
    payloadSources: db.payloadSources || []
  };
  await fsp.writeFile(result.filePath, JSON.stringify(content, null, 2), "utf8");
  mainWindow.webContents.send("build:log", `Exported payload sources to ${result.filePath}`);
  return statePayload();
});

ipcMain.handle("payload-source:import", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import payload source list",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled) return statePayload();

  const parsed = JSON.parse(await fsp.readFile(result.filePaths[0], "utf8"));
  const list = Array.isArray(parsed) ? parsed : parsed.payloadSources;
  if (!Array.isArray(list)) throw new Error("Import JSON must be an array or contain payloadSources.");

  let imported = 0;
  for (const sourceInput of list) {
    try {
      const result = upsertPayloadSource(sourceInput, { preserveExistingMetadata: true });
      if (result.created) imported += 1;
    } catch (error) {
      mainWindow.webContents.send("build:log", `Import skipped a source: ${error.message}`);
    }
  }
  await saveDb();
  mainWindow.webContents.send("build:log", `Imported ${imported} new payload source(s). Existing sources were kept.`);
  return statePayload();
});

ipcMain.handle("payload-source:clear", async () => {
  db.payloadSources = [];
  await saveDb();
  mainWindow.webContents.send("build:log", "Payload source database cleared.");
  return statePayload();
});

ipcMain.handle("payload-source:check", async (_event, { sourceId }) => {
  const source = db.payloadSources.find((item) => item.id === sourceId);
  if (!source) throw new Error("Payload source not found.");
  const releases = await sourceReleaseVersions(source);
  source.releases = releases;
  source.checkedAt = now();
  if (!source.selectedReleaseId && releases[0]) source.selectedReleaseId = releases[0].id;
  source.updateAvailable = isUpdateAvailable(source, releases[0]);
  source.updatedAt = now();
  await saveDb();
  mainWindow.webContents.send("build:log", `Checked ${source.name}: ${releases.length} version(s).`);
  return statePayload();
});

ipcMain.handle("payload-source:set-version", async (_event, { sourceId, releaseId }) => {
  const source = db.payloadSources.find((item) => item.id === sourceId);
  if (!source) throw new Error("Payload source not found.");
  source.selectedReleaseId = releaseId || null;
  source.selectedAssetUrls = [];
  source.updatedAt = now();
  await saveDb();
  return statePayload();
});

ipcMain.handle("payload-source:set-assets", async (_event, { sourceId, assetUrls }) => {
  const source = db.payloadSources.find((item) => item.id === sourceId);
  if (!source) throw new Error("Payload source not found.");
  source.selectedAssetUrls = Array.isArray(assetUrls) ? assetUrls : [];
  source.updatedAt = now();
  await saveDb();
  return statePayload();
});

ipcMain.handle("payload-source:update", async (_event, sourceInput) => {
  const existing = db.payloadSources.find((item) => item.id === sourceInput.id);
  if (!existing) throw new Error("Payload source not found.");
  const next = normalizePayloadSource({ ...existing, ...sourceInput, updatedAt: now() });
  Object.assign(existing, next);
  await saveDb();
  return statePayload();
});

async function downloadPayloadSource(project, source, releaseId, assetUrls = null) {
  const tempRoot = await fsp.mkdtemp(path.join(app.getPath("temp"), "bdjb-payload-"));
  const imported = [];
  const candidates = [];
  const autoloadBeforeDownload = Array.isArray(project.autoload)
    ? JSON.parse(JSON.stringify(project.autoload))
    : [];

  candidates.push(...await sourceDownloadCandidates(source, releaseId, assetUrls));

  if (!candidates.length) {
    throw new Error("No release assets found. Add a direct .zip/.elf/.bin/.jar URL for this source.");
  }

  for (const candidate of candidates) {
    const downloadPath = path.join(tempRoot, candidate.name || `payload-${Date.now()}`);
    mainWindow.webContents.send("build:log", `Downloading ${candidate.name || candidate.url}`);
    await downloadToFile(candidate.url, downloadPath);
    if (candidate.kind === "zip" || downloadPath.toLowerCase().endsWith(".zip")) {
      const extractDir = path.join(tempRoot, `${path.basename(downloadPath, ".zip")}-extract`);
      await extractZip(downloadPath, extractDir);
      const packageImports = await importExtractedPayloads(project, extractDir, candidate.name, null);
      mainWindow.webContents.send("build:log", `Imported ${packageImports.length} payload file(s) from ${candidate.name}.`);
      imported.push(...packageImports);
    } else if (SUPPORTED_PAYLOADS.has(path.extname(downloadPath).toLowerCase())) {
      imported.push(await importPayloadFile(project, downloadPath, null));
    }
  }

  const release = candidates.find((candidate) => candidate.release)?.release || source.releases?.find((item) => item.id === releaseId || item.id === source.selectedReleaseId) || null;
  source.installedReleaseId = release?.id || null;
  source.installedVersion = release?.tag || release?.name || null;
  source.installedFiles = imported;
  source.installedAt = now();
  source.updateAvailable = isUpdateAvailable(source, source.releases?.[0]);
  source.updatedAt = now();
  project.autoload = autoloadBeforeDownload;
  upsertProject(project);
  await saveDb();
  mainWindow.webContents.send("build:log", imported.length ? `Imported: ${imported.join(", ")}` : "No supported payload files found.");
  return imported;
}

ipcMain.handle("payload-source:download", async (_event, { projectId, sourceId, releaseId, assetUrls }) => {
  const project = findProject(projectId);
  const source = db.payloadSources.find((item) => item.id === sourceId);
  if (!source) throw new Error("Payload source not found.");
  await downloadPayloadSource(project, source, releaseId, assetUrls);
  return statePayload();
});

ipcMain.handle("payload-source:check-all", async (_event, { fetchReadmes }) => {
  for (const source of db.payloadSources) {
    try {
      const releases = await sourceReleaseVersions(source);
      source.releases = releases;
      source.checkedAt = now();
      if (!source.selectedReleaseId && releases[0]) source.selectedReleaseId = releases[0].id;
      source.updateAvailable = isUpdateAvailable(source, releases[0]);
      if (fetchReadmes) {
        try {
          const description = await fetchSourceReadme(source);
          if (description) source.note = description;
        } catch (error) {
          mainWindow.webContents.send("build:log", `README fetch failed for ${source.name}: ${error.message}`);
        }
      }
      source.updatedAt = now();
      mainWindow.webContents.send("build:log", `Checked ${source.name}: ${releases.length} version(s).`);
    } catch (error) {
      mainWindow.webContents.send("build:log", `Check failed for ${source.name}: ${error.message}`);
    }
  }
  await saveDb();
  return statePayload();
});

ipcMain.handle("payload-source:download-all", async (_event, { projectId, updatesOnly }) => {
  const project = findProject(projectId);
  for (const source of db.payloadSources) {
    if (updatesOnly && !source.updateAvailable) continue;
    try {
      if (!source.releases?.length) {
        source.releases = await sourceReleaseVersions(source);
        if (!source.selectedReleaseId && source.releases[0]) source.selectedReleaseId = source.releases[0].id;
      }
      const releaseId = updatesOnly
        ? source.releases?.[0]?.id
        : source.selectedReleaseId;
      await downloadPayloadSource(project, source, releaseId, source.selectedAssetUrls);
    } catch (error) {
      mainWindow.webContents.send("build:log", `Get failed for ${source.name}: ${error.message}`);
    }
  }
  await saveDb();
  return statePayload();
});

ipcMain.handle("payload-source:check-installed", async (_event, { projectId }) => {
  const project = findProject(projectId);
  const updateSummary = await checkInstalledPayloadSources(project);
  return {
    ...await statePayload(),
    updateSummary
  };
});

ipcMain.handle("payload-source:download-updates", async (_event, { projectId, sourceIds }) => {
  const project = findProject(projectId);
  const requested = new Set(Array.isArray(sourceIds) ? sourceIds : []);
  const failed = [];
  for (const source of db.payloadSources) {
    if (!requested.has(source.id)) continue;
    try {
      source.releases = await sourceReleaseVersions(source);
      if (!source.selectedReleaseId && source.releases[0]) source.selectedReleaseId = source.releases[0].id;
      const latest = source.releases?.[0];
      if (!latest) throw new Error("No release assets found for update.");
      await downloadPayloadSource(project, source, latest.id, null);
    } catch (error) {
      const item = {
        id: source.id,
        name: source.name,
        error: error.message || String(error)
      };
      failed.push(item);
      mainWindow.webContents.send("build:log", `Update failed for ${source.name}: ${item.error}`);
    }
  }
  await saveDb();
  const updateSummary = await checkInstalledPayloadSources(project);
  updateSummary.failed.push(...failed);
  return {
    ...await statePayload(),
    updateSummary
  };
});

ipcMain.handle("project:set-thumbnail", async (_event, { projectId }) => {
  const project = findProject(projectId);
  const target = iconTarget(project);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Choose ${target.label}`,
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg"] },
      { name: "PNG", extensions: ["png"] },
      { name: "JPEG", extensions: ["jpg", "jpeg"] }
    ]
  });
  if (result.canceled) return statePayload();

  await writeResizedIcon(result.filePaths[0], target);
  project.thumbnailPath = target.destination;
  project.updatedAt = now();
  upsertProject(project);
  await saveDb();
  mainWindow.webContents.send("build:log", `Updated ${target.label}: ${target.width}x${target.height} PNG.`);
  return statePayload();
});

ipcMain.handle("project:reveal", async (_event, { projectId }) => {
  const project = findProject(projectId);
  await shell.openPath(project.workspacePath);
  return statePayload();
});

ipcMain.handle("project:build-update-zip", async (_event, projectInput) => {
  const project = { ...findProject(projectInput.id), ...projectInput, projectType: "y2jb" };
  sendBuildProgress(5, "Preparing workspace", "Saving autoload order and applying the selected theme.");
  await writeProjectFiles(project);
  upsertProject(project);
  await saveDb();

  const outputZip = path.join(path.dirname(project.workspacePath), path.basename(project.workspacePath) + ".zip");
  const outputFolder = path.dirname(outputZip);
  const tempDir = await fsp.mkdtemp(path.join(app.getPath("temp"), "y2jb-zip-"));
  const tempZip = path.join(path.dirname(tempDir), `${path.basename(tempDir)}.zip`);
  try {
    sendBuildProgress(12, "Preparing staging folder", `Using temporary folder ${tempDir}.`);
    const workspaceManifestPath = path.join(project.workspacePath, "update-info.txt");
    const manifestContent = await exists(workspaceManifestPath)
      ? await fsp.readFile(workspaceManifestPath, "utf8")
      : "";
    sendBuildProgress(20, "Reading manifest", manifestContent ? "Loaded update-info.txt from the active workspace." : "No update-info.txt found; building from staged files.");
    const manifestRootFiles = new Set(
      manifestContent.split("\n")
        .map((line) => line.trim().split("|")[0])
        .filter((file) => file && !file.startsWith("ps5_autoloader/"))
    );
    const normalizedTheme = normalizeLookTheme(project.lookTheme);
    for (const asset of requiredThemeAssets(normalizedTheme)) {
      manifestRootFiles.add(asset.to);
    }
    sendBuildProgress(28, "Collecting root files", `Prepared ${manifestRootFiles.size} root file reference(s).`);

    let copiedRootFiles = 0;
    const missingRootFiles = [];
    for (const file of manifestRootFiles) {
      const src = path.join(project.workspacePath, ...file.split("/"));
      const dest = path.join(tempDir, ...file.split("/"));
      if (await exists(src)) {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(src, dest);
        copiedRootFiles += 1;
      } else if (file === "host-ui.css" || file === "cybercore.ps5.css") {
        missingRootFiles.push(file);
      }
    }
    if (missingRootFiles.length) {
      throw new Error(`The selected theme is missing required asset(s): ${missingRootFiles.join(", ")}`);
    }
    sendBuildProgress(38, "Copying root files", `Copied ${copiedRootFiles} root file(s) into ZIP staging.`);

    const tempAutoloaderDir = path.join(tempDir, "ps5_autoloader");
    await fsp.mkdir(tempAutoloaderDir, { recursive: true });

    const autoloadSrc = path.join(project.workspacePath, "ps5_autoloader", "autoload.txt");
    if (await exists(autoloadSrc)) {
      await fsp.copyFile(autoloadSrc, path.join(tempAutoloaderDir, "autoload.txt"));
      sendBuildProgress(46, "Copying autoload manifest", "Copied ps5_autoloader/autoload.txt.");
    } else {
      sendBuildProgress(46, "Copying autoload manifest", "No autoload.txt found in workspace.");
    }

    const srcAutoloaderDir = path.join(project.workspacePath, "ps5_autoloader");
    const payloadEntries = (project.autoload || []).filter((entry) => entry.type === "payload" && String(entry.value || "").trim());
    const seenFiles = new Set();
    const missingPayloads = [];
    let copiedPayloadFiles = 0;
    sendBuildProgress(54, "Collecting payload files", `Checking ${payloadEntries.length} payload row(s) from the autoload queue.`);
    for (const entry of payloadEntries) {
      const relPath = String(entry.value).replace(/\\/g, "/").trim();
      if (seenFiles.has(relPath)) continue;
      seenFiles.add(relPath);
      const srcFile = path.join(srcAutoloaderDir, ...relPath.split("/"));
      if (!(await exists(srcFile))) {
        missingPayloads.push(relPath);
        continue;
      }
      const stat = await fsp.stat(srcFile);
      if (stat.isDirectory()) continue;
      const destFile = path.join(tempAutoloaderDir, ...relPath.split("/"));
      await fsp.mkdir(path.dirname(destFile), { recursive: true });
      await fsp.copyFile(srcFile, destFile);
      copiedPayloadFiles += 1;
    }
    if (missingPayloads.length) {
      throw new Error(`Autoload references missing payload file(s): ${missingPayloads.join(", ")}`);
    }
    sendBuildProgress(64, "Copying payload files", `Copied ${copiedPayloadFiles} unique payload file(s).`);

    const updateInfoLines = await buildUpdateInfo(tempDir);
    await fsp.writeFile(path.join(tempDir, "update-info.txt"), updateInfoLines.join("\n") + "\n", "utf8");
    sendBuildProgress(72, "Writing update-info.txt", `Wrote ${updateInfoLines.length} manifest entr${updateInfoLines.length === 1 ? "y" : "ies"}.`);

    sendBuildProgress(82, "Creating Y2JB update ZIP", `Compressing staged files for ${outputZip}.`);
    const zippedFiles = await createForwardSlashZip(tempDir, tempZip);
    sendBuildProgress(92, "Finalizing archive", `Native ZIP writer added ${zippedFiles} forward-slash entr${zippedFiles === 1 ? "y" : "ies"}.`);

    await ensureOutputDirectory(outputFolder);
    await fsp.copyFile(tempZip, outputZip);
    sendBuildProgress(98, "Copying final ZIP", `Copied finished ZIP to ${outputZip}.`);

    const payload = await statePayload();
    payload.lastBuildOutputPath = outputFolder;
    sendBuildProgress(100, "Update ZIP ready", outputZip);
    return payload;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(tempZip, { force: true }).catch(() => {});
  }
});

ipcMain.handle("app:reveal-path", async (_event, { folderPath }) => {
  await shell.openPath(folderPath);
  return statePayload();
});

ipcMain.handle("app:open-external", async (_event, { url }) => {
  const allowedUrl = "https://x.com/StonedModder";
  if (url !== allowedUrl) throw new Error("External URL is not allowed.");
  await shell.openExternal(allowedUrl);
  return statePayload();
});

ipcMain.handle("project:copy-to-usb", async (_event, { projectId }) => {
  const project = findProject(projectId);
  const srcZip = path.join(path.dirname(project.workspacePath), `${path.basename(project.workspacePath)}.zip`);
  if (!(await exists(srcZip))) {
    throw new Error("No built ZIP found. Build the update first.");
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select USB root folder",
    properties: ["openDirectory"]
  });
  if (result.canceled) return statePayload();
  const destZip = path.join(result.filePaths[0], "y2jb_update.zip");
  await fsp.copyFile(srcZip, destZip);
  mainWindow.webContents.send("build:log", `Copied to USB: ${destZip}`);
  return statePayload();
});

ipcMain.handle("app:save-settings", async (_event, settings) => {
  db.settings = { ...(db.settings || {}), startupPreferenceMigrated: true, ...settings };
  await saveDb();
  return statePayload();
});

app.whenReady().then(async () => {
  await loadDb();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
