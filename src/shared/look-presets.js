const LOOK_PRESETS = [
  {
    id: "y2-cyberpunk-preview",
    name: "Y2 Cyberpunk Preview",
    source: "bundled y2JBGenny preset",
    layoutId: "y2-cyberpunk",
    layoutKind: "css",
    assets: [
      {
        from: "src/shared/look-preset-assets/y2-cyberpunk-preview/host-ui.css",
        to: "host-ui.css"
      },
      {
        from: "src/shared/look-preset-assets/y2-cyberpunk-preview/cybercore.ps5.css",
        to: "cybercore.ps5.css"
      }
    ],
    theme: {
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
    }
  },
  {
    id: "y2-default-autoloader",
    name: "Y2 Default Autoloader",
    source: "bundled PLK default UI",
    layoutId: "y2-default",
    layoutKind: "inline",
    assets: [],
    theme: {
      titleText: "Y2JB Autoloader",
      versionText: "v0.6.3-e655073",
      creditText: "StonedModder",
      loaderText: "Y2Genny",
      protocolTitleText: "Y2JB // Y2Genny",
      protocolDetailText: "Y2JB Autoloader v0.6.3-e655073 by PLK // Offline PS5 Exploit Chain",
      layoutId: "y2-default",
      bgColor: "#272727",
      titleColor: "#cccccc",
      logBgColor: "#000000",
      borderColor: "#ff0000",
      progressBgColor: "#202020",
      progressBarColor: "#aa0000",
      progressTextColor: "#ffffff",
      footerColor: "#cccccc",
      logInfoColor: "#cccccc",
      logSuccessColor: "#90ee90",
      logErrorColor: "#ff0000",
      logWarningColor: "#ffff00"
    }
  }
];

if (typeof module !== "undefined") {
  module.exports = { LOOK_PRESETS };
}

if (typeof window !== "undefined") {
  window.Y2JBGENNY_LOOK_PRESETS = LOOK_PRESETS;
}
