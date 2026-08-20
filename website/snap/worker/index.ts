interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DEFAULT_VERSION: string;
  REPO_PUBLIC_BASE: string;
  STORE_PUBLIC_BASE: string;
  ARTIFACTS: R2Bucket;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

type JsonValue = Record<string, unknown> | unknown[];
const encoder = new TextEncoder();
const json = (value: JsonValue, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const now = () => Math.floor(Date.now() / 1000);
const SNAP_PACKAGE_NAME_RE = /^[a-z0-9][a-z0-9+.-]{0,62}$/;
function ipOf(request: Request) { return request.headers.get('CF-Connecting-IP') || 'unknown'; }
function safeVersion(value: string | null, env: Env) { const v = value || env.DEFAULT_VERSION || 'rolling'; return /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : env.DEFAULT_VERSION || 'rolling'; }
async function body<T>(request: Request): Promise<T> { return request.json() as Promise<T>; }

function base64UrlBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

function base64UrlJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as T;
}

async function verifyAccess(request: Request, env: Env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = base64UrlJson<{ alg?: string; kid?: string }>(parts[0]);
    const payload = base64UrlJson<{ aud?: string | string[]; exp?: number; iss?: string }>(parts[1]);
    if (header.alg !== 'RS256' || !header.kid || !payload.exp || payload.exp <= now()) return false;
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audience.includes(env.ACCESS_AUD)) return false;
    if ((payload.iss || '').replace(/\/$/, '') !== `https://${env.ACCESS_TEAM_DOMAIN}`) return false;
    const certs = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!certs.ok) return false;
    const result = await certs.json<{ keys?: Array<JsonWebKey & { kid?: string }> }>();
    const jwk = result.keys?.find(key => key.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlBytes(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return false;
  }
}

function publicCacheKey(request: Request, env: Env) {
  const source = new URL(request.url);
  const key = new URL(source.origin + source.pathname);
  if (source.pathname === '/api/storefront' || source.pathname === '/api/catalog') {
    key.searchParams.set('version', safeVersion(source.searchParams.get('version'), env));
    if (source.pathname === '/api/catalog') key.searchParams.set('schema', 'v3');
  } else if (source.pathname === '/api/search') {
    key.searchParams.set('version', safeVersion(source.searchParams.get('version'), env));
    key.searchParams.set('q', (source.searchParams.get('q') || '').trim().toLowerCase());
  } else if (source.pathname === '/api/app') {
    key.searchParams.set('version', safeVersion(source.searchParams.get('version'), env));
    key.searchParams.set('name', (source.searchParams.get('name') || '').trim().toLowerCase());
  }
  return new Request(key.toString(), { method: 'GET' });
}

function publicCacheResponse(response: Response, status: 'HIT' | 'MISS', browserTtl: number) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', `public, max-age=${browserTtl}, stale-while-revalidate=${browserTtl * 2}`);
  headers.set('x-capos-cache', status);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function edgeCached(request: Request, env: Env, ctx: ExecutionContext, edgeTtl: number, browserTtl: number, loader: () => Promise<Response>) {
  const cache = await caches.open('capos-snap-public-v2');
  const key = publicCacheKey(request, env);
  const cached = await cache.match(key);
  if (cached) return publicCacheResponse(cached, 'HIT', browserTtl);

  const response = await loader();
  if (!response.ok) return response;
  if (response.headers.get('x-capos-skip-edge-cache') === '1') {
    const headers = new Headers(response.headers);
    headers.delete('x-capos-skip-edge-cache');
    headers.set('x-capos-cache', 'BYPASS');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const stored = response.clone();
  stored.headers.set('cache-control', `public, max-age=${edgeTtl}`);
  stored.headers.delete('set-cookie');
  ctx.waitUntil(cache.put(key, stored));
  return publicCacheResponse(response, 'MISS', browserTtl);
}

async function audit(env: Env, request: Request, action: string, detail: Record<string, unknown> = {}) {
  await env.DB.prepare('INSERT INTO audit_log(action,detail_json,ip) VALUES(?,?,?)').bind(action, JSON.stringify(detail), ipOf(request)).run();
}

function mediaUrls(media: unknown, type: string) {
  if (!Array.isArray(media)) return [];
  return media
    .filter(item => typeof item === 'object' && item && (item as { type?: string }).type === type)
    .map(item => (item as { url?: string }).url)
    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url));
}

function mediaIcon(media: unknown) {
  return mediaUrls(media, 'icon')[0];
}

function isVideoUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'youtu.be'
      || host === 'youtube.com' || host.endsWith('.youtube.com')
      || host === 'vimeo.com' || host.endsWith('.vimeo.com')
      || host === 'asciinema.org' || host.endsWith('.asciinema.org');
  } catch {
    return false;
  }
}

function linkLabel(value: string) {
  const labels: Record<string, string> = {
    website: 'Website', contact: 'Contact', documentation: 'Documentation', issues: 'Report a bug',
    'source-code': 'Source code', source: 'Source code', donation: 'Donate', donations: 'Donate',
    video: 'Video', videos: 'Video', forum: 'Community', chat: 'Chat',
  };
  return labels[value] || value.split(/[-_]/).filter(Boolean).map(part => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function canonicalLinks(snap: Record<string, any>) {
  const links: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: unknown) => {
    if (typeof value !== 'string') return;
    let url = value.trim();
    if (label === 'Contact') {
      const address = url.replace(/^mailto:/i, '');
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) url = `mailto:${address}`;
    }
    const isWeb = /^https?:\/\//i.test(url);
    const isMail = label === 'Contact' && /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(url);
    if (!isWeb && !isMail) return;
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ label, url });
  };
  if (snap.links && typeof snap.links === 'object') {
    for (const [kind, values] of Object.entries(snap.links as Record<string, unknown>)) {
      for (const value of Array.isArray(values) ? values : [values]) push(linkLabel(kind), value);
    }
  }
  push('Website', snap.website);
  push('Contact', snap.contact);
  return links;
}

function canonicalApp(result: Record<string, any>, includeRich = false) {
  const snap = result.snap || {};
  const revision = result.revision || {};
  const publisher = snap.publisher || {};
  const categories = Array.isArray(snap.categories) ? snap.categories : [];
  const category = categories.find((c: any) => c.name !== 'featured')?.name || 'Utilities';
  const app = {
    id: result['snap-id'] || result.name,
    name: result.name,
    displayName: snap.title || result.name,
    publisher: publisher['display-name'] || publisher.username || 'Unknown',
    summary: snap.summary || '',
    description: snap.description || '',
    category: String(category).replace(/(^|-)\w/g, (m: string) => m.replace('-', ' ').toUpperCase()),
    icon: mediaIcon(snap.media),
    accent: '#2563eb',
    source: 'upstream',
    sourceName: 'Canonical',
    verified: publisher.validation === 'verified',
    featured: categories.some((c: any) => c.featured),
    version: revision.version || '—',
    channel: revision.channel || 'stable',
    architectures: ['amd64', 'arm64'],
    webdesktop: 'unknown',
    updated: 'Upstream',
  };
  if (!includeRich) return app;

  const links = canonicalLinks(snap);
  const linkedVideos = links.filter(link => isVideoUrl(link.url)).map(link => link.url);
  const videos = [...new Set([...mediaUrls(snap.media, 'video'), ...linkedVideos])];
  return {
    ...app,
    publisherUsername: publisher.username || undefined,
    banner: mediaUrls(snap.media, 'banner')[0],
    screenshots: mediaUrls(snap.media, 'screenshot'),
    videos,
    license: snap.license || undefined,
    website: snap.website || undefined,
    contact: snap.contact || undefined,
    storeUrl: snap['store-url'] || undefined,
    links: links.filter(link => !videos.includes(link.url)),
    confinement: revision.confinement || undefined,
    releasedAt: revision.releasedAt || undefined,
  };
}

const CANONICAL_LIST_FIELDS = 'title,summary,publisher,version,media,categories,channel,revision';

async function canonicalFind(base: string, query: URLSearchParams, cacheTtl = 120) {
  const params = new URLSearchParams(query); params.set('fields',CANONICAL_LIST_FIELDS);
  const response = await fetch(`${base.replace(/\/$/,'')}/v2/snaps/find?${params}`, { headers: { 'Snap-Device-Series': '16', 'Snap-Device-Architecture': 'amd64', 'User-Agent': 'CapOS-Snap-Store/0.1' }, cf: { cacheTtl, cacheEverything: true } });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  const payload = await response.json<{results?:Record<string,any>[]}>(); return (payload.results || []).map(result => canonicalApp(result));
}

async function canonicalInfo(base: string, name: string, cacheTtl = 3600) {
  const fields = 'title,summary,description,publisher,media,categories,license,contact,website,store-url,links,version,revision,confinement,created-at';
  const params = new URLSearchParams({ fields });
  const response = await fetch(`${base.replace(/\/$/,'')}/v2/snaps/info/${encodeURIComponent(name)}?${params}`, { headers: { 'Snap-Device-Series': '16', 'Snap-Device-Architecture': 'amd64', 'User-Agent': 'CapOS-Snap-Store/0.1' }, cf: { cacheTtl, cacheEverything: true } });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  const payload = await response.json<Record<string,any>>();
  const channelMap = Array.isArray(payload['channel-map']) ? payload['channel-map'] : [];
  const preferred = channelMap.find((entry:any) => entry.channel?.architecture === 'amd64' && entry.channel?.risk === 'stable') || channelMap[0] || {};
  const app = canonicalApp({
    'snap-id': payload['snap-id'],
    name: payload.name || name,
    snap: payload.snap || {},
    revision: {
      version: preferred.version,
      channel: preferred.channel?.name || preferred.channel?.risk,
      confinement: preferred.confinement,
      releasedAt: preferred.channel?.['released-at'] || preferred['created-at'],
    },
  }, true);
  app.architectures = [...new Set(channelMap.map((entry:any) => entry.channel?.architecture).filter(Boolean))] as string[];
  return app;
}

const CANONICAL_CATALOG_CATEGORIES = [
  'art-and-design', 'books-and-reference', 'development', 'devices-and-iot', 'education',
  'entertainment', 'finance', 'games', 'health-and-fitness', 'music-and-audio',
  'news-and-weather', 'personalisation', 'photo-and-video', 'productivity', 'science',
  'security', 'server-and-cloud', 'social', 'utilities'
];
const CATALOG_SNAPSHOT_KEY = '_cache/canonical-catalog-v3.json';
const CATALOG_SNAPSHOT_TTL = 6 * 3600;
let catalogRefreshPromise: Promise<void> | null = null;

interface CatalogSnapshot {
  generatedAt: number;
  apps: any[];
  availableCount: number;
}

function storefrontCategories(apps: any[]) {
  const categoryCounts = new Map<string,number>();
  for (const app of apps) categoryCounts.set(app.category,(categoryCounts.get(app.category)||0)+1);
  const glyphs=['⌘','◫','▶','◎','▱','✦'];
  return [...categoryCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,count],i)=>({name,count,glyph:glyphs[i]}));
}

async function canonicalCatalogSize() {
  try {
    const response = await fetch('https://snapcraft.io/store/sitemap.xml', { cf: { cacheTtl: 21600, cacheEverything: true } });
    if (!response.ok) return 0;
    const xml = await response.text();
    const matches = xml.match(/<loc>https:\/\/snapcraft\.io\/[a-z0-9][a-z0-9-]*<\/loc>/g) || [];
    return Math.max(0, matches.length - (matches.some(line => line.endsWith('/store</loc>')) ? 1 : 0));
  } catch {
    return 0;
  }
}

async function readCatalogSnapshot(env: Env): Promise<CatalogSnapshot | null> {
  try {
    const object = await env.ARTIFACTS.get(CATALOG_SNAPSHOT_KEY);
    if (!object) return null;
    const snapshot = JSON.parse(await object.text()) as CatalogSnapshot;
    return snapshot && Array.isArray(snapshot.apps) && Number.isFinite(snapshot.generatedAt) ? snapshot : null;
  } catch {
    return null;
  }
}

async function buildCatalogSnapshot(base: string): Promise<CatalogSnapshot> {
  const [defaultCatalog, featured, categoryCatalogs, availableCount] = await Promise.all([
    canonicalFind(base, new URLSearchParams(), 21600).catch(()=>[]),
    canonicalFind(base, new URLSearchParams({category:'featured'}), 21600).catch(()=>[]),
    Promise.all(CANONICAL_CATALOG_CATEGORIES.map(category => canonicalFind(base, new URLSearchParams({category}), 21600).catch(()=>[]))),
    canonicalCatalogSize()
  ]);
  const featuredNames = new Set(featured.map(app=>app.name));
  const remote = [
    ...featured.map(app=>({...app,featured:true})),
    ...defaultCatalog.map(app=>({...app,featured:featuredNames.has(app.name)})),
    ...categoryCatalogs.flat().map(app=>({...app,featured:featuredNames.has(app.name)}))
  ];
  const seen = new Set<string>();
  const apps = remote.filter(app => { if (seen.has(app.name)) return false; seen.add(app.name); return true; }).slice(0,1500);
  return { generatedAt: now(), apps, availableCount: availableCount || apps.length };
}

function refreshCatalogSnapshot(env: Env, base: string) {
  if (!catalogRefreshPromise) {
    catalogRefreshPromise = (async () => {
      const snapshot = await buildCatalogSnapshot(base);
      await env.ARTIFACTS.put(CATALOG_SNAPSHOT_KEY, JSON.stringify(snapshot), { httpMetadata: { contentType: 'application/json' } });
    })().finally(() => { catalogRefreshPromise = null; });
  }
  return catalogRefreshPromise;
}

async function localApps(env: Env, version: string) {
  const rows = await env.DB.prepare(`SELECT a.*, r.snap_version, r.channel, GROUP_CONCAT(DISTINCT r.architecture) architectures FROM apps a JOIN snap_revisions r ON r.app_id=a.id WHERE r.repository_version=? AND r.published=1 AND a.hidden=0 GROUP BY a.id ORDER BY a.featured DESC,a.display_name`).bind(version).all<Record<string,any>>();
  return rows.results.map(r => ({ id:r.id,name:r.name,displayName:r.display_name,publisher:r.publisher,summary:r.summary,description:r.description,category:r.category,icon:r.icon_url||undefined,accent:r.accent,source:'local',sourceName:'CapOS',verified:!!r.verified,featured:!!r.featured,version:r.snap_version,channel:r.channel,architectures:String(r.architectures||'').split(',').filter(Boolean),webdesktop:r.webdesktop_mode,updated:'Local' }));
}

async function upstreams(env: Env, version: string) {
  const rows = await env.DB.prepare(`SELECT u.id,u.name,u.api_url,u.kind,vu.priority,vu.enabled FROM version_upstreams vu JOIN upstreams u ON u.id=vu.upstream_id WHERE vu.version_name=? ORDER BY vu.priority`).bind(version).all<Record<string,any>>();
  return rows.results.map(r=>({id:r.id,name:r.name,apiUrl:r.api_url,kind:r.kind,priority:r.priority,enabled:!!r.enabled,status:'online'}));
}

async function storefront(request: Request, env: Env) {
  const url = new URL(request.url); const version = safeVersion(url.searchParams.get('version'), env); const locals = await localApps(env, version); const sources = await upstreams(env, version); let catalog:any[]=[]; let featured:any[]=[];
  const first = sources.find(s=>s.enabled);
  if (first?.kind === 'canonical') {
    const snapshot = await readCatalogSnapshot(env);
    if (snapshot) {
      const seen = new Set(locals.map(app=>app.name));
      const remote = snapshot.apps.filter(app => { if (seen.has(app.name)) return false; seen.add(app.name); return true; });
      const apps = [...locals, ...remote].slice(0,120);
      return json({version,apps,categories:storefrontCategories(apps),availableCount:snapshot.availableCount},200,{'cache-control':'public, max-age=60'});
    }
    try {
      [catalog, featured] = await Promise.all([
        canonicalFind(first.apiUrl, new URLSearchParams(), 21600),
        canonicalFind(first.apiUrl, new URLSearchParams({category:'featured'}), 21600)
      ]);
    } catch { catalog=[]; featured=[]; }
  }
  const featuredNames = new Set(featured.map(app=>app.name));
  const remote = [...featured.map(app=>({...app,featured:true})), ...catalog.map(app=>({...app,featured:featuredNames.has(app.name)}))];
  const seen = new Set(locals.map(a=>a.name));
  const uniqueRemote = remote.filter(app => { if (seen.has(app.name)) return false; seen.add(app.name); return true; });
  const apps=[...locals,...uniqueRemote].slice(0,120);
  const categories=storefrontCategories(apps);
  return json({version,apps,categories},200,{'cache-control':'public, max-age=60'});
}

async function richCatalog(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url); const version = safeVersion(url.searchParams.get('version'), env);
  const [locals, sources] = await Promise.all([localApps(env, version), upstreams(env, version)]);
  const first = sources.find(s=>s.enabled);
  if (first?.kind !== 'canonical') return json({version,apps:locals,categories:storefrontCategories(locals),availableCount:locals.length},200,{'cache-control':'public, max-age=300'});
  const snapshot = await readCatalogSnapshot(env);
  const stale = !snapshot || now() - snapshot.generatedAt > CATALOG_SNAPSHOT_TTL;
  if (stale) ctx.waitUntil(refreshCatalogSnapshot(env, first.apiUrl));
  if (!snapshot) return json({version,apps:locals,categories:storefrontCategories(locals),availableCount:0,refreshing:true},200,{'cache-control':'no-store','x-capos-skip-edge-cache':'1'});
  const seen = new Set(locals.map(app=>app.name));
  const uniqueRemote = snapshot.apps.filter(app => { if (seen.has(app.name)) return false; seen.add(app.name); return true; });
  const apps = [...locals, ...uniqueRemote].slice(0, 1500);
  const headers: Record<string,string> = stale ? {'cache-control':'no-store','x-capos-skip-edge-cache':'1'} : {'cache-control':'public, max-age=300'};
  return json({version,apps,categories:storefrontCategories(apps),availableCount:snapshot.availableCount || apps.length,refreshing:stale},200,headers);
}

async function searchStore(request: Request, env: Env) {
  const url = new URL(request.url); const version = safeVersion(url.searchParams.get('version'), env); const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ apps: [] });
  const locals = (await localApps(env, version)).filter(app => [app.name, app.displayName, app.publisher, app.summary, app.category].some(value => String(value).toLowerCase().includes(q.toLowerCase())));
  const sources = await upstreams(env, version); const remote: any[] = [];
  for (const source of sources.filter(s => s.enabled)) {
    if (source.kind !== 'canonical') continue;
    try { remote.push(...await canonicalFind(source.apiUrl, new URLSearchParams({ q }), 120)); } catch { /* try the next configured source */ }
  }
  const seen = new Set(locals.map(app => app.name));
  const uniqueRemote = remote.filter(app => {
    if (seen.has(app.name)) return false;
    seen.add(app.name);
    return true;
  });
  const merged = [...locals, ...uniqueRemote].slice(0, 60);
  return json({ apps: merged }, 200, { 'cache-control': 'public, max-age=45' });
}

async function appDetail(request: Request, env: Env) {
  const url = new URL(request.url); const version = safeVersion(url.searchParams.get('version'), env); const name = (url.searchParams.get('name') || '').trim().toLowerCase();
  if (!SNAP_PACKAGE_NAME_RE.test(name)) return json({ error: 'Invalid app name.' }, 400);
  const locals = await localApps(env, version); const local = locals.find(app => app.name === name);
  if (local) return json({ app: local }, 200, { 'cache-control': 'public, max-age=60' });
  const sources = await upstreams(env, version); const first = sources.find(source => source.enabled && source.kind === 'canonical');
  if (!first) return json({ error: 'App not found.' }, 404);
  try { return json({ app: await canonicalInfo(first.apiUrl, name) }, 200, { 'cache-control': 'public, max-age=300' }); }
  catch { return json({ error: 'App not found.' }, 404); }
}

async function adminState(request: Request, env: Env) {
  const version=safeVersion(new URL(request.url).searchParams.get('version'),env); const [versions,sources,locals]=await Promise.all([
    env.DB.prepare(`SELECT v.name,v.label,v.active,v.frozen,COUNT(DISTINCT r.app_id) app_count FROM repository_versions v LEFT JOIN snap_revisions r ON r.repository_version=v.name AND r.published=1 GROUP BY v.name ORDER BY v.created_at DESC`).all<Record<string,any>>(), upstreams(env,version), localApps(env,version)
  ]);
  return json({ versions:versions.results.map(v=>({name:v.name,label:v.label,active:!!v.active,frozen:!!v.frozen,appCount:v.app_count||0})), upstreams:sources.map(s=>({...s,latencyMs:undefined})), localPackages:locals, stats:{local:locals.length,upstream:0,versions:versions.results.length,downloads24h:0} });
}

async function putUpstreams(request: Request, env: Env) {
  const input=await body<{version:string;upstreams:{id:number;priority:number;enabled:boolean}[]}>(request); const version=safeVersion(input.version,env);
  const statements=input.upstreams.map((u,i)=>env.DB.prepare('UPDATE version_upstreams SET priority=?,enabled=? WHERE version_name=? AND upstream_id=?').bind((i+1)*10,u.enabled?1:0,version,u.id));
  if(statements.length) await env.DB.batch(statements); await audit(env,request,'upstreams.reorder',{version,count:statements.length}); return json({ok:true});
}

async function postUpstream(request: Request, env: Env) {
  const input=await body<{version:string;name:string;apiUrl:string}>(request); const version=safeVersion(input.version,env); let parsed:URL; try{parsed=new URL(input.apiUrl)}catch{return json({error:'Invalid upstream URL.'},400)} if(parsed.protocol!=='https:')return json({error:'Upstream must use HTTPS.'},400);
  const inserted=await env.DB.prepare('INSERT INTO upstreams(name,api_url,kind,enabled) VALUES(?,?,?,1) RETURNING id').bind(input.name.trim(),parsed.origin,'snap-store').first<{id:number}>(); const max=await env.DB.prepare('SELECT COALESCE(MAX(priority),0) p FROM version_upstreams WHERE version_name=?').bind(version).first<{p:number}>(); await env.DB.prepare('INSERT INTO version_upstreams(version_name,upstream_id,priority,enabled) VALUES(?,?,?,1)').bind(version,inserted!.id,(max?.p||0)+10).run(); await audit(env,request,'upstream.add',{version,id:inserted!.id,name:input.name}); return json({ok:true,id:inserted!.id});
}

async function postVersion(request: Request, env: Env) {
  const input=await body<{name:string;label:string;copyFrom?:string}>(request);
  const name=(input.name||'').trim(); const label=(input.label||'').trim(); const copyFrom=safeVersion(input.copyFrom||null,env);
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name))return json({error:'Version name may only contain letters, numbers, dot, underscore and hyphen.'},400);
  if(!label||label.length>80)return json({error:'Enter a display label up to 80 characters.'},400);
  const exists=await env.DB.prepare('SELECT name FROM repository_versions WHERE name=?').bind(name).first<{name:string}>();
  if(exists)return json({error:'That repository version already exists.'},409);
  const source=await env.DB.prepare('SELECT name FROM repository_versions WHERE name=?').bind(copyFrom).first<{name:string}>();
  if(!source)return json({error:'The source repository version does not exist.'},400);
  await env.DB.prepare('INSERT INTO repository_versions(name,label,active,frozen) VALUES(?,?,1,0)').bind(name,label).run();
  await env.DB.prepare('INSERT INTO version_upstreams(version_name,upstream_id,priority,enabled) SELECT ?,upstream_id,priority,enabled FROM version_upstreams WHERE version_name=?').bind(name,copyFrom).run();
  await audit(env,request,'version.create',{name,label,copyFrom});
  return json({ok:true,version:{name,label,active:true,frozen:false,appCount:0}});
}

const UPLOAD_PART_SIZE = 32 * 1024 * 1024;
const MAX_UPLOAD_PART_SIZE = 64 * 1024 * 1024;

function validSnapObjectPath(objectPath: string, version: string) {
  return objectPath.startsWith(`${version}/snaps/`) && objectPath.endsWith('.snap') && !objectPath.includes('..');
}

async function startPackageUpload(request: Request, env: Env) {
  const input = await body<{ version: string; name: string; versionString: string; architecture: string; size: number }>(request);
  const version = safeVersion(input.version, env);
  if (!SNAP_PACKAGE_NAME_RE.test(input.name)) return json({ error: 'Invalid Snap package name.' }, 400);
  if (!/^[A-Za-z0-9._+~-]{1,80}$/.test(input.versionString)) return json({ error: 'Invalid version string.' }, 400);
  if (!['amd64', 'arm64', 'armhf', 'all'].includes(input.architecture)) return json({ error: 'Invalid architecture.' }, 400);
  if (!Number.isSafeInteger(input.size) || input.size <= 0) return json({ error: 'Invalid package size.' }, 400);

  const objectPath = `${version}/snaps/${input.name}_${input.versionString}_${input.architecture}.snap`;
  const upload = await env.ARTIFACTS.createMultipartUpload(objectPath, {
    httpMetadata: { contentType: 'application/vnd.snap' },
  });
  await audit(env, request, 'package.upload.start', { version, name: input.name, objectPath, size: input.size });
  return json({ uploadId: upload.uploadId, objectPath, partSize: UPLOAD_PART_SIZE });
}

async function uploadPackagePart(request: Request, env: Env) {
  const url = new URL(request.url);
  const version = safeVersion(url.searchParams.get('version'), env);
  const objectPath = url.searchParams.get('objectPath') || '';
  const uploadId = url.searchParams.get('uploadId') || '';
  const partNumber = Number(url.searchParams.get('partNumber'));
  const contentLength = Number(request.headers.get('content-length') || '0');

  if (!validSnapObjectPath(objectPath, version) || !uploadId) return json({ error: 'Invalid multipart upload.' }, 400);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return json({ error: 'Invalid part number.' }, 400);
  if (!request.body) return json({ error: 'Missing upload part.' }, 400);
  if (contentLength > MAX_UPLOAD_PART_SIZE) return json({ error: 'Upload part is too large.' }, 413);

  const upload = env.ARTIFACTS.resumeMultipartUpload(objectPath, uploadId);
  const part = await upload.uploadPart(partNumber, request.body);
  return json({ partNumber: part.partNumber, etag: part.etag });
}

async function abortPackageUpload(request: Request, env: Env) {
  const input = await body<{ version: string; objectPath: string; uploadId: string }>(request);
  const version = safeVersion(input.version, env);
  if (!validSnapObjectPath(input.objectPath, version) || !input.uploadId) return json({ error: 'Invalid multipart upload.' }, 400);
  await env.ARTIFACTS.resumeMultipartUpload(input.objectPath, input.uploadId).abort();
  await audit(env, request, 'package.upload.abort', { version, objectPath: input.objectPath });
  return json({ ok: true });
}

async function finalizePackage(request: Request, env: Env) {
  const input = await body<Record<string, any>>(request);
  const version = safeVersion(input.version, env);
  const objectPath = String(input.objectPath || '');
  const uploadId = String(input.uploadId || '');
  const parts = Array.isArray(input.parts) ? input.parts : [];
  const expectedSize = Number(input.size) || 0;
  if (!validSnapObjectPath(objectPath, version) || !uploadId || !parts.length) return json({ error: 'Invalid multipart upload.' }, 400);

  const completed = await env.ARTIFACTS.resumeMultipartUpload(objectPath, uploadId).complete(parts);
  if (expectedSize <= 0 || completed.size !== expectedSize) {
    await env.ARTIFACTS.delete(objectPath);
    return json({ error: 'Uploaded package size did not match the expected size.' }, 400);
  }

  const id = `local:${input.name}`;
  await env.DB.prepare(`INSERT INTO apps(id,name,display_name,publisher,summary,description,category,accent,verified,featured,webdesktop_mode) VALUES(?,?,?,?,?,?,?,?,1,0,'unknown') ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,updated_at=CURRENT_TIMESTAMP`).bind(id,input.name,input.displayName||input.name,'CapOS',input.summary||'',input.description||'',input.category||'Utilities',input.accent||'#2563eb').run();
  const rev = String(Date.now());
  await env.DB.prepare(`INSERT INTO snap_revisions(app_id,repository_version,snap_version,revision,architecture,channel,object_path,size,published) VALUES(?,?,?,?,?,?,?,?,1)`).bind(id,version,input.versionString,rev,input.architecture,input.channel||'stable',objectPath,completed.size).run();
  await audit(env,request,'package.publish',{version,name:input.name,objectPath,size:completed.size});
  return json({ok:true,revision:rev,downloadUrl:`${env.REPO_PUBLIC_BASE.replace(/\/$/,'')}/${objectPath}`});
}

function sameOrigin(a: URL, b: URL) {
  return a.protocol === b.protocol && a.host === b.host;
}

function upstreamApiOrigins(sources: { apiUrl: string }[]) {
  const origins = new Set<string>();
  for (const source of sources) {
    try { origins.add(new URL(source.apiUrl).origin); } catch { /* validated when configured */ }
  }
  return origins;
}

function upstreamApiHosts(sources: { apiUrl: string }[]) {
  const hosts = new Set<string>();
  for (const source of sources) {
    try { hosts.add(new URL(source.apiUrl).hostname); } catch { /* validated when configured */ }
  }
  return hosts;
}

function canonicalPayloadHost(hostname: string) {
  return hostname === 'api.snapcraft.io' ||
    hostname === 'api.staging.snapcraft.io' ||
    hostname.endsWith('.snapcraft.io') ||
    hostname.endsWith('.snapcraftcontent.com') ||
    hostname.endsWith('.canonical.com') ||
    hostname.endsWith('.ubuntu.com');
}

function payloadDownloadPath(pathname: string) {
  return pathname.includes('/api/v1/snaps/download/') ||
    pathname.includes('/api/v1/snaps/dm-verity/download/');
}

function storePublicOrigin(request: Request, env: Env) {
  const configured = env.STORE_PUBLIC_BASE || new URL(request.url).origin;
  return new URL(configured).origin;
}

function downloadProxyUrl(origin: string, target: URL, version: string) {
  const out = new URL('/download/upstream', origin);
  out.searchParams.set('url', target.toString());
  out.searchParams.set('version', version);
  return out.toString();
}

function rewriteStoreUrl(raw: string, requestOrigin: string, version: string, sources: { apiUrl: string }[], path: string[] = []) {
  let value: URL;
  try { value = new URL(raw); } catch { return raw; }

  const sourceOrigins = upstreamApiOrigins(sources);
  const sourceHosts = upstreamApiHosts(sources);
  const isStoreApiPath = value.pathname.startsWith('/v2/') ||
    (value.pathname.startsWith('/api/v1/') && !payloadDownloadPath(value.pathname));
  if ((sourceOrigins.has(value.origin) || sourceHosts.has(value.hostname)) && isStoreApiPath) {
    const local = new URL(value.pathname + value.search + value.hash, requestOrigin);
    return local.toString();
  }

  const inDownloadField = path.some(part => part.toLowerCase().includes('download'));
  const canonicalDownload = canonicalPayloadHost(value.hostname) &&
    (payloadDownloadPath(value.pathname) || value.hostname.endsWith('.snapcraftcontent.com'));
  if (inDownloadField || canonicalDownload) return downloadProxyUrl(requestOrigin, value, version);

  return raw;
}

function rewriteStoreJson(value: unknown, requestOrigin: string, version: string, sources: { apiUrl: string }[], path: string[] = []): unknown {
  if (typeof value === 'string') return rewriteStoreUrl(value, requestOrigin, version, sources, path);
  if (Array.isArray(value)) return value.map((item, index) => rewriteStoreJson(item, requestOrigin, version, sources, [...path, String(index)]));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, rewriteStoreJson(item, requestOrigin, version, sources, [...path, key])]));
  }
  return value;
}

function rewriteStoreLocation(location: string, requestOrigin: string, version: string, sources: { apiUrl: string }[]) {
  return rewriteStoreUrl(location, requestOrigin, version, sources, ['location']);
}

async function rewriteStoreResponse(response: Response, request: Request, env: Env, version: string, sources: { apiUrl: string }[]) {
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  headers.set('x-capos-store', 'federated');
  const publicOrigin = storePublicOrigin(request, env);

  const location = headers.get('location');
  if (location) headers.set('location', rewriteStoreLocation(location, publicOrigin, version, sources));

  const contentType = headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const raw = await response.text();
  if (!raw) {
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('etag');
    return new Response(null, { status: response.status, statusText: response.statusText, headers });
  }
  const payload = JSON.parse(raw) as unknown;
  const rewritten = rewriteStoreJson(payload, publicOrigin, version, sources);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  return new Response(JSON.stringify(rewritten), { status: response.status, statusText: response.statusText, headers });
}

async function proxyStore(request: Request, env: Env, version: string) {
  const sources = (await upstreams(env, version)).filter(source => source.enabled);
  if (!sources.length) return json({'error-list':[{'code':'no-upstream','message':'No enabled Snap upstream.'}]},503);

  const incoming = new URL(request.url);
  const bodyBytes = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  let lastError: unknown;

  for (const source of sources) {
    const target = new URL(source.apiUrl);
    if (sameOrigin(target, incoming)) continue; // Never recursively proxy ourselves.
    target.pathname = incoming.pathname;
    target.search = incoming.search;

    const headers = new Headers(request.headers);
    headers.set('Snap-Device-Series', headers.get('Snap-Device-Series') || '16');
    if (!headers.get('User-Agent')) headers.set('User-Agent', 'CapOS-snapd/1');
    headers.delete('host');
    headers.delete('cookie');

    try {
      const response = await fetch(new Request(target, {
        method: request.method,
        headers,
        body: bodyBytes,
        redirect: 'manual',
      }));
      if (response.status >= 500 && sources.length > 1) {
        lastError = new Error(`${source.name} returned ${response.status}`);
        continue;
      }
      return rewriteStoreResponse(response, request, env, version, sources);
    } catch (error) {
      lastError = error;
    }
  }

  console.error('all Snap Store upstreams failed', lastError);
  return json({'error-list':[{'code':'upstream-unavailable','message':'All configured Snap upstreams are unavailable.'}]},502);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function upstreamPayloadCacheKey(upstream: URL) {
  return `upstream-cache/${await sha256Hex(upstream.toString())}.snap`;
}

function r2RangeHeaders(object: R2ObjectBody, headers: Headers) {
  if (!object.range) return;
  const range = object.range as { offset?: number; length?: number; suffix?: number };
  let offset = 0;
  let length = object.size;
  if (typeof range.suffix === 'number') {
    length = Math.min(range.suffix, object.size);
    offset = object.size - length;
  } else {
    offset = typeof range.offset === 'number' ? range.offset : 0;
    length = typeof range.length === 'number' ? range.length : Math.max(0, object.size - offset);
  }
  headers.set('content-range', `bytes ${offset}-${offset + Math.max(0, length - 1)}/${object.size}`);
  headers.set('content-length', String(length));
}

async function cachedPayload(request: Request, env: Env, cacheKey: string) {
  const object = await env.ARTIFACTS.get(cacheKey, request.headers.has('range') ? { range: request.headers } : undefined);
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=86400, stale-while-revalidate=604800');
  headers.set('x-capos-store', 'payload-cache');
  r2RangeHeaders(object, headers);
  return new Response(request.method === 'HEAD' ? null : object.body, {
    status: object.range ? 206 : 200,
    headers,
  });
}

async function proxyDownload(request: Request, env: Env, ctx: ExecutionContext) {
  const u = new URL(request.url);
  const version = safeVersion(u.searchParams.get('version'), env);
  const target = u.searchParams.get('url');
  if (!target) return json({error:'Missing download URL.'},400);

  let upstream: URL;
  try { upstream = new URL(target); } catch { return json({error:'Invalid download URL.'},400); }
  const sources = (await upstreams(env, version)).filter(source => source.enabled);
  const allowedOrigins = upstreamApiOrigins(sources);
  const allowed = upstream.protocol === 'https:' && (canonicalPayloadHost(upstream.hostname) || allowedOrigins.has(upstream.origin));
  if (!allowed) return json({error:'Download host is not an allowed upstream.'},403);

  const cacheKey = await upstreamPayloadCacheKey(upstream);
  const cached = await cachedPayload(request, env, cacheKey);
  if (cached) return cached;

  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('authorization');
  headers.delete('host');
  const response = await fetch(new Request(upstream, {
    method: request.method,
    headers,
    redirect: 'follow',
  }), { cf: { cacheEverything: request.method === 'GET', cacheTtl: 86400 } });
  const out = new Headers(response.headers);
  out.set('cache-control','public, max-age=3600, stale-while-revalidate=86400');
  out.set('x-capos-store','payload');
  out.delete('set-cookie');
  if (request.method === 'GET' && !request.headers.has('range') && response.status === 200 && response.body) {
    const [clientBody, cacheBody] = response.body.tee();
    ctx.waitUntil(env.ARTIFACTS.put(cacheKey, cacheBody, {
      httpMetadata: response.headers,
      customMetadata: { source: upstream.toString() },
    }).catch(error => console.error('unable to cache upstream Snap payload', error)));
    return new Response(clientBody,{status:response.status,statusText:response.statusText,headers:out});
  }
  return new Response(request.method === 'HEAD' ? null : response.body,{status:response.status,statusText:response.statusText,headers:out});
}


async function embeddedStore(request: Request, env: Env) {
  const url = new URL(request.url);
  url.pathname = '/';
  url.search = '';
  const assetRequest = new Request(url.toString(), { method: request.method, headers: request.headers });
  const response = await env.ASSETS.fetch(assetRequest);
  const headers = new Headers(response.headers);
  headers.delete('x-frame-options');
  headers.delete('content-security-policy');
  headers.set('content-security-policy', 'frame-ancestors *');
  headers.set('cache-control', 'no-cache');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function api(request:Request,env:Env,ctx:ExecutionContext){const url=new URL(request.url);const p=url.pathname;
  if(p==='/api/storefront'&&request.method==='GET')return edgeCached(request,env,ctx,120,15,()=>storefront(request,env));
  if(p==='/api/catalog'&&request.method==='GET')return edgeCached(request,env,ctx,300,30,()=>richCatalog(request,env,ctx));
  if(p==='/api/search'&&request.method==='GET')return edgeCached(request,env,ctx,60,10,()=>searchStore(request,env));
  if(p==='/api/app'&&request.method==='GET')return edgeCached(request,env,ctx,1800,60,()=>appDetail(request,env));
  if(p==='/download/upstream'&&(request.method==='GET'||request.method==='HEAD'))return proxyDownload(request,env,ctx);
  if(p==='/api/admin'||p.startsWith('/api/admin/')){if(!(await verifyAccess(request,env)))return json({error:'Cloudflare Access authentication required.'},401);if(p==='/api/admin/state'&&request.method==='GET')return adminState(request,env);if(p==='/api/admin/versions'&&request.method==='POST')return postVersion(request,env);if(p==='/api/admin/upstreams'&&request.method==='PUT')return putUpstreams(request,env);if(p==='/api/admin/upstreams'&&request.method==='POST')return postUpstream(request,env);if(p==='/api/admin/packages/uploads'&&request.method==='POST')return startPackageUpload(request,env);if(p==='/api/admin/packages/upload-part'&&request.method==='PUT')return uploadPackagePart(request,env);if(p==='/api/admin/packages/abort'&&request.method==='POST')return abortPackageUpload(request,env);if(p==='/api/admin/packages/finalize'&&request.method==='POST')return finalizePackage(request,env);}
  if(p.startsWith('/api/v1/')||p.startsWith('/v2/')){const version=safeVersion(request.headers.get('X-CapOS-Version'),env);return proxyStore(request,env,version);}
  return json({error:'Not found.'},404);
}

export default {async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{try{const p=new URL(request.url).pathname;if(p==='/embed'||p.startsWith('/embed/'))return await embeddedStore(request,env);if(p.startsWith('/api/')||p.startsWith('/v2/')||p.startsWith('/download/'))return await api(request,env,ctx);return env.ASSETS.fetch(request)}catch(error){console.error(error);return json({error:'Internal store error.'},500)}}};
