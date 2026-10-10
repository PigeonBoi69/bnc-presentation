// The native .bncpres format: a zip package.
//   mimetype            application/vnd.bnc.presentation+zip
//   manifest.json       { format, version, app, created, modified, slides }
//   presentation.json   the slide model (see src/core/model.ts), pictures refer to media ids
//   media.json          { "<id>": { "file": "media/<id>.<ext>", "mime": "...", "name": "..." } }
//   media/…             pictures, audio and video as plain binary files
// Open, documented, and trivially readable with any zip tool + JSON parser.
import JSZip from 'jszip';
import { EXT_BY_MIME } from './media';
import { normalizePres, type Deck, type MediaStore, type Pres } from './model';

export const BNCPRES_MIME = 'application/vnd.bnc.presentation+zip';
export const BNCPRES_VERSION = 1;

export async function saveBncpres(deck: Deck): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', BNCPRES_MIME, { compression: 'STORE' });
  const now = new Date().toISOString();
  const used = new Set<string>();
  const collect = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(collect);
    const o = v as Record<string, unknown>;
    if (typeof o.media === 'string') used.add(o.media);
    if (typeof o.poster === 'string') used.add(o.poster);
    for (const k of Object.keys(o)) collect(o[k]);
  };
  collect(deck.pres);

  const index: Record<string, { file: string; mime: string; name: string }> = {};
  for (const id of used) {
    const item = deck.media.get(id);
    if (!item) continue;
    const file = `media/${id}.${EXT_BY_MIME[item.mime] ?? 'bin'}`;
    zip.file(file, item.data, { compression: item.mime.startsWith('image/svg') || item.mime.startsWith('image/bmp') ? 'DEFLATE' : 'STORE' });
    index[id] = { file, mime: item.mime, name: item.name };
  }
  const pres: Pres = { ...deck.pres, modified: now };
  zip.file('manifest.json', JSON.stringify({ format: 'bncpres', version: BNCPRES_VERSION, app: 'BNC Presentation', created: pres.created, modified: now, slides: pres.slides.length }, null, 2));
  zip.file('media.json', JSON.stringify(index, null, 2));
  zip.file('presentation.json', JSON.stringify(pres));
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function loadBncpres(data: Uint8Array | ArrayBuffer): Promise<Deck> {
  const zip = await JSZip.loadAsync(data);
  const manifest = zip.file('manifest.json');
  const content = zip.file('presentation.json');
  if (!manifest || !content) throw new Error('This is not a valid .bncpres file.');
  const info = JSON.parse(await manifest.async('string'));
  if (info.format !== 'bncpres') throw new Error('This is not a valid .bncpres file.');
  if (info.version > BNCPRES_VERSION) throw new Error('This presentation was made with a newer version of BNC Presentation. Please update the app.');
  const pres = normalizePres(JSON.parse(await content.async('string')) as Pres);
  const media: MediaStore = new Map();
  const idx = zip.file('media.json');
  if (idx) {
    const map = JSON.parse(await idx.async('string')) as Record<string, { file: string; mime: string; name: string }>;
    for (const [id, m] of Object.entries(map)) {
      const f = zip.file(m.file);
      if (f) media.set(id, { mime: m.mime, name: m.name, data: await f.async('uint8array') });
    }
  }
  return { pres, media };
}
