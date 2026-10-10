export interface DocFile {
  path: string;
  name: string;
  data: Uint8Array;
}

export interface NcEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
  etag?: string;
}

export interface AppStyle {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  apps: string[];
  appliesHere: boolean;
  enabled: boolean;
  file: string;
  accent?: string;
  accentRgb?: string;
  accentInk?: string;
  swatch?: string[];
  icon: string | null;
}

export interface StyleState {
  styles: AppStyle[];
  broken: { file: string; error: string }[];
  /** id of the style in use, or null for the built-in colours */
  active: string | null;
  dir: string;
}

export type InstallResult =
  | { file: string; ok: true; id: string; name: string; version: string; appliesHere: boolean; apps: string[]; replaced: boolean; previousVersion: string | null }
  | { file: string; ok: false; error: string };

export interface BncApi {
  platform: string;
  ready(): Promise<{ version: string; platform: string; files: DocFile[]; recent: string[] }>;

  openFile(): Promise<DocFile | null>;
  openMedia(kind: 'image' | 'video' | 'audio'): Promise<DocFile[]>;
  readFile(path: string): Promise<DocFile>;
  saveFile(path: string, data: Uint8Array): Promise<boolean>;
  saveFileAs(o: { defaultName: string; filters: { name: string; extensions: string[] }[]; data: Uint8Array }): Promise<{ path: string; name: string } | null>;
  reveal(path: string): Promise<void>;

  exportPdf(o: { html: string; defaultName: string }): Promise<{ path: string } | null>;
  exportImages(o: { pages: string[]; width: number; height: number; format: 'png' | 'jpg'; baseName: string }): Promise<{ folder: string; count: number } | null>;
  print(o: { html: string }): Promise<boolean>;

  readClipboard(): Promise<{ text: string; png: Uint8Array | null }>;
  getSettings(): Promise<Record<string, any>>;
  setSettings(patch: Record<string, unknown>): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  confirmSave(name: string): Promise<'save' | 'discard' | 'cancel'>;
  message(o: { type?: 'info' | 'error' | 'warning'; message: string; detail?: string }): Promise<boolean>;
  setFullscreen(on: boolean): Promise<boolean>;

  setTitle(t: string): void;
  setOverlay(c: { color: string; symbolColor: string }): void;
  closeConfirmed(): void;
  closeCancelled?(): void;
  onMenuCommand?(cb: (id: string) => void): void;
  onCloseRequest(cb: () => void): void;
  onOpenFile(cb: (f: DocFile) => void): void;

  styles: {
    list(): Promise<StyleState>;
    installDialog(): Promise<InstallResult[]>;
    installData(name: string, data: Uint8Array): Promise<InstallResult>;
    remove(id: string): Promise<boolean>;
    enable(id: string, on: boolean): Promise<boolean>;
    use(id: string | null): Promise<boolean>;
    openFolder(): Promise<void>;
  };

  nc: {
    status(): Promise<{ server: string; user: string } | null>;
    loginFlow(server: string): Promise<{ server: string; user: string }>;
    loginCancel(): Promise<void>;
    loginManual(a: { server: string; user: string; password: string }): Promise<{ server: string; user: string }>;
    logout(): Promise<boolean>;
    list(path: string): Promise<NcEntry[]>;
    read(path: string): Promise<{ data: Uint8Array; etag?: string }>;
    write(path: string, data: Uint8Array, etag?: string): Promise<{ etag?: string }>;
    mkdir(path: string): Promise<void>;
    remove(path: string): Promise<void>;
    move(from: string, to: string): Promise<void>;
  };
}

declare global {
  interface Window {
    bnc: BncApi;
  }
}
