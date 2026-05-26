const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("y2jb", {
  getState: () => invoke("app:get-state"),
  createUpdateWorkspace: () => invoke("project:create-y2-from-template"),
  openWorkspace: () => invoke("project:open-workspace"),
  openRecentProject: (projectId) => invoke("project:open-recent", { projectId }),
  saveProject: (project) => invoke("project:save", project),
  saveLookTheme: (projectId, lookTheme) => invoke("project:save-look", { projectId, lookTheme }),
  addPayloads: (projectId) => invoke("project:add-payloads", { projectId }),
  setThumbnail: (projectId) => invoke("project:set-thumbnail", { projectId }),
  buildUpdateZip: (project) => invoke("project:build-update-zip", project),
  revealWorkspace: (projectId) => invoke("project:reveal", { projectId }),
  addPayloadSource: (source) => invoke("payload-source:add", source),
  exportPayloadSources: () => invoke("payload-source:export"),
  importPayloadSources: () => invoke("payload-source:import"),
  clearPayloadSources: () => invoke("payload-source:clear"),
  checkPayloadSource: (sourceId) => invoke("payload-source:check", { sourceId }),
  checkAllPayloadSources: (fetchReadmes) => invoke("payload-source:check-all", { fetchReadmes }),
  updatePayloadSource: (source) => invoke("payload-source:update", source),
  setPayloadSourceVersion: (sourceId, releaseId) => invoke("payload-source:set-version", { sourceId, releaseId }),
  setPayloadSourceAssets: (sourceId, assetUrls) => invoke("payload-source:set-assets", { sourceId, assetUrls }),
  downloadPayloadSource: (projectId, sourceId, releaseId, assetUrls) => invoke("payload-source:download", { projectId, sourceId, releaseId, assetUrls }),
  downloadAllPayloadSources: (projectId, updatesOnly) => invoke("payload-source:download-all", { projectId, updatesOnly }),
  checkInstalledPayloadUpdates: (projectId) => invoke("payload-source:check-installed", { projectId }),
  downloadPayloadSourceUpdates: (projectId, sourceIds) => invoke("payload-source:download-updates", { projectId, sourceIds }),
  onBuildLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on("build:log", listener);
    return () => ipcRenderer.removeListener("build:log", listener);
  },
  saveSettings: (settings) => invoke("app:save-settings", settings),
  revealPath: (folderPath) => invoke("app:reveal-path", { folderPath }),
  openExternal: (url) => invoke("app:open-external", { url }),
  copyToUsb: (projectId) => invoke("project:copy-to-usb", { projectId })
});
