# y2JBGenny

GUI for creating PS5 Y2JB update ZIPs.

<img width="1953" height="1592" alt="image" src="https://github.com/user-attachments/assets/e5b17f4b-99e8-4989-a40a-7b7d507acd66" />


## What It Does

- Creates a new Y2JB update workspace from the bundled template.
- Writes `ps5_autoloader/autoload.txt` from the payload order list.
- Supports payload, delay, and message rows.
- Imports payload files into the workspace.
- Tracks payload sources and release versions via github/lab.
- Edits the Y2JB autoloader look/theme.
- Supports the bundled cyberpunk theme and the default PLK-style autoloader theme.

## Current Y2JB Template

The bundled update template is based on PLK Y2JB autoloader:

`v0.6.3-e655073`

Bundled dependency versions include:

- `ps5-elfldr` `v0.23.1-148b71c`
- `ps5-kexp` `v0.5.1-2cc1a71`
- `ps5-payload-manager` `v0.1.1`

Template files live in:

`src/shared/project-templates/y2jb`

## Requirements

- Windows
- Node.js with `npm`

WSL is not required. ZIP files are built with the native PS5-safe ZIP writer included in the app.

## Quick Start

Use the included launcher:

```bat
launch.bat
```

The launcher installs dependencies if needed, then starts the Electron app.

Manual start:

```bash
npm install
npm start
```

## Build A Portable App

Use the included compile script:

```bat
compile.bat
```

This runs dependency install, syntax checks, and the portable Windows build. Output is written to:

`dist/`

Manual build:

```bash
npm install
npm run lint
npm run build
```

## Basic Workflow

1. Launch y2JBGenny.
2. Create a new Y2JB update workspace.
3. Add or import payloads.
4. Arrange the payload order.
5. Edit the look/theme if desired.
6. Click `Build Update ZIP`.
7. Copy the finished ZIP to USB as `y2jb_update.zip`.

The app writes verbose build progress while creating the ZIP, including manifest, root file, payload file, ZIP, and final copy stages.

## Theme Editor

The Look editor customizes the autoloader UI that appears during the Y2JB flow.

Editable fields include:

- Screen title
- Version text
- Top credit text
- Top loader text
- Protocol title text
- Protocol detail text
- Colors for background, title, log, border, progress, and log states

Cyberpunk builds include both theme assets:

- `cybercore.ps5.css`
- `host-ui.css`


## Notes

This project packages Y2JB update workspaces. It does not install console-side files or modify console storage directly. Use responsibly and follow the upstream Y2JB project instructions for your environment.
