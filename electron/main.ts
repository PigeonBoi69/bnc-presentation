import { app, BrowserWindow, clipboard, ipcMain, dialog, shell, safeStorage, Menu, session, nativeImage, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import * as nc from './nextcloud';
import * as themes from './themes';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const DOC_EXTS = ['bncpres', 'pptx', 'ppsx', 'potx', 'pptm', 'md', 'markdown', 'txt', 'html', 'htm'];

let win: BrowserWindow | null = null;
let allowClose = false;
/** set when the whole app was asked to quit (Cmd+Q, dock > Quit) so a confirmed close finishes the quit */
let quitRequested = false;
let pendingOpen: string[] = [];

// ---------------------------------------------------------------------------
// Settings (JSON in userData). The Nextcloud app password is encrypted with the OS keychain.
// ---------------------------------------------------------------------------
interface Settings {
  theme?: 'dark' | 'light';
  /** id of the active app style plugin (.bnctheme), or unset for the built-in colours */
  appStyle?: string | null;
  disabledStyles?: string[];
  recent?: string[];
  nextcloud?: { server: string; user: string; secret: string; encrypted: boolean };
  [k: string]: unknown;
}
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settingsCache: Settings | null = null;

async function loadSettings(): Promise<Settings> {
  if (settingsCache) return settingsCache;
  try {
    settingsCache = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    settingsCache = {};
  }
  return settingsCache!;
}
async function saveSettings(s: Settings) {
  settingsCache = s;
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(s, null, 2));
}

function storeSecret(secret: string) {
  if (safeStorage.isEncryptionAvailable()) return { secret: safeStorage.encryptString(secret).toString('base64'), encrypted: true };
  return { secret: Buffer.from(secret).toString('base64'), encrypted: false };
}
function readSecret(n: NonNullable<Settings['nextcloud']>): string {
  const buf = Buffer.from(n.secret, 'base64');
  return n.encrypted ? safeStorage.decryptString(buf) : buf.toString();
}
async function account(): Promise<nc.NcAccount> {
  const s = await loadSettings();
  if (!s.nextcloud) throw new Error('Not connected to Nextcloud. Open File > Nextcloud to sign in.');
  return { server: s.nextcloud.server, user: s.nextcloud.user, password: readSecret(s.nextcloud) };
}

// ---------------------------------------------------------------------------
// App styles (.bnctheme plugins)
// ---------------------------------------------------------------------------
const pluginsDir = () => path.join(app.getPath('userData'), 'plugins');
const defaultIconPath = () => path.join(__dirname, '..', 'build', 'icon.png');

async function styleState() {
  const s = await loadSettings();
  const disabled = new Set(s.disabledStyles ?? []);
  const { themes: loaded, broken } = themes.loadThemes(pluginsDir());
  const list = loaded.map((t) => themes.toPublic(t, !disabled.has(t.id)));
  // a style is only in use if it is installed, working, switched on and made for this app
  const active = list.find((t) => t.id === s.appStyle && t.enabled && t.appliesHere) ?? null;
  return { styles: list, broken, active: active ? active.id : null, dir: pluginsDir() };
}

async function applyWindowIcon() {
  if (!win) return;
  const { styles, active } = await styleState();
  const t = styles.find((x) => x.id === active);
  try {
    const image = t?.icon ? nativeImage.createFromDataURL(t.icon) : nativeImage.createFromPath(defaultIconPath());
    win.setIcon(image); // Windows / Linux (no effect on macOS)
    if (process.platform === 'darwin') app.dock?.setIcon(image); // macOS: the Dock icon follows the app style
  } catch {
    /* keep whatever icon the window has */
  }
}

async function installStyleFile(name: string, data: Uint8Array) {
  try {
    const r = themes.installTheme(Buffer.from(data), name, pluginsDir());
    return { file: name, ok: true as const, ...r };
  } catch (e: any) {
    return { file: name, ok: false as const, error: e.message as string };
  }
}

// ---------------------------------------------------------------------------
// macOS menu bar
// ---------------------------------------------------------------------------
function macMenu(): Menu {
  // Undo/Redo go to the app's own history (the native ones would bypass it), everything else is a standard role.
  const send = (id: string) => () => win?.webContents.send('menu:command', id);
  const template: MenuItemConstructorOptions[] = [
    { label: 'BNC Presentation', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
      ],
    },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, ...(app.isPackaged ? [] : ([{ type: 'separator' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]))] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }] },
  ];
  return Menu.buildFromTemplate(template);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
const isMac = process.platform === 'darwin';

function createWindow() {
  allowClose = false;
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0e1214',
    title: 'BNC Presentation',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    // Windows/Linux draw their window buttons over our title bar; macOS keeps its traffic lights, placed in the 44px bar
    ...(isMac ? { trafficLightPosition: { x: 16, y: 14 } } : { titleBarOverlay: { color: '#0e1214', symbolColor: '#e6eef0', height: 44 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => {
    win?.show();
    void applyWindowIcon();
  });

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.on('close', (e) => {
    if (!allowClose && win) {
      e.preventDefault();
      win.webContents.send('app:close-request');
    }
  });
  win.on('closed', () => (win = null));

  // Open links in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost')) {
      e.preventDefault();
      if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    }
  });

  // Right-click menu with spelling suggestions (inside text being edited).
  win.webContents.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => win?.webContents.replaceMisspelling(s) });
      if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false });
      items.push({ label: 'Add to dictionary', click: () => win?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup();
  });

  if (isDev || process.env.BNC_DEVTOOLS) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') win?.webContents.toggleDevTools();
    });
  }
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
async function readDoc(p: string) {
  const data = await fs.readFile(p);
  return { path: p, name: path.basename(p), data: new Uint8Array(data) };
}

async function rememberRecent(p: string) {
  const s = await loadSettings();
  s.recent = [p, ...(s.recent ?? []).filter((x) => x !== p)].slice(0, 12);
  await saveSettings(s);
}

function docPathsFromArgv(argv: string[]) {
  return argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && DOC_EXTS.includes(path.extname(a).slice(1).toLowerCase()));
}

// ---------------------------------------------------------------------------
// PDF / PNG / print: render slide HTML in a hidden window.
// ---------------------------------------------------------------------------
async function withHiddenWindow<T>(html: string, size: { width: number; height: number } | null, fn: (w: BrowserWindow) => Promise<T>): Promise<T> {
  const tmp = path.join(os.tmpdir(), `bncpres-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await fs.writeFile(tmp, html, 'utf8');
  const w = new BrowserWindow({
    show: false,
    useContentSize: true,
    ...(size ? { width: size.width, height: size.height } : {}),
    webPreferences: { sandbox: true, javascript: true, backgroundThrottling: false },
  });
  try {
    await w.loadFile(tmp);
    // wait for pictures and fonts so the capture is complete
    await w.webContents.executeJavaScript(`Promise.all([document.fonts && document.fonts.ready, ...Array.from(document.images).map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))]).then(() => new Promise(r => setTimeout(r, 60)))`);
    return await fn(w);
  } finally {
    w.destroy();
    fs.unlink(tmp).catch(() => {});
  }
}

/** Save dialog. For automated tests, BNC_TEST_DIR makes it answer by itself with a file in that folder. */
async function savePath(opts: Electron.SaveDialogOptions): Promise<{ canceled: boolean; filePath?: string }> {
  if (process.env.BNC_TEST_DIR) return { canceled: false, filePath: path.join(process.env.BNC_TEST_DIR, path.basename(opts.defaultPath ?? 'export')) };
  return dialog.showSaveDialog(win!, opts);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('app:ready', async () => {
    const files = pendingOpen;
    pendingOpen = [];
    const out = [];
    for (const f of files) out.push(await readDoc(f));
    return { version: app.getVersion(), platform: process.platform, files: out, recent: (await loadSettings()).recent ?? [] };
  });

  ipcMain.handle('file:open', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Open',
      properties: ['openFile'],
      filters: [
        { name: 'All presentations', extensions: DOC_EXTS },
        { name: 'BNC Presentation (.bncpres)', extensions: ['bncpres'] },
        { name: 'PowerPoint (.pptx, .ppsx, .potx)', extensions: ['pptx', 'ppsx', 'potx', 'pptm'] },
        { name: 'Outline (Markdown / text)', extensions: ['md', 'markdown', 'txt'] },
      ],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    await rememberRecent(r.filePaths[0]);
    return readDoc(r.filePaths[0]);
  });
  ipcMain.handle('file:open-media', async (_e, kind: 'image' | 'video' | 'audio') => {
    const filters =
      kind === 'image'
        ? [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'] }]
        : kind === 'video'
          ? [{ name: 'Video', extensions: ['mp4', 'm4v', 'webm', 'mov', 'ogv'] }]
          : [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'] }];
    const r = await dialog.showOpenDialog(win!, { title: kind === 'image' ? 'Insert Picture' : kind === 'video' ? 'Insert Video' : 'Insert Audio', properties: kind === 'image' ? ['openFile', 'multiSelections'] : ['openFile'], filters });
    if (r.canceled) return [];
    return Promise.all(r.filePaths.map(readDoc));
  });
  ipcMain.handle('file:read', async (_e, p: string) => {
    await rememberRecent(p);
    return readDoc(p);
  });
  ipcMain.handle('file:save', async (_e, p: string, data: Uint8Array) => {
    await fs.writeFile(p, Buffer.from(data));
    return true;
  });
  ipcMain.handle('file:save-as', async (_e, o: { defaultName: string; filters: Electron.FileFilter[]; data: Uint8Array }) => {
    const r = await savePath({ title: 'Save As', defaultPath: o.defaultName, filters: o.filters });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, Buffer.from(o.data));
    await rememberRecent(r.filePath);
    return { path: r.filePath, name: path.basename(r.filePath) };
  });
  ipcMain.handle('file:reveal', (_e, p: string) => shell.showItemInFolder(p));

  ipcMain.handle('pdf:export', async (_e, o: { html: string; defaultName: string }) => {
    const r = await savePath({ title: 'Export as PDF', defaultPath: o.defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    const pdf = await withHiddenWindow(o.html, null, (w) => w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
    await fs.writeFile(r.filePath, pdf);
    return { path: r.filePath };
  });

  ipcMain.handle('images:export', async (_e, o: { pages: string[]; width: number; height: number; format: 'png' | 'jpg'; baseName: string }) => {
    const ext = o.format === 'jpg' ? 'jpg' : 'png';
    let folder: string;
    let single: string | null = null;
    if (o.pages.length === 1) {
      const r = await savePath({ title: 'Export slide as picture', defaultPath: `${o.baseName}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (r.canceled || !r.filePath) return null;
      single = r.filePath;
      folder = path.dirname(r.filePath);
    } else if (process.env.BNC_TEST_DIR) {
      folder = process.env.BNC_TEST_DIR;
    } else {
      const r = await dialog.showOpenDialog(win!, { title: 'Choose a folder for the slide pictures', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      folder = r.filePaths[0];
    }
    let n = 0;
    for (const html of o.pages) {
      n++;
      const img = await withHiddenWindow(html, { width: o.width, height: o.height }, async (w) => (await w.webContents.capturePage()));
      const buf = o.format === 'jpg' ? img.toJPEG(92) : img.toPNG();
      await fs.writeFile(single ?? path.join(folder, `${o.baseName}-${String(n).padStart(2, '0')}.${ext}`), buf);
    }
    return { folder, count: n };
  });

  ipcMain.handle('print', async (_e, o: { html: string }) => {
    await withHiddenWindow(o.html, null, (w) => new Promise<void>((resolve) => w.webContents.print({ silent: false, printBackground: true }, () => resolve())));
    return true;
  });

  ipcMain.handle('clipboard:read', async () => {
    let text = '';
    let png: Uint8Array | null = null;
    try {
      text = await clipboard.readText();
    } catch {
      /* no text on the clipboard */
    }
    try {
      for (const item of await clipboard.read()) {
        if (item.types.includes('image/png')) {
          png = new Uint8Array(await (await item.getType('image/png')).arrayBuffer());
          break;
        }
      }
    } catch {
      /* no picture on the clipboard */
    }
    return { text, png };
  });

  ipcMain.handle('settings:get', async () => {
    const s = await loadSettings();
    const { nextcloud, ...rest } = s;
    return { ...rest, nextcloud: nextcloud ? { server: nextcloud.server, user: nextcloud.user } : null };
  });
  ipcMain.handle('settings:set', async (_e, patch: Record<string, unknown>) => {
    const s = await loadSettings();
    for (const k of Object.keys(patch)) if (k !== 'nextcloud' && k !== 'recent') (s as any)[k] = patch[k];
    await saveSettings(s);
    return true;
  });

  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^(https?|mailto):/i.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle('win:fullscreen', (_e, on: boolean) => {
    win?.setFullScreen(on);
    return true;
  });

  ipcMain.handle('dialog:confirm-save', async (_e, name: string) => {
    const r = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'BNC Presentation',
      message: `Do you want to save changes to ${name}?`,
      detail: 'Your changes will be lost if you don’t save them.',
    });
    return (['save', 'discard', 'cancel'] as const)[r.response];
  });
  ipcMain.handle('dialog:message', async (_e, o: { type?: 'info' | 'error' | 'warning'; message: string; detail?: string }) => {
    await dialog.showMessageBox(win!, { type: o.type ?? 'info', message: o.message, detail: o.detail, title: 'BNC Presentation' });
    return true;
  });

  ipcMain.on('app:close-confirmed', () => {
    allowClose = true;
    if (quitRequested) app.quit();
    else win?.close();
  });
  // the person pressed Cancel on the "save changes?" question: stay open, and forget a pending Cmd+Q / quit
  ipcMain.on('app:close-cancelled', () => {
    quitRequested = false;
  });
  ipcMain.on('win:title', (_e, title: string) => win?.setTitle(title));
  ipcMain.on('win:overlay', (_e, c: { color: string; symbolColor: string }) => {
    if (process.platform === 'win32' || process.platform === 'linux') win?.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: 44 });
  });

  // ---- App styles (plugins) ----
  ipcMain.handle('style:list', () => styleState());
  ipcMain.handle('style:install-dialog', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Install plugin',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'BNC app styles (.bnctheme)', extensions: ['bnctheme'] }, { name: 'All plugin files', extensions: ['bnctheme', 'bncvis', 'bncplugin'] }],
    });
    if (r.canceled) return [];
    const out = [];
    for (const f of r.filePaths) out.push(await installStyleFile(path.basename(f), new Uint8Array(await fs.readFile(f))));
    return out;
  });
  ipcMain.handle('style:install-data', (_e, name: string, data: Uint8Array) => installStyleFile(name, data));
  ipcMain.handle('style:remove', async (_e, id: string) => {
    const ok = themes.removeTheme(id, pluginsDir());
    const s = await loadSettings();
    if (s.appStyle === id) s.appStyle = null;
    s.disabledStyles = (s.disabledStyles ?? []).filter((x) => x !== id);
    await saveSettings(s);
    await applyWindowIcon();
    return ok;
  });
  ipcMain.handle('style:enable', async (_e, id: string, on: boolean) => {
    const s = await loadSettings();
    const set = new Set(s.disabledStyles ?? []);
    if (on) set.delete(id);
    else set.add(id);
    s.disabledStyles = [...set];
    await saveSettings(s);
    await applyWindowIcon();
    return true;
  });
  ipcMain.handle('style:use', async (_e, id: string | null) => {
    const s = await loadSettings();
    s.appStyle = id;
    await saveSettings(s);
    await applyWindowIcon();
    return true;
  });
  ipcMain.handle('style:open-folder', async () => {
    await fs.mkdir(pluginsDir(), { recursive: true });
    await shell.openPath(pluginsDir());
  });

  // ---- Nextcloud ----
  ipcMain.handle('nc:status', async () => {
    const s = await loadSettings();
    return s.nextcloud ? { server: s.nextcloud.server, user: s.nextcloud.user } : null;
  });
  ipcMain.handle('nc:login-flow', async (_e, server: string) => {
    const acct = await nc.loginFlow(server);
    await nc.testConnection(acct);
    const s = await loadSettings();
    s.nextcloud = { server: acct.server, user: acct.user, ...storeSecret(acct.password) };
    await saveSettings(s);
    return { server: acct.server, user: acct.user };
  });
  ipcMain.handle('nc:login-cancel', () => nc.cancelLogin());
  ipcMain.handle('nc:login-manual', async (_e, a: nc.NcAccount) => {
    const acct = { ...a, server: nc.normalizeServer(a.server) };
    await nc.testConnection(acct);
    const s = await loadSettings();
    s.nextcloud = { server: acct.server, user: acct.user, ...storeSecret(acct.password) };
    await saveSettings(s);
    return { server: acct.server, user: acct.user };
  });
  ipcMain.handle('nc:logout', async () => {
    const s = await loadSettings();
    delete s.nextcloud;
    await saveSettings(s);
    return true;
  });
  ipcMain.handle('nc:list', async (_e, p: string) => nc.list(await account(), p));
  ipcMain.handle('nc:read', async (_e, p: string) => nc.read(await account(), p));
  ipcMain.handle('nc:write', async (_e, p: string, data: Uint8Array, etag?: string) => nc.write(await account(), p, data, etag));
  ipcMain.handle('nc:mkdir', async (_e, p: string) => nc.mkdir(await account(), p));
  ipcMain.handle('nc:remove', async (_e, p: string) => nc.remove(await account(), p));
  ipcMain.handle('nc:move', async (_e, from: string, to: string) => nc.move(await account(), from, to));
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', async (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      for (const p of docPathsFromArgv(argv)) win.webContents.send('app:open-file', await readDoc(p));
    }
  });

  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (win) readDoc(p).then((d) => win?.webContents.send('app:open-file', d));
    else {
      pendingOpen.push(p); // macOS: a file was double-clicked before the window exists (or after it was closed)
      if (app.isReady()) createWindow();
    }
  });

  // Quit (Cmd+Q on a Mac, or any other way) must give the "save changes?" question a chance too.
  app.on('before-quit', (e) => {
    if (!allowClose && win) {
      e.preventDefault();
      quitRequested = true;
      win.webContents.send('app:close-request');
    }
  });

  app.whenReady().then(() => {
    // macOS needs a real menu bar: Cmd+C / Cmd+V / Cmd+Q etc. come from it. Windows and Linux use our own title bar.
    Menu.setApplicationMenu(isMac ? macMenu() : null);
    if (isMac) app.setAboutPanelOptions({ applicationName: 'BNC Presentation', applicationVersion: app.getVersion(), copyright: 'MIT License', iconPath: defaultIconPath() });
    pendingOpen = [...pendingOpen, ...docPathsFromArgv(process.argv)]; // keep files macOS handed us before the app was ready
    session.defaultSession.setSpellCheckerLanguages(['en-US']);
    // Allow listing installed fonts for the font picker.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'local-fonts' || permission === 'clipboard-sanitized-write'));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'local-fonts' || permission === 'clipboard-sanitized-write');
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
