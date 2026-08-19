interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DEFAULT_VERSION: string;
  REPO_PUBLIC_BASE: string;
  ARTIFACTS: R2Bucket;
  ADMIN_PIN_HASH?: string;
  SESSION_SECRET?: string;
}

type JsonValue = Record<string, unknown> | unknown[];
const encoder = new TextEncoder();
const json = (value: JsonValue, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const now = () => Math.floor(Date.now() / 1000);
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(value: string) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
function ipOf(request: Request) { return request.headers.get('CF-Connecting-IP') || 'unknown'; }
function safeVersion(value: string | null, env: Env) { const v = value || env.DEFAULT_VERSION || 'rolling'; return /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : env.DEFAULT_VERSION || 'rolling'; }
function cookie(request: Request, name: string) { const raw = request.headers.get('cookie') || ''; for (const part of raw.split(';')) { const [k,...rest] = part.trim().split('='); if (k === name) return decodeURIComponent(rest.join('=')); } return null; }
async function body<T>(request: Request): Promise<T> { return request.json() as Promise<T>; }

function publicCacheKey(request: Request, env: Env) {
  const source = new URL(request.url);
  const key = new URL(source.origin + source.pathname);
  if (source.pathname === '/api/storefront') {
    key.searchParams.set('version', safeVersion(source.searchParams.get('version'), env));
  } else if (source.pathname === '/api/search') {
    key.searchParams.set('version', safeVersion(source.searchParams.get('version'), env));
    key.searchParams.set('q', (source.searchParams.get('q') || '').trim().toLowerCase());
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
  const cache = await caches.open('capos-snap-public-v1');
  const key = publicCacheKey(request, env);
  const cached = await cache.match(key);
  if (cached) return publicCacheResponse(cached, 'HIT', browserTtl);

  const response = await loader();
  if (!response.ok) return response;
  const stored = response.clone();
  stored.headers.set('cache-control', `public, max-age=${edgeTtl}`);
  stored.headers.delete('set-cookie');
  ctx.waitUntil(cache.put(key, stored));
  return publicCacheResponse(response, 'MISS', browserTtl);
}

async function audit(env: Env, request: Request, action: string, detail: Record<string, unknown> = {}) {
  await env.DB.prepare('INSERT INTO audit_log(action,detail_json,ip) VALUES(?,?,?)').bind(action, JSON.stringify(detail), ipOf(request)).run();
}

async function authenticate(request: Request, env: Env) {
  const token = cookie(request, 'capos_store_session');
  if (!token) return false;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash=?').bind(tokenHash).first<{ expires_at: number }>();
  if (!row || row.expires_at <= now()) return false;
  return true;
}

async function login(request: Request, env: Env) {
  if (!env.ADMIN_PIN_HASH || !env.SESSION_SECRET) return json({ error: 'Administrator authentication is not configured.' }, 503);
  const ip = ipOf(request); const t = now();
  const failure = await env.DB.prepare('SELECT attempts,window_start,locked_until FROM login_failures WHERE ip=?').bind(ip).first<{attempts:number;window_start:number;locked_until:number}>();
  if (failure?.locked_until && failure.locked_until > t) return json({ error: 'Too many attempts. Try again later.' }, 429);
  const input = await body<{ pin?: string }>(request);
  const candidate = await sha256(`${input.pin || ''}:${env.SESSION_SECRET}`);
  if (candidate !== env.ADMIN_PIN_HASH) {
    const inWindow = failure && t - failure.window_start < 300; const attempts = inWindow ? failure!.attempts + 1 : 1; const locked = attempts >= 5 ? t + 900 : 0;
    await env.DB.prepare(`INSERT INTO login_failures(ip,attempts,window_start,locked_until) VALUES(?,?,?,?) ON CONFLICT(ip) DO UPDATE SET attempts=excluded.attempts,window_start=excluded.window_start,locked_until=excluded.locked_until`).bind(ip, attempts, inWindow ? failure!.window_start : t, locked).run();
    return json({ error: attempts >= 5 ? 'Too many attempts. Try again later.' : 'Incorrect administrator PIN.' }, attempts >= 5 ? 429 : 401);
  }
  await env.DB.prepare('DELETE FROM login_failures WHERE ip=?').bind(ip).run();
  const raw = crypto.getRandomValues(new Uint8Array(32)); const token = btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); const tokenHash = await sha256(token); const expires = t + 12 * 3600;
  await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(t).run();
  await env.DB.prepare('INSERT INTO admin_sessions(token_hash,expires_at,created_at,ip) VALUES(?,?,?,?)').bind(tokenHash, expires, t, ip).run();
  await audit(env, request, 'admin.login');
  return json({ ok: true }, 200, { 'set-cookie': `capos_store_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${12*3600}` });
}

async function logout(request: Request, env: Env) {
  const token = cookie(request, 'capos_store_session'); if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': 'capos_store_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
}

function mediaIcon(media: unknown) {
  if (!Array.isArray(media)) return undefined;
  const icon = media.find(item => typeof item === 'object' && item && (item as {type?:string}).type === 'icon') as {url?:string}|undefined;
  return icon?.url;
}

function canonicalApp(result: Record<string, any>) {
  const snap = result.snap || {}; const revision = result.revision || {}; const publisher = snap.publisher || {}; const categories = Array.isArray(snap.categories) ? snap.categories : [];
  const category = categories.find((c:any) => c.name !== 'featured')?.name || 'Utilities';
  return { id: result['snap-id'] || result.name, name: result.name, displayName: snap.title || result.name, publisher: publisher['display-name'] || publisher.username || 'Unknown', summary: snap.summary || '', description: snap.description || snap.summary || '', category: String(category).replace(/(^|-)\w/g,(m:string)=>m.replace('-',' ').toUpperCase()), icon: mediaIcon(snap.media), accent: '#2563eb', source: 'upstream', sourceName: 'Canonical', verified: publisher.validation === 'verified', featured: categories.some((c:any)=>c.featured), version: revision.version || '—', channel: revision.channel || 'stable', architectures: ['amd64','arm64'], webdesktop: 'unknown', updated: 'Upstream' };
}

async function canonicalFind(base: string, query: URLSearchParams, cacheTtl = 120) {
  const params = new URLSearchParams(query); params.set('fields','title,summary,description,publisher,version,media,categories,download,channel,revision');
  const response = await fetch(`${base.replace(/\/$/,'')}/v2/snaps/find?${params}`, { headers: { 'Snap-Device-Series': '16', 'Snap-Device-Architecture': 'amd64', 'User-Agent': 'CapOS-Snap-Store/0.1' }, cf: { cacheTtl, cacheEverything: true } });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  const payload = await response.json<{results?:Record<string,any>[]}>(); return (payload.results || []).map(canonicalApp);
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
  const first = sources.find(s=>s.enabled); if (first?.kind === 'canonical') {
    try {
      [catalog, featured] = await Promise.all([
        canonicalFind(first.apiUrl, new URLSearchParams(), 600),
        canonicalFind(first.apiUrl, new URLSearchParams({category:'featured'}), 300)
      ]);
    } catch { catalog=[]; featured=[]; }
  }
  const featuredNames = new Set(featured.map(app=>app.name));
  const remote = [...featured.map(app=>({...app,featured:true})), ...catalog.map(app=>({...app,featured:featuredNames.has(app.name)}))];
  const seen = new Set(locals.map(a=>a.name));
  const uniqueRemote = remote.filter(app => { if (seen.has(app.name)) return false; seen.add(app.name); return true; });
  const apps=[...locals,...uniqueRemote].slice(0,120);
  const categoryCounts = new Map<string,number>(); for(const app of apps) categoryCounts.set(app.category,(categoryCounts.get(app.category)||0)+1);
  const glyphs=['⌘','◫','▶','◎','▱','✦']; const categories=[...categoryCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,count],i)=>({name,count,glyph:glyphs[i]}));
  return json({version,apps,categories},200,{'cache-control':'public, max-age=60'});
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
  if (!/^[a-z0-9][a-z0-9+.-]{0,62}$/.test(input.name)) return json({ error: 'Invalid Snap package name.' }, 400);
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

async function proxyDownload(request:Request){const u=new URL(request.url);const target=u.searchParams.get('url');if(!target)return json({error:'Missing download URL.'},400);let upstream:URL;try{upstream=new URL(target)}catch{return json({error:'Invalid download URL.'},400)}const allowed=upstream.protocol==='https:'&&(upstream.hostname.endsWith('.snapcraftcontent.com')||upstream.hostname.endsWith('.canonical.com')||upstream.hostname.endsWith('.ubuntu.com'));if(!allowed)return json({error:'Download host is not an allowed upstream.'},403);const headers=new Headers(request.headers);headers.delete('cookie');headers.delete('authorization');const response=await fetch(new Request(upstream,{method:'GET',headers,redirect:'follow'}));const out=new Headers(response.headers);out.set('cache-control','public, max-age=3600');out.delete('set-cookie');return new Response(response.body,{status:response.status,headers:out})}

async function api(request:Request,env:Env,ctx:ExecutionContext){const url=new URL(request.url);const p=url.pathname;
  if(p==='/api/storefront'&&request.method==='GET')return edgeCached(request,env,ctx,120,15,()=>storefront(request,env));
  if(p==='/api/search'&&request.method==='GET')return edgeCached(request,env,ctx,60,10,()=>searchStore(request,env));
  if(p==='/api/admin/auth'&&request.method==='POST')return login(request,env);
  if(p==='/api/admin/logout'&&request.method==='POST')return logout(request,env);
  if(p==='/download/upstream'&&request.method==='GET')return proxyDownload(request);
  if(p.startsWith('/api/admin/')){if(!(await authenticate(request,env)))return json({error:'Authentication required.'},401);if(p==='/api/admin/state'&&request.method==='GET')return adminState(request,env);if(p==='/api/admin/versions'&&request.method==='POST')return postVersion(request,env);if(p==='/api/admin/upstreams'&&request.method==='PUT')return putUpstreams(request,env);if(p==='/api/admin/upstreams'&&request.method==='POST')return postUpstream(request,env);if(p==='/api/admin/packages/uploads'&&request.method==='POST')return startPackageUpload(request,env);if(p==='/api/admin/packages/upload-part'&&request.method==='PUT')return uploadPackagePart(request,env);if(p==='/api/admin/packages/abort'&&request.method==='POST')return abortPackageUpload(request,env);if(p==='/api/admin/packages/finalize'&&request.method==='POST')return finalizePackage(request,env);}
  if(p.startsWith('/v2/')){const version=safeVersion(request.headers.get('X-CapOS-Version'),env);const sources=await upstreams(env,version);const first=sources.find(s=>s.enabled);if(!first)return json({'error-list':[{'code':'no-upstream','message':'No enabled Snap upstream.'}]},503);const target=new URL(first.apiUrl);target.pathname=p;target.search=url.search;const headers=new Headers(request.headers);headers.set('Snap-Device-Series',headers.get('Snap-Device-Series')||'16');headers.set('User-Agent','CapOS-snapd/1');headers.delete('host');const response=await fetch(new Request(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual'}));return response;}
  return json({error:'Not found.'},404);
}

export default {async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{try{const p=new URL(request.url).pathname;if(p.startsWith('/api/')||p.startsWith('/v2/')||p.startsWith('/download/'))return await api(request,env,ctx);return env.ASSETS.fetch(request)}catch(error){console.error(error);return json({error:'Internal store error.'},500)}}};
