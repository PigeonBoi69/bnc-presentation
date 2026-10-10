import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('bnc', {
  platform: process.platform,
  ready: () => invoke('app:ready'),

  openFile: () => invoke('file:open'),
  openMedia: (kind: 'image' | 'video' | 'audio') => invoke('file:open-media', kind),
  readFile: (p: string) => invoke('file:read', p),
  saveFile: (p: string, data: Uint8Array) => invoke('file:save', p, data),
  saveFileAs: (o: { defaultName: string; filters: { name: string; extensions: string[] }[]; data: Uint8Array }) => invoke('file:save-as', o),
  reveal: (p: string) => invoke('file:reveal', p),

  exportPdf: (o: { html: string; defaultName: string }) => invoke('pdf:export', o),
  exportImages: (o: { pages: string[]; width: number; height: number; format: 'png' | 'jpg'; baseName: string }) => invoke('images:export', o),
  print: (o: { html: string }) => invoke('print', o),

  readClipboard: () => invoke('clipboard:read'),
  getSettings: () => invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => invoke('settings:set', patch),
  openExternal: (url: string) => invoke('shell:open-external', url),
  confirmSave: (name: string) => invoke('dialog:confirm-save', name),
  message: (o: { type?: 'info' | 'error' | 'warning'; message: string; detail?: string }) => invoke('dialog:message', o),
  setFullscreen: (on: boolean) => invoke('win:fullscreen', on),

  setTitle: (t: string) => ipcRenderer.send('win:title', t),
  setOverlay: (c: { color: string; symbolColor: string }) => ipcRenderer.send('win:overlay', c),
  closeConfirmed: () => ipcRenderer.send('app:close-confirmed'),
  closeCancelled: () => ipcRenderer.send('app:close-cancelled'),
  onMenuCommand: (cb: (id: string) => void) => ipcRenderer.on('menu:command', (_e, id: string) => cb(id)),
  onCloseRequest: (cb: () => void) => ipcRenderer.on('app:close-request', () => cb()),
  onOpenFile: (cb: (f: any) => void) => ipcRenderer.on('app:open-file', (_e, f) => cb(f)),

  styles: {
    list: () => invoke('style:list'),
    installDialog: () => invoke('style:install-dialog'),
    installData: (name: string, data: Uint8Array) => invoke('style:install-data', name, data),
    remove: (id: string) => invoke('style:remove', id),
    enable: (id: string, on: boolean) => invoke('style:enable', id, on),
    use: (id: string | null) => invoke('style:use', id),
    openFolder: () => invoke('style:open-folder'),
  },

  nc: {
    status: () => invoke('nc:status'),
    loginFlow: (server: string) => invoke('nc:login-flow', server),
    loginCancel: () => invoke('nc:login-cancel'),
    loginManual: (a: { server: string; user: string; password: string }) => invoke('nc:login-manual', a),
    logout: () => invoke('nc:logout'),
    list: (p: string) => invoke('nc:list', p),
    read: (p: string) => invoke('nc:read', p),
    write: (p: string, data: Uint8Array, etag?: string) => invoke('nc:write', p, data, etag),
    mkdir: (p: string) => invoke('nc:mkdir', p),
    remove: (p: string) => invoke('nc:remove', p),
    move: (from: string, to: string) => invoke('nc:move', from, to),
  },
});
