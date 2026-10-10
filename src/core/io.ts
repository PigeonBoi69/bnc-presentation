// File-format registry: decode any supported file into a deck, and encode a deck back out.
import { loadBncpres, saveBncpres } from './bncpres';
import { deckFromOutline, outlineToMarkdown, outlineToText } from './outline';
import type { Deck } from './model';
import { importPptx } from './pptx-import';
import { exportPptx } from './pptx-export';

export type Format = 'bncpres' | 'pptx' | 'ppsx' | 'potx' | 'pdf' | 'png' | 'jpg' | 'html' | 'md' | 'txt';

export const FORMAT_INFO: Record<Format, { label: string; ext: string; writable: boolean }> = {
  bncpres: { label: 'BNC Presentation (.bncpres)', ext: 'bncpres', writable: true },
  pptx: { label: 'PowerPoint Presentation (.pptx)', ext: 'pptx', writable: true },
  ppsx: { label: 'PowerPoint Show (.ppsx)', ext: 'ppsx', writable: true },
  potx: { label: 'PowerPoint Template (.potx)', ext: 'potx', writable: true },
  pdf: { label: 'PDF (.pdf)', ext: 'pdf', writable: false },
  png: { label: 'PNG Pictures (.png)', ext: 'png', writable: false },
  jpg: { label: 'JPEG Pictures (.jpg)', ext: 'jpg', writable: false },
  html: { label: 'Web Slide Show (.html)', ext: 'html', writable: false },
  md: { label: 'Markdown Outline (.md)', ext: 'md', writable: true },
  txt: { label: 'Plain Text Outline (.txt)', ext: 'txt', writable: true },
};

export function formatFromName(name: string): Format | undefined {
  const ext = name.toLowerCase().split('.').pop();
  switch (ext) {
    case 'bncpres':
      return 'bncpres';
    case 'pptx':
    case 'pptm':
      return 'pptx';
    case 'ppsx':
    case 'ppsm':
      return 'ppsx';
    case 'potx':
    case 'potm':
      return 'potx';
    case 'md':
    case 'markdown':
      return 'md';
    case 'txt':
      return 'txt';
  }
  return undefined;
}

export const OPENABLE_EXTS = ['bncpres', 'pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm', 'md', 'markdown', 'txt'];

export function baseName(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '');
}

export interface Decoded {
  deck: Deck;
  warnings: string[];
}

export async function decodeFile(name: string, data: Uint8Array): Promise<Decoded> {
  const fmt = formatFromName(name);
  const text = () => new TextDecoder('utf-8').decode(data);
  switch (fmt) {
    case 'bncpres':
      return { deck: await loadBncpres(data), warnings: [] };
    case 'pptx':
    case 'ppsx':
    case 'potx': {
      const r = await importPptx(data);
      return { deck: { pres: r.pres, media: r.media }, warnings: r.warnings };
    }
    case 'md':
      return { deck: deckFromOutline(text(), 'md'), warnings: [] };
    case 'txt':
      return { deck: deckFromOutline(text(), 'txt'), warnings: [] };
    default:
      throw new Error(`BNC Presentation can't open "${name}" yet. Supported: .bncpres, .pptx, .ppsx, .potx, .md, .txt`);
  }
}

export async function encodeFile(fmt: Format, deck: Deck): Promise<Uint8Array> {
  const enc = (s: string) => new TextEncoder().encode(s);
  switch (fmt) {
    case 'bncpres':
      return saveBncpres(deck);
    case 'pptx':
      return exportPptx(deck, 'pptx');
    case 'ppsx':
      return exportPptx(deck, 'ppsx');
    case 'potx':
      return exportPptx(deck, 'potx');
    case 'md':
      return enc(outlineToMarkdown(deck.pres));
    case 'txt':
      return enc(outlineToText(deck.pres));
    default:
      throw new Error('Use Export for this format.');
  }
}
