// Binary media (pictures, audio, video) kept outside the JSON model.
import type { MediaItem, MediaStore } from './model';

const urlCache = new WeakMap<MediaStore, Map<string, string>>();

export const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/tiff': 'tif', 'image/emf': 'emf', 'image/wmf': 'wmf',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-msvideo': 'avi', 'video/x-ms-wmv': 'wmv', 'video/mpeg': 'mpg',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/x-ms-wma': 'wma', 'audio/ogg': 'ogg', 'audio/aac': 'aac',
};
export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));
MIME_BY_EXT.jpeg = 'image/jpeg';
MIME_BY_EXT.m4v = 'video/mp4';
MIME_BY_EXT.flac = 'audio/flac';

export function mimeFromName(name: string): string {
  return MIME_BY_EXT[(name.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream';
}

export function mediaUrl(store: MediaStore, id: string | undefined): string | undefined {
  if (!id) return undefined;
  const item = store.get(id);
  if (!item) return undefined;
  let cache = urlCache.get(store);
  if (!cache) urlCache.set(store, (cache = new Map()));
  let url = cache.get(id);
  if (!url) {
    url = URL.createObjectURL(new Blob([item.data as BlobPart], { type: item.mime }));
    cache.set(id, url);
  }
  return url;
}

export function releaseMedia(store: MediaStore) {
  const cache = urlCache.get(store);
  if (cache) for (const u of cache.values()) URL.revokeObjectURL(u);
  urlCache.delete(store);
}

export function toBase64(data: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) bin += String.fromCharCode(...data.subarray(i, i + chunk));
  return btoa(bin);
}
export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function mediaDataUri(store: MediaStore, id: string | undefined): string | undefined {
  const item = id ? store.get(id) : undefined;
  return item ? `data:${item.mime};base64,${toBase64(item.data)}` : undefined;
}

function fnv(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Add a file to the store (identical files are stored once) and return its id. */
export function addMedia(store: MediaStore, name: string, data: Uint8Array, mime?: string): string {
  const id = `m${fnv(data)}${data.length.toString(36)}`;
  if (!store.has(id)) store.set(id, { mime: mime ?? mimeFromName(name), name, data } satisfies MediaItem);
  return id;
}

export function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
    img.onerror = () => res({ w: 400, h: 300 });
    img.src = url;
  });
}

export function mediaDuration(url: string, kind: 'video' | 'audio'): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.onloadedmetadata = () => res({ w: (el as HTMLVideoElement).videoWidth || 640, h: (el as HTMLVideoElement).videoHeight || 360 });
    el.onerror = () => res({ w: 640, h: 360 });
    el.src = url;
  });
}
