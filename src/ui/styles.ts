// App styles (.bnctheme plugins): applying a style to the UI, the "App color" menu and the Plugins window.
import type { App } from '../app';
import type { AppStyle, InstallResult, StyleState } from '../types/bnc';
import { h, iconEl, modal, toast, type MenuItem } from './dom';

export const BUILTIN = { name: 'Teal (built in)', swatch: ['#35c9b8', '#0f7f9c'] as [string, string] };
export const DEFAULT_LOGO = './icon.png';

const VARS = ['--accent', '--accent-strong', '--accent-rgb', '--accent-ink', '--accent-soft'];

const APP_NAMES: Record<string, string> = { 'bnc-ambient': 'BNC Ambient', 'bnc-docs': 'BNC Docs', 'bnc-presentation': 'BNC Presentation' };
const appName = (id: string) => APP_NAMES[id] ?? id.replace(/^bnc-/, 'BNC ').replace(/\b\w/g, (c) => c.toUpperCase());
const appNames = (ids: string[]) => ids.map(appName).join(', ');

const errMsg =(e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/** Recolour the whole UI (and swap the logo) for a style, or restore the built-in look when null. */
export function applyStyleToDom(style: AppStyle | null) {
  const root = document.documentElement.style;
  if (style && style.accent && style.accentRgb) {
    root.setProperty('--accent', style.accent);
    root.setProperty('--accent-strong', style.accent);
    root.setProperty('--accent-rgb', style.accentRgb);
    root.setProperty('--accent-ink', style.accentInk ?? '#ffffff');
    root.setProperty('--accent-soft', `rgba(${style.accentRgb}, 0.2)`);
  } else {
    for (const v of VARS) root.removeProperty(v);
  }
  const logo = style?.icon ?? DEFAULT_LOGO;
  document.querySelectorAll<HTMLImageElement>('img.app-logo, img[data-app-logo]').forEach((img) => (img.src = logo));
}

export async function refreshStyles(app: App): Promise<StyleState> {
  const state = await window.bnc.styles.list();
  app.styleState = state;
  app.activeStyle = state.styles.find((s) => s.id === state.active) ?? null;
  applyStyleToDom(app.activeStyle);
  return state;
}

export async function useStyle(app: App, id: string | null) {
  await window.bnc.styles.use(id);
  await refreshStyles(app);
  app.applyTheme(); // the title-bar buttons follow the background colour
  app.refreshUi();
}

/** Items for the "App Color" dropdown. */
export function appColorItems(app: App): MenuItem[] {
  const usable = app.styleState.styles.filter((s) => s.enabled && s.appliesHere);
  return [
    { label: BUILTIN.name, swatch: BUILTIN.swatch, checked: !app.activeStyle, run: () => void useStyle(app, null) },
    ...usable.map<MenuItem>((s) => ({ label: s.name, swatch: (s.swatch ?? [s.accent!, s.accent!]) as [string, string], checked: app.activeStyle?.id === s.id, run: () => void useStyle(app, s.id) })),
    { separator: true },
    { label: 'Plugins…', icon: 'layers', run: () => void pluginsDialog(app) },
  ];
}

function summarize(results: InstallResult[]): { text: string; kind: 'info' | 'error' } {
  const ok = results.filter((r): r is Extract<InstallResult, { ok: true }> => r.ok);
  const bad = results.filter((r): r is Extract<InstallResult, { ok: false }> => !r.ok);
  const parts: string[] = [];
  for (const r of ok) {
    parts.push(
      r.replaced ? `Updated "${r.name}" (${r.previousVersion} → ${r.version}).` : `Installed "${r.name}".` + (r.appliesHere ? '' : ` It has nothing for BNC Presentation (works with ${appNames(r.apps) || 'other apps'}).`),
    );
  }
  for (const r of bad) parts.push(`${r.file}: ${r.error}`);
  return { text: parts.join('\n'), kind: bad.length ? 'error' : 'info' };
}

export async function installFromResults(app: App, results: InstallResult[]) {
  if (!results.length) return;
  const { text, kind } = summarize(results);
  await refreshStyles(app);
  toast(text.split('\n').slice(0, 3).join(' '), kind, kind === 'error' ? 7000 : 4500);
}

export async function installStyleBytes(app: App, name: string, data: Uint8Array) {
  const r = await window.bnc.styles.installData(name, data);
  await installFromResults(app, [r]);
}

// ---------------------------------------------------------------------------
// Plugins window
// ---------------------------------------------------------------------------
export async function pluginsDialog(app: App) {
  await refreshStyles(app);
  const list = h('div', { class: 'plugin-list' });
  const msg = h('div', { class: 'muted', style: 'white-space:pre-wrap;margin-top:8px;min-height:18px' });

  const rerender = async () => {
    const state = await refreshStyles(app);
    list.replaceChildren();

    // the built-in colours
    list.append(
      h(
        'div',
        { class: `plugin-card${!app.activeStyle ? ' inuse' : ''}` },
        h('img', { class: 'plugin-icon', attrs: { src: DEFAULT_LOGO, alt: '' } }),
        h(
          'div',
          { class: 'plugin-body' },
          h('div', { class: 'plugin-title' }, h('span', { text: BUILTIN.name }), h('span', { class: 'tag', text: 'Built in' })),
          h('div', { class: 'plugin-meta', text: 'The default BNC Presentation colors and icon' }),
          h('div', { class: 'plugin-actions' }, !app.activeStyle ? h('span', { class: 'tag', text: 'In use' }) : h('button', { class: 'btn small primary', text: 'Use this color', on: { click: () => void useStyle(app, null).then(rerender) } })),
        ),
      ),
    );

    for (const s of state.styles) {
      const inUse = app.activeStyle?.id === s.id;
      const card = h('div', { class: `plugin-card${inUse ? ' inuse' : ''}${!s.enabled ? ' off' : ''}` });
      const sw = s.swatch ? `linear-gradient(135deg, ${s.swatch[0]}, ${s.swatch[1]})` : 'var(--surface-3)';
      card.append(
        s.icon ? h('img', { class: 'plugin-icon', attrs: { src: s.icon, alt: '' } }) : h('div', { class: 'plugin-icon', style: { background: sw } }),
        h(
          'div',
          { class: 'plugin-body' },
          h('div', { class: 'plugin-title' }, h('span', { text: s.name }), h('span', { class: 'tag', text: 'App style' }), !s.appliesHere ? h('span', { class: 'tag warn', text: 'Not for BNC Presentation' }) : null),
          h('div', { class: 'plugin-meta', text: `v${s.version}${s.author ? ' · ' + s.author : ''}${s.apps.length ? ' · works with ' + appNames(s.apps) : ''}` }),
          s.description ? h('div', { class: 'plugin-desc', text: s.description }) : null,
          h(
            'div',
            { class: 'plugin-actions' },
            h('label', { class: 'switch' }, h('input', { attrs: { type: 'checkbox', ...(s.enabled ? { checked: '' } : {}) }, on: { change: (e: any) => void window.bnc.styles.enable(s.id, e.target.checked).then(async () => { if (!e.target.checked && inUse) await useStyle(app, null); await rerender(); }) } }), s.enabled ? 'Active' : 'Off'),
            inUse
              ? h('span', { class: 'tag', text: 'In use' })
              : s.enabled && s.appliesHere
                ? h('button', { class: 'btn small primary', text: 'Use this color', on: { click: () => void useStyle(app, s.id).then(rerender) } })
                : null,
            h('button', { class: 'btn small', text: 'Remove', on: { click: () => void remove(s) } }),
          ),
        ),
      );
      list.append(card);
    }

    for (const b of state.broken) {
      list.append(
        h(
          'div',
          { class: 'plugin-card broken' },
          h('div', { class: 'plugin-icon', style: 'background:var(--surface-3);display:flex;align-items:center;justify-content:center' }, iconEl('info', 20)),
          h('div', { class: 'plugin-body' }, h('div', { class: 'plugin-title' }, h('span', { text: b.file }), h('span', { class: 'tag err', text: 'Could not load' })), h('div', { class: 'plugin-desc', text: b.error })),
        ),
      );
    }
  };

  const remove = async (s: AppStyle) => {
    if (!window.confirm(`Remove "${s.name}"?`)) return;
    await window.bnc.styles.remove(s.id);
    await refreshStyles(app);
    app.applyTheme();
    await rerender();
  };

  const install = async () => {
    try {
      const results = await window.bnc.styles.installDialog();
      if (!results.length) return;
      msg.textContent = summarize(results).text;
      await refreshStyles(app);
      await rerender();
    } catch (e) {
      msg.textContent = errMsg(e);
    }
  };

  const body = h(
    'div',
    null,
    h('p', { class: 'muted', style: 'margin-top:0', text: 'App styles recolor BNC Presentation and change its app icon. They contain only colors and pictures, no code.' }),
    list,
    msg,
  );
  modal(
    'Plugins',
    body,
    [
      { label: 'Open plugins folder', run: () => (void window.bnc.styles.openFolder(), false) },
      { label: 'Install plugin…', run: () => (void install(), false) },
      { label: 'Close', primary: true },
    ],
    { width: 600 },
  );
  await rerender();
}
