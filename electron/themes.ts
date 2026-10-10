// App styles (.bnctheme plugins): colours + app icon, shared with the other BNC apps.
// This is a TypeScript port of bnctheme.js / zip.js from BNC Ambient (see its MAKING-PLUGINS.md), plus
// install / list / remove for the plugins folder. BNC Presentation reads only its own entry, "bnc-presentation".
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const APP_ID = 'bnc-presentation';
const THEME_API_VERSION = 1;
const MAX_THEME_SIZE = 5 * 1024 * 1024;
const MAX_PLUGINS = 60;

// ---------------------------------------------------------------------------
// Tiny zip reader (stored + deflate), so no extra libraries are needed.
// ---------------------------------------------------------------------------
interface ZipEntry {
  flags: number;
  method: number;
  compSize: number;
  size: number;
  local: number;
  name: string;
}

function readZip(buf: Buffer, { maxFiles = 200, maxEntryBytes = 2 * 1024 * 1024 } = {}) {
  const damaged = () => new Error('the zip file is damaged');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('it is not a zip file');

  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  if (count > maxFiles) throw new Error('the zip file holds too many files');

  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw damaged();
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    entries.push({
      flags: buf.readUInt16LE(pos + 8),
      method: buf.readUInt16LE(pos + 10),
      compSize: buf.readUInt32LE(pos + 20),
      size: buf.readUInt32LE(pos + 24),
      local: buf.readUInt32LE(pos + 42),
      name: buf.toString('utf8', pos + 46, pos + 46 + nameLen).replace(/\\/g, '/').replace(/^\.\//, ''),
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  function read(e: ZipEntry): Buffer {
    if (e.flags & 1) throw new Error('encrypted zip files are not supported');
    if (e.compSize === 0xffffffff || e.size === 0xffffffff) throw new Error('zip64 files are not supported');
    if (e.size > maxEntryBytes) throw new Error(`"${e.name}" is too large`);
    if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) throw damaged();
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const data = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: maxEntryBytes });
    throw new Error('the zip file uses an unsupported compression method');
  }

  return { entries, read };
}

// ---------------------------------------------------------------------------
// .bnctheme reader
// ---------------------------------------------------------------------------
export interface ParsedTheme {
  id: string;
  name: string;
  type: 'theme';
  version: string;
  author: string;
  description: string;
  apiVersion: number;
  apps: string[];
  appliesHere: boolean;
  accent?: string;
  accentRgb?: string;
  accentInk?: string;
  swatch?: string[];
  iconPng?: Buffer | null;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isId = (id: string) => /^[\w.\-]{1,64}$/.test(id);
const isAppId = (id: string) => /^[a-z0-9][\w.\-]{0,40}$/.test(id);
const HEX = /^#[0-9a-f]{6}$/i;
const toRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function safePngPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length > 120 || !/\.png$/i.test(p)) return false;
  return p.split('/').every((seg) => /^[\w.\- ]+$/.test(seg) && seg !== '.' && seg !== '..');
}

export function parseTheme(buf: Buffer, appId: string = APP_ID): ParsedTheme {
  if (!Buffer.isBuffer(buf)) throw new Error('That file could not be read.');
  if (buf.length > MAX_THEME_SIZE) throw new Error('The style file is too large (limit 5 MB).');
  if (!isAppId(appId)) throw new Error('parseTheme needs the id of the app reading the file.');

  let zip: ReturnType<typeof readZip>;
  try {
    zip = readZip(buf);
  } catch (e: any) {
    throw new Error(`A .bnctheme file must be a zip containing data.json (${e.message}).`);
  }

  // one wrapper folder (if the whole folder was zipped) is accepted
  let files = zip.entries.filter((e) => !e.name.endsWith('/'));
  if (!files.some((e) => e.name.toLowerCase() === 'data.json')) {
    const tops = new Set(files.map((e) => e.name.split('/')[0]));
    if (tops.size === 1 && files.every((e) => e.name.includes('/'))) {
      const prefix = [...tops][0] + '/';
      files = files.map((e) => ({ ...e, name: e.name.slice(prefix.length) }));
    }
  }
  const find = (p: string) => files.find((e) => e.name.toLowerCase() === String(p).toLowerCase());

  const dataEntry = find('data.json');
  if (!dataEntry) throw new Error('data.json is missing from the style file.');
  let man: any;
  try {
    man = JSON.parse(zip.read(dataEntry).toString('utf8').replace(/^ï»¿/, ''));
  } catch (e: any) {
    throw new Error(`data.json is not valid JSON (${e.message}).`);
  }
  if (!man || typeof man !== 'object') throw new Error('data.json is not valid JSON.');

  const id = str(man.id, 64);
  if (!isId(id)) throw new Error('data.json needs an "id" using only letters, numbers, dots, dashes and underscores.');
  const name = str(man.name, 60);
  if (!name) throw new Error('data.json needs a "name".');
  const type = str(man.type, 20) || 'theme';
  if (type !== 'theme') throw new Error(`Style type "${type}" is not supported (use "theme").`);
  const apiVersion = Number(man.apiVersion || 1);
  if (!(apiVersion >= 1 && apiVersion <= THEME_API_VERSION)) {
    throw new Error(`This style needs plugin API ${man.apiVersion}, but this app only understands up to ${THEME_API_VERSION}. Update the app.`);
  }

  const apps = man.apps && typeof man.apps === 'object' && !Array.isArray(man.apps) ? man.apps : {};
  const appIds = Object.keys(apps).filter(isAppId);
  const entry = apps[appId] && typeof apps[appId] === 'object' ? apps[appId] : null;
  const shared = man.colors && typeof man.colors === 'object' ? man.colors : {};

  const info = {
    id,
    name,
    type: 'theme' as const,
    version: str(man.version, 20) || '0.0.0',
    author: str(man.author, 60),
    description: str(man.description, 300),
    apiVersion,
    apps: appIds,
  };

  // this app's colours: the shared ones with the app's own entry on top
  const colors = { ...shared, ...(entry && entry.colors && typeof entry.colors === 'object' ? entry.colors : {}) };

  if (shared.accent !== undefined && !HEX.test(str(shared.accent, 7))) throw new Error('"colors.accent" must look like #rrggbb.');
  if (!entry && !HEX.test(str(shared.accent, 7))) return { ...info, appliesHere: false };
  if (!HEX.test(str(colors.accent, 7))) throw new Error(`data.json needs a color for ${appId}: "colors": { "accent": "#rrggbb" }.`);

  const accent = str(colors.accent, 7).toLowerCase();
  const [r, g, b] = toRgb(accent);

  let accentInk = str(colors.accentInk, 7);
  if (accentInk && !HEX.test(accentInk)) throw new Error('"accentInk" must look like #rrggbb.');
  if (!accentInk) accentInk = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? toHex([r * 0.12, g * 0.12, b * 0.12]) : '#ffffff';

  let swatch: string[] | null = Array.isArray(colors.swatch) ? colors.swatch.map((c: unknown) => str(c, 7)) : null;
  if (swatch && !(swatch.length === 2 && swatch.every((c) => HEX.test(c)))) throw new Error('"swatch" must be two colors like ["#ff0000", "#550000"].');
  if (!swatch) swatch = [accent, toHex([r * 0.35, g * 0.35, b * 0.35])];

  // this app's icon: its own entry, else the style's general "icon", else a top-level icon.png
  let iconPath: string = (entry && entry.icon) || man.icon || (find('icon.png') ? 'icon.png' : '');
  let iconPng: Buffer | null = null;
  if (iconPath) {
    iconPath = String(iconPath).replace(/\\/g, '/');
    if (!safePngPath(iconPath)) throw new Error(`"icon" must be a path to a .png file inside the style, like "${appId}/icon.png".`);
    const iconEntry = find(iconPath);
    if (!iconEntry) throw new Error(`${iconPath} is missing from the style file.`);
    try {
      iconPng = zip.read(iconEntry);
    } catch (e: any) {
      throw new Error(`${iconPath} could not be read (${e.message}).`);
    }
    if (iconPng.length < 8 || iconPng.readUInt32BE(0) !== 0x89504e47) throw new Error(`${iconPath} is not a PNG image.`);
  }

  return {
    ...info,
    appliesHere: true,
    accent,
    accentRgb: `${r}, ${g}, ${b}`,
    accentInk: accentInk.toLowerCase(),
    swatch: swatch.map((c) => c.toLowerCase()),
    iconPng,
  };
}

// ---------------------------------------------------------------------------
// The plugins folder
// ---------------------------------------------------------------------------
export interface LoadedTheme extends ParsedTheme {
  file: string;
}

export function loadThemes(dir: string) {
  const themes: LoadedTheme[] = [];
  const broken: { file: string; error: string }[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => path.extname(f).toLowerCase() === '.bnctheme').slice(0, MAX_PLUGINS);
  } catch {
    return { themes, broken };
  }
  const seen = new Set<string>();
  for (const file of files) {
    try {
      const t = parseTheme(fs.readFileSync(path.join(dir, file)), APP_ID);
      if (seen.has(t.id)) throw new Error(`Another plugin already uses the id "${t.id}".`);
      seen.add(t.id);
      themes.push({ ...t, file });
    } catch (e: any) {
      broken.push({ file, error: e.message });
    }
  }
  return { themes, broken };
}

/** Validates a .bnctheme and copies it into `dir` as <id>.bnctheme (replacing an older version). */
export function installTheme(buf: Buffer, originalName: string, dir: string) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.bncvis' || ext === '.bncplugin') {
    throw new Error('That is a visualizer plugin. BNC Presentation uses app styles (.bnctheme) only.');
  }
  if (ext !== '.bnctheme') throw new Error('Unsupported file type. App styles end in .bnctheme.');
  const theme = parseTheme(buf, APP_ID);
  fs.mkdirSync(dir, { recursive: true });
  const existing = loadThemes(dir).themes;
  const replacing = existing.find((t) => t.id === theme.id);
  if (!replacing && existing.length >= MAX_PLUGINS) throw new Error(`You can have at most ${MAX_PLUGINS} plugins.`);
  const file = `${theme.id}.bnctheme`;
  fs.writeFileSync(path.join(dir, file), buf);
  if (replacing && replacing.file !== file) fs.unlinkSync(path.join(dir, replacing.file));
  return { id: theme.id, name: theme.name, version: theme.version, appliesHere: theme.appliesHere, apps: theme.apps, replaced: !!replacing, previousVersion: replacing ? replacing.version : null };
}

export function removeTheme(id: string, dir: string): boolean {
  const t = loadThemes(dir).themes.find((x) => x.id === id);
  if (!t) return false;
  fs.unlinkSync(path.join(dir, t.file));
  return true;
}

/** What the renderer is allowed to see (the icon becomes a data URL). */
export function toPublic(t: LoadedTheme, enabled: boolean) {
  const { iconPng, ...rest } = t;
  return { ...rest, enabled, icon: iconPng ? `data:image/png;base64,${iconPng.toString('base64')}` : null };
}
export type PublicTheme = ReturnType<typeof toPublic>;
