# BNC Presentation

An open-source presentation maker in the spirit of Microsoft PowerPoint: a ribbon you can switch between **classic** and **simplified**,
a slide canvas with thumbnails and notes, shapes, tables, charts, pictures, transitions, animations, a full-screen slide show, and
**`.pptx` import/export**. It connects to **Nextcloud** so you can open and save presentations straight from your own cloud.

> Status: **pre-release** (v0.1.x) for Windows, macOS and Linux. A web version shares the same editor and
> file-format code (`src/core`, `src/ui`).

## Download

Installers for Windows, macOS and Linux are on the **[Releases page](https://github.com/PigeonBoi69/bnc-presentation/releases)**.
While the app is a pre-release, GitHub's "latest release" link does not point to it, so open the Releases page and pick the newest version.
The installers are not code-signed yet, so Windows and macOS show a warning the first time; each release's notes explain how to continue.

## Features

- Ribbon with Home / Insert / Draw / Design / Transitions / Animations / Slide Show / Review / View / Help tabs, in a classic or simplified layout
- Slide thumbnails, speaker notes, slide sorter, zoom, dark/light theme, spell check, command search (`Alt+Q`)
- Text boxes and placeholders with rich text, bullets and numbering, shapes, lines, tables with styles, charts, pictures (crop, recolour, effects), audio and video, ink drawing
- Slide masters, layouts and themes; backgrounds; slide numbers, footers and dates
- Transitions and animations, hidden slides, sections, comments, full-screen slide show with laser pointer and pen
- Exports: PDF, PNG/JPG pictures, HTML slide show, Markdown outline and text

## File formats

| Format | Open | Save / Export |
| --- | --- | --- |
| `.pptx` (PowerPoint) | yes | yes |
| `.ppsx` slide show, `.potx` template, `.pptm` | yes | `.ppsx`, `.potx` |
| `.bncpres` (native) | yes | yes |
| `.md` Markdown / `.txt` outline | yes | yes |
| `.html` | – | yes (self-contained slide show) |
| `.pdf` | – | yes (export + print) |
| `.png` / `.jpg` | – | yes (every slide, or the current one) |

`.pptx` import reads the PresentationML package directly (masters, layouts and placeholder inheritance, themes, shapes with
geometry, tables, charts, pictures with cropping, notes, transitions). It is not a pixel-perfect clone of PowerPoint's renderer; see *Known limitations*.

The native **`.bncpres`** format is a zip containing JSON, see [docs/BNCPRES-FORMAT.md](docs/BNCPRES-FORMAT.md).

## Nextcloud

`File > Nextcloud` (or the **Nextcloud** button) signs you in with Nextcloud's *Login Flow v2*: your browser opens,
you approve BNC Presentation, and Nextcloud hands the app a revocable **app password**. No password is ever typed into BNC Presentation
(manual app-password entry is also available). The app password is encrypted with the OS keychain (Electron `safeStorage`).

Open and save over WebDAV, with a folder browser, ETag conflict detection and optional AutoSave.

## Plugins: app styles (`.bnctheme`)

BNC Presentation reads the same `.bnctheme` app styles as BNC Ambient and BNC Docs (a zip with `data.json` plus an icon per app). A style recolors the
whole app and swaps the app logo and the window/taskbar icon. BNC Presentation reads only its own entry (`"bnc-presentation"`) and ignores the rest.

- **Install:** `Help > Plugins` (or the `Alt+Q` search) then **Install plugin…**, or drag a `.bnctheme` file onto the window.
- **Get styles:** ready-made colours (red, orange, yellow, green, blue, pink, purple, brown, black, grey) live in their own repository,
  **[bnc-plugins](https://github.com/PigeonBoi69/bnc-plugins)**, shared by all the BNC apps. Download a `.bnctheme` file from there and install it as above.
  Plugins are not part of this repository.
- **Where they live:** the `plugins` folder inside the app's user-data folder (**Open plugins folder** in the Plugins window).
- **Code:** `electron/themes.ts` (reader, installer) and `src/ui/styles.ts` (applying a style and the Plugins window).

## Linux (Ubuntu / Debian)

| File | Use |
| --- | --- |
| `BNC-Presentation-<version>-linux-amd64.deb` | Installer for Ubuntu 22.04+ / Debian. `sudo apt install ./BNC-Presentation-<version>-linux-amd64.deb` (adds the Start-menu entry, icon and `.bncpres` file type; `sudo apt remove bnc-presentation` uninstalls) |
| `BNC-Presentation-<version>-linux-x86_64.AppImage` | Portable single file, no install. `chmod +x` it, then double-click it or run it |

The `.deb` recommends the Carlito, Caladea and Liberation fonts so presentations that use Calibri, Cambria or Arial look like they do in PowerPoint.
It is the same code as Windows. `.pptx` is listed under "Open With" but BNC Presentation does not take over as the default.

```powershell
.\tools\build-linux.ps1                       # build the .deb + AppImage (Docker Desktop must be running)
.\tools\linux-smoke.ps1 -Deck x.pptx          # install the .deb in a clean Ubuntu container, run it and screenshot it
.\tools\linux-smoke.ps1 -AppImage             # same for the AppImage
```

## macOS

| File | For |
| --- | --- |
| `BNC-Presentation-<version>-mac-arm64.zip` | Apple Silicon Macs (M1, M2, M3, M4 ...) |
| `BNC-Presentation-<version>-mac-x64.zip` | Intel Macs |

**Install:** double-click the zip, drag **BNC Presentation** into **Applications**.

**First launch:** the app is signed ad-hoc but **not notarized** (that needs a paid Apple Developer account), so macOS shows an "unidentified developer" warning once.
Right-click (or Control-click) BNC Presentation > **Open** > **Open**. On macOS 15+, if there is no Open button, open **System Settings > Privacy & Security** and press **Open Anyway**.
Or run `xattr -dr com.apple.quarantine "/Applications/BNC Presentation.app"` in Terminal. After that it opens normally.

Same code as Windows and Linux. Mac specifics: the window buttons sit on the left of the title bar, there is a normal macOS menu bar so Cmd+C / Cmd+V / Cmd+Q work,
Cmd takes the place of Ctrl in shortcuts (shown as ⌘), the Dock icon follows the app colour style, and double-clicking a `.bncpres` file opens it.

```powershell
.\tools\build-mac.ps1      # build both zips (Docker Desktop must be running)
.\tools\mac-check.ps1      # inspect them: CPU type, Info.plist, signature, icon, packed app (cannot start the app: that needs a Mac)
```

On a Mac itself you can build with `npm run dist:mac` (it signs with the built-in `codesign`).

## Version numbers

BNC Presentation is pre-release. **Every time it is updated or rebuilt the version goes up one step**, and each digit rolls over after 9:
`0.1.3` -> `0.1.4` ... `0.1.9` -> `0.2.0` ... `0.9.9` -> `1.0.0`.

```powershell
npm run version:bump                        # next version, written to package.json and package-lock.json
npx tsx tools/bump-version.ts --set 0.1.3   # or set an exact one
```

The version lives in `package.json` only; the Windows installer, the Linux `.deb`, the AppImage and the macOS zips all use it.

## Develop

```bash
npm install
npm run dev        # Vite + Electron with hot reload
npm run build      # production build into dist/ and dist-electron/
npm start          # run the built app
npm test           # unit tests
npm run dist       # Windows installer into release/
npm run icons      # regenerate the app icon
```

Layout:

```
electron/        main process, preload, Nextcloud WebDAV client, app styles
src/core/        slide model, pptx import/export, .bncpres, renderer, charts (UI-free, shared with the web app)
src/editor/      slide canvas, text editing (ProseMirror)
src/ui/          ribbon, dialogs, pickers, slide panel, slide show, Nextcloud dialogs
src/app.ts       application shell (documents, files, zoom, status)
src/commands.ts  every action in one registry (ribbon, shortcuts and command search all use it)
tools/           icon generator, pptx inspector, CDP driver for UI testing, build scripts for Linux and macOS
tests/
```

Theme colours are CSS variables at the top of `src/styles/app.css`.

## Known limitations (v0.1)

- Not implemented yet: presenter view, outline pane, morph and fancy transitions, SmartArt editing, `.odp`
- EMF/WMF pictures cannot be drawn
- `.pptx` export is hand-written and has not been opened in real PowerPoint yet, so a saved PowerPoint deck may look slightly different afterwards
- Fonts that are not installed (e.g. Aptos on a machine without Office) fall back to similar system fonts, so line breaks can differ from PowerPoint
- Nextcloud has been tested against a mock server only

## License

MIT, see [LICENSE](LICENSE).
