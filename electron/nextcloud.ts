// Minimal Nextcloud / WebDAV client. Runs in the main process (no CORS, credentials never reach the page).
import { XMLParser } from 'fast-xml-parser';
import { shell } from 'electron';

export interface NcAccount {
  server: string;
  user: string;
  password: string;
}

export interface NcEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
  etag?: string;
}

const UA = 'BNC Presentation';
const xml = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false });

export function normalizeServer(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/index\.php.*$/i, '').replace(/\/remote\.php.*$/i, '').replace(/\/apps\/.*$/i, '');
  return s;
}

const encodePath = (p: string) =>
  p
    .split('/')
    .filter((x, i) => x !== '' || i === 0)
    .map((seg) => encodeURIComponent(seg))
    .join('/');

function davRoot(a: NcAccount) {
  return `${normalizeServer(a.server)}/remote.php/dav/files/${encodeURIComponent(a.user)}`;
}
const urlFor = (a: NcAccount, path: string) => davRoot(a) + (path.startsWith('/') ? '' : '/') + encodePath(path === '/' ? '' : path);
const authHeader = (a: NcAccount) => 'Basic ' + Buffer.from(`${a.user}:${a.password}`).toString('base64');

async function dav(a: NcAccount, method: string, path: string, init: { headers?: Record<string, string>; body?: any } = {}) {
  const res = await fetch(urlFor(a, path), {
    method,
    headers: { Authorization: authHeader(a), 'User-Agent': UA, ...(init.headers ?? {}) },
    body: init.body,
  });
  return res;
}

function explain(res: Response, what: string): Error {
  if (res.status === 401) return new Error('Nextcloud rejected the login. Check the username and app password.');
  if (res.status === 403) return new Error(`Nextcloud denied access (${what}).`);
  if (res.status === 404) return new Error(`Not found on Nextcloud (${what}).`);
  if (res.status === 412) return new Error('conflict: the file changed on Nextcloud since you opened it.');
  if (res.status === 423) return new Error('The file is locked on Nextcloud (someone else is editing it).');
  return new Error(`Nextcloud error ${res.status} (${what}).`);
}

export async function testConnection(a: NcAccount): Promise<void> {
  const res = await dav(a, 'PROPFIND', '/', {
    headers: { Depth: '0', 'Content-Type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
  });
  if (res.status !== 207) throw explain(res, 'connecting');
}

export async function list(a: NcAccount, path: string): Promise<NcEntry[]> {
  const res = await dav(a, 'PROPFIND', path, {
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getlastmodified/><d:getcontentlength/><d:resourcetype/><d:getetag/></d:prop></d:propfind>',
  });
  if (res.status !== 207) throw explain(res, 'listing ' + path);
  const parsed = xml.parse(await res.text());
  let responses = parsed?.multistatus?.response ?? [];
  if (!Array.isArray(responses)) responses = [responses];
  const basePath = decodeURIComponent(new URL(davRoot(a)).pathname).replace(/\/+$/, '');
  const self = path.replace(/\/+$/, '') || '/';
  const out: NcEntry[] = [];
  for (const r of responses) {
    const href = decodeURIComponent(String(r.href));
    let rel = href.startsWith(basePath) ? href.slice(basePath.length) : href;
    const isDir = rel.endsWith('/') || r.propstat?.prop?.resourcetype?.collection !== undefined;
    rel = rel.replace(/\/+$/, '') || '/';
    if (rel === self) continue;
    const prop = Array.isArray(r.propstat) ? r.propstat.find((p: any) => String(p.status).includes('200'))?.prop : r.propstat?.prop;
    out.push({
      name: rel.split('/').pop() ?? rel,
      path: rel,
      isDir,
      size: Number(prop?.getcontentlength ?? 0),
      modified: String(prop?.getlastmodified ?? ''),
      etag: prop?.getetag ? String(prop.getetag) : undefined,
    });
  }
  out.sort((x, y) => Number(y.isDir) - Number(x.isDir) || x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
  return out;
}

export async function read(a: NcAccount, path: string): Promise<{ data: Uint8Array; etag?: string }> {
  const res = await dav(a, 'GET', path);
  if (!res.ok) throw explain(res, 'opening ' + path);
  return { data: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get('etag') ?? res.headers.get('oc-etag') ?? undefined };
}

export async function write(a: NcAccount, path: string, data: Uint8Array, ifMatch?: string): Promise<{ etag?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
  if (ifMatch) headers['If-Match'] = ifMatch;
  const res = await dav(a, 'PUT', path, { headers, body: Buffer.from(data) });
  if (!res.ok) throw explain(res, 'saving ' + path);
  return { etag: res.headers.get('etag') ?? res.headers.get('oc-etag') ?? undefined };
}

export async function mkdir(a: NcAccount, path: string): Promise<void> {
  const res = await dav(a, 'MKCOL', path);
  if (!res.ok && res.status !== 405) throw explain(res, 'creating folder');
}

export async function remove(a: NcAccount, path: string): Promise<void> {
  const res = await dav(a, 'DELETE', path);
  if (!res.ok) throw explain(res, 'deleting');
}

export async function move(a: NcAccount, from: string, to: string): Promise<void> {
  const res = await dav(a, 'MOVE', from, { headers: { Destination: urlFor(a, to), Overwrite: 'F' } });
  if (!res.ok) throw explain(res, 'moving');
}

// Login Flow v2: the user signs in in their browser and Nextcloud hands back an app password,
// so no password is ever typed into BNC Presentation.
let loginAbort: AbortController | undefined;

export async function loginFlow(serverInput: string): Promise<NcAccount> {
  const server = normalizeServer(serverInput);
  loginAbort?.abort();
  const abort = (loginAbort = new AbortController());
  const start = await fetch(`${server}/index.php/login/v2`, { method: 'POST', headers: { 'User-Agent': UA }, signal: abort.signal });
  if (!start.ok) throw new Error(`Could not start the Nextcloud login (${start.status}). Is that the right server address?`);
  const info: any = await start.json();
  await shell.openExternal(info.login);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (abort.signal.aborted) throw new Error('Login cancelled.');
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(info.poll.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: `token=${encodeURIComponent(info.poll.token)}`,
      signal: abort.signal,
    }).catch(() => undefined);
    if (poll && poll.status === 200) {
      const j: any = await poll.json();
      return { server: normalizeServer(j.server), user: j.loginName, password: j.appPassword };
    }
  }
  throw new Error('Timed out waiting for the Nextcloud login.');
}

export function cancelLogin() {
  loginAbort?.abort();
}
