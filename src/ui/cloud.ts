// Nextcloud sign-in and file browser dialogs.
import type { App } from '../app';
import type { NcEntry } from '../types/bnc';
import { field, h, iconEl, modal, toast } from './dom';
import { formatFromName, OPENABLE_EXTS } from '../core/io';

const OPENABLE = new Set(OPENABLE_EXTS);

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/** Sign in (or manage the existing connection). Resolves true when connected. */
export function nextcloudDialog(app: App): Promise<boolean> {
  return new Promise(async (resolve) => {
    const status = await window.bnc.nc.status();
    let result = !!status;
    const finish = () => resolve(result);

    if (status) {
      modal(
        'Nextcloud',
        h(
          'div',
          null,
          h('p', null, 'Connected to ', h('strong', { text: status.server })),
          h('p', { class: 'muted', text: `Signed in as ${status.user}` }),
        ),
        [
          {
            label: 'Disconnect',
            run: async () => {
              await window.bnc.nc.logout();
              app.refreshCloudState();
              result = false;
              toast('Disconnected from Nextcloud.');
            },
          },
          { label: 'Close', primary: true },
        ],
        { onClose: finish, width: 420 },
      );
      return;
    }

    const server = h('input', { class: 'input', attrs: { type: 'text', placeholder: 'cloud.example.com' } });
    const user = h('input', { class: 'input', attrs: { type: 'text' } });
    const pass = h('input', { class: 'input', attrs: { type: 'password' } });
    const msg = h('div', { class: 'muted', style: 'min-height:20px' });
    const manual = h('div', { style: 'display:none' }, field('Username', user), field('App password', pass, 'Create one in Nextcloud: Settings > Security > Devices & sessions.'));
    const toggle = h('a', { text: 'Use an app password instead', style: 'color:var(--accent);cursor:pointer', on: { click: () => { manual.style.display = manual.style.display === 'none' ? 'block' : 'none'; } } });

    const dlg = modal(
      'Connect to Nextcloud',
      h('div', null, field('Server address', server), manual, h('div', null, toggle), msg),
      [
        {
          label: 'Cancel',
          run: () => void window.bnc.nc.loginCancel(),
        },
        {
          label: 'Sign in',
          primary: true,
          run: async () => {
            if (!server.value.trim()) {
              msg.textContent = 'Enter your Nextcloud server address.';
              return false;
            }
            try {
              if (manual.style.display !== 'none' && user.value && pass.value) {
                msg.textContent = 'Connecting…';
                await window.bnc.nc.loginManual({ server: server.value, user: user.value, password: pass.value });
              } else {
                msg.textContent = 'Finish signing in in your browser, then come back here…';
                await window.bnc.nc.loginFlow(server.value);
              }
              result = true;
              app.refreshCloudState();
              toast('Connected to Nextcloud.');
            } catch (e) {
              msg.textContent = errMsg(e);
              return false;
            }
          },
        },
      ],
      { onClose: () => { void window.bnc.nc.loginCancel(); finish(); }, width: 440 },
    );
    void dlg;
  });
}

export interface CloudPick {
  path: string;
  name: string;
}

/** File browser for opening or saving. */
export function cloudPicker(mode: 'open' | 'save', defaultName = 'Presentation.bncpres', startDir = '/', exts?: string[]): Promise<CloudPick | null> {
  const openable = exts ? new Set(exts) : OPENABLE;
  return new Promise((resolve) => {
    let dir = startDir;
    let selected: NcEntry | null = null;
    let picked: CloudPick | null = null;

    const crumbs = h('div', { class: 'nc-crumbs' });
    const list = h('div', { class: 'nc-list' });
    const nameInput = h('input', { class: 'input', value: defaultName, attrs: { type: 'text' } });

    const renderCrumbs = () => {
      crumbs.replaceChildren();
      const parts = dir.split('/').filter(Boolean);
      const add = (label: string, path: string) => {
        crumbs.append(h('button', { text: label, on: { click: () => void go(path) } }));
      };
      add('Nextcloud', '/');
      let acc = '';
      for (const p of parts) {
        acc += '/' + p;
        crumbs.append(h('span', { text: '/' }));
        add(p, acc);
      }
    };

    const go = async (path: string) => {
      dir = path;
      selected = null;
      renderCrumbs();
      list.replaceChildren(h('div', { class: 'muted', style: 'padding:14px', text: 'Loading…' }));
      try {
        const entries = await window.bnc.nc.list(path);
        list.replaceChildren();
        if (path !== '/') {
          const up = h('div', { class: 'nc-row' }, iconEl('left', 16), h('span', { class: 'nm', text: '..' }));
          up.addEventListener('click', () => void go(path.replace(/\/[^/]+$/, '') || '/'));
          list.append(up);
        }
        for (const e of entries) {
          const ext = e.name.split('.').pop()?.toLowerCase() ?? '';
          const enabled = e.isDir || mode === 'save' || openable.has(ext);
          const row = h(
            'div',
            { class: 'nc-row', style: enabled ? '' : 'opacity:.4' },
            iconEl(e.isDir ? 'folder' : 'doc', 16),
            h('span', { class: 'nm', text: e.name }),
            h('span', { class: 'meta', text: e.isDir ? '' : `${fmtSize(e.size)} · ${fmtDate(e.modified)}` }),
          );
          row.addEventListener('click', () => {
            if (e.isDir) return void go(e.path);
            if (!enabled) return;
            selected = e;
            list.querySelectorAll('.nc-row').forEach((r) => r.classList.remove('sel'));
            row.classList.add('sel');
            if (mode === 'save') nameInput.value = e.name;
          });
          row.addEventListener('dblclick', () => {
            if (!e.isDir && enabled && mode === 'open') {
              picked = { path: e.path, name: e.name };
              dlg.close();
            }
          });
          list.append(row);
        }
        if (!entries.length) list.append(h('div', { class: 'muted', style: 'padding:14px', text: 'This folder is empty.' }));
      } catch (err) {
        list.replaceChildren(h('div', { style: 'padding:14px;color:var(--danger)', text: errMsg(err) }));
      }
    };

    const newFolder = h('button', { class: 'btn', style: 'height:28px', text: 'New folder', on: {
      click: () => {
        const input = h('input', { class: 'input', attrs: { type: 'text', placeholder: 'Folder name' } });
        modal('New Folder', field('Name', input), [
          { label: 'Cancel' },
          {
            label: 'Create',
            primary: true,
            run: async () => {
              const n = input.value.trim().replace(/[\\/]/g, '');
              if (!n) return false;
              try {
                await window.bnc.nc.mkdir(`${dir === '/' ? '' : dir}/${n}`);
                void go(dir);
              } catch (e) {
                toast(errMsg(e), 'error');
                return false;
              }
            },
          },
        ], { width: 360 });
      },
    } });

    const body = h(
      'div',
      { class: 'nc-browser' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, crumbs, mode === 'save' ? newFolder : null),
      list,
      mode === 'save' ? h('div', { class: 'nc-save' }, h('span', { class: 'muted', text: 'File name' }), nameInput) : null,
    );

    const dlg = modal(
      mode === 'open' ? 'Open from Nextcloud' : 'Save to Nextcloud',
      body,
      [
        { label: 'Cancel' },
        {
          label: mode === 'open' ? 'Open' : 'Save',
          primary: true,
          run: () => {
            if (mode === 'open') {
              if (!selected) return false;
              picked = { path: selected.path, name: selected.name };
            } else {
              let n = nameInput.value.trim().replace(/[\\/]/g, '');
              if (!n) return false;
              if (!formatFromName(n)) n += '.bncpres';
              picked = { path: `${dir === '/' ? '' : dir}/${n}`, name: n };
            }
          },
        },
      ],
      { width: 620, onClose: () => resolve(picked) },
    );
    void go(dir);
  });
}
