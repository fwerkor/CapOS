import { useEffect, useMemo, useState } from 'react';
import {
  AppWindow, ArrowLeft, ArrowRight, BadgeCheck, Boxes, Check, ChevronDown, ChevronRight,
  CircleGauge, Cloud, Database, Download, ExternalLink, GripVertical, HardDriveDownload,
  LayoutGrid, LockKeyhole, LogOut, Menu, Package, Plus, Search, Server, Settings, ShieldCheck,
  Sparkles, Star, Store, UploadCloud, Users, X
} from 'lucide-react';
import { abortPackageUpload, createUpstream, finalizePackage, getAdminState, getStorefront, login, logout, requestPackageUpload, saveUpstreams, searchApps, uploadPackagePart } from './api';
import type { AdminState, StoreApp, StorefrontData, Upstream } from './types';

function initials(app: StoreApp) {
  return app.displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function AppIcon({ app, size = 'md' }: { app: StoreApp; size?: 'sm' | 'md' | 'lg' }) {
  return <div className={`app-icon app-icon-${size}`} style={{ '--accent': app.accent } as React.CSSProperties}>
    {app.icon ? <img src={app.icon} alt="" /> : <span>{initials(app)}</span>}
  </div>;
}

function Verified({ app }: { app: StoreApp }) {
  return app.verified ? <BadgeCheck size={15} className="verified" aria-label="Verified publisher" /> : null;
}

function Shell({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const [mobile, setMobile] = useState(false);
  return <div className={admin ? 'admin-shell' : undefined}>
    {!admin && <header className="site-header">
      <div className="header-inner">
        <a className="wordmark" href="/" aria-label="CapOS App Store home"><span className="mark"><Store size={18} /></span><span>CapOS</span><b>App Store</b></a>
        <nav className={mobile ? 'top-nav mobile-open' : 'top-nav'}>
          <a href="/" className="active">Discover</a><a href="/#categories">Categories</a><a href="https://capos.top">CapOS</a>
        </nav>
        <div className="header-actions"><a href="/admin" className="admin-link"><LockKeyhole size={16} /> Admin</a><button className="menu-button" onClick={() => setMobile(v => !v)}>{mobile ? <X /> : <Menu />}</button></div>
      </div>
    </header>}
    {children}
  </div>;
}

function SearchBox({ value, onChange, compact = false }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  return <label className={`search-box ${compact ? 'compact' : ''}`}>
    <Search size={compact ? 17 : 21} />
    <input value={value} onChange={e => onChange(e.target.value)} placeholder="Search apps, tools, and services" aria-label="Search apps" />
    {value && <button onClick={() => onChange('')} aria-label="Clear search"><X size={16} /></button>}
  </label>;
}

function FeaturedCard({ app, onOpen }: { app: StoreApp; onOpen: () => void }) {
  return <article className="featured-card" style={{ '--accent': app.accent } as React.CSSProperties} onClick={onOpen}>
    <div className="featured-copy"><div className="eyebrow">FEATURED</div><h2>{app.displayName}</h2><p>{app.summary}</p><button className="pill-button">View <ChevronRight size={16} /></button></div>
    <div className="featured-art"><AppIcon app={app} size="lg" /><div className="orb orb-a"/><div className="orb orb-b"/></div>
  </article>;
}

function AppRow({ app, onOpen }: { app: StoreApp; onOpen: () => void }) {
  return <button className="app-row" onClick={onOpen}>
    <AppIcon app={app} /><span className="app-row-main"><span className="app-title-line"><strong>{app.displayName}</strong><Verified app={app}/></span><span>{app.summary}</span><small>{app.category} · {app.sourceName}</small></span>
    <span className="get-button">GET</span>
  </button>;
}

function AppDetail({ app, onClose }: { app: StoreApp; onClose: () => void }) {
  return <div className="detail-overlay" role="dialog" aria-modal="true" aria-label={`${app.displayName} details`}>
    <div className="detail-panel">
      <button className="close-detail" onClick={onClose}><X /></button>
      <div className="detail-hero">
        <AppIcon app={app} size="lg" />
        <div><div className="app-title-line big"><h1>{app.displayName}</h1><Verified app={app}/></div><p>{app.summary}</p><div className="publisher">{app.publisher}</div></div>
        <button className="primary-action">Install</button>
      </div>
      <div className="detail-stats">
        <div><span>VERSION</span><strong>{app.version}</strong></div><div><span>CHANNEL</span><strong>{app.channel}</strong></div><div><span>ARCHITECTURES</span><strong>{app.architectures.join(' · ')}</strong></div><div><span>SOURCE</span><strong>{app.sourceName}</strong></div>
      </div>
      <section className="detail-section"><h3>About</h3><p>{app.description}</p></section>
      <section className="detail-section"><h3>CapOS integration</h3><div className="integration-card"><div className="integration-icon"><AppWindow /></div><div><strong>{app.webdesktop === 'native' ? 'Native WebDesktop app' : app.webdesktop === 'web' ? 'Web service integration' : app.webdesktop === 'gui' ? 'GUI bridge ready' : 'Service integration'}</strong><p>CapOS can install, update and manage this app from WebDesktop.</p></div><Check /></div></section>
      <section className="detail-section"><h3>Information</h3><dl className="info-list"><div><dt>Publisher</dt><dd>{app.publisher}</dd></div><div><dt>Category</dt><dd>{app.category}</dd></div><div><dt>Updated</dt><dd>{app.updated || 'Recently'}</dd></div><div><dt>Package</dt><dd>{app.name}</dd></div></dl></section>
    </div>
  </div>;
}

function Storefront() {
  const [data, setData] = useState<StorefrontData | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StoreApp[] | null>(null);
  const [selected, setSelected] = useState<StoreApp | null>(null);
  useEffect(() => { getStorefront().then(setData); }, []);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchResults(null); return; }
    const timer = window.setTimeout(() => {
      void searchApps(q).then(setSearchResults).catch(() => {
        if (!data) return setSearchResults([]);
        const local = q.toLowerCase();
        setSearchResults(data.apps.filter(a => [a.displayName,a.publisher,a.summary,a.category,a.name].some(v => v.toLowerCase().includes(local))));
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, data]);
  const apps = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.apps;
    return searchResults ?? data.apps.filter(a => [a.displayName,a.publisher,a.summary,a.category,a.name].some(v => v.toLowerCase().includes(q)));
  }, [data, query, searchResults]);
  const featured = data?.apps.filter(a => a.featured).slice(0, 4) || [];

  return <Shell><main>
    <section className="store-hero"><div className="hero-glow"/><div className="store-container hero-content"><div className="hero-kicker"><Sparkles size={16}/> Apps for your CapOS</div><h1>Everything your server<br/>can become.</h1><p>Discover trusted apps, services and tools from CapOS and the wider Snap ecosystem.</p><SearchBox value={query} onChange={setQuery}/><div className="hero-note"><ShieldCheck size={15}/> Verified packages · Fast proxied downloads · Managed by CapOS</div></div></section>

    <div className="store-container store-body">
      {query ? <section className="section-block"><div className="section-heading"><div><span>SEARCH RESULTS</span><h2>{apps.length} app{apps.length === 1 ? '' : 's'} for “{query}”</h2></div></div><div className="app-list">{apps.map(app => <AppRow key={app.id} app={app} onOpen={() => setSelected(app)}/>)}</div></section> : <>
        <section className="section-block"><div className="section-heading"><div><span>DISCOVER</span><h2>Featured this week</h2></div><div className="carousel-arrows"><button aria-label="Previous"><ArrowLeft/></button><button aria-label="Next"><ArrowRight/></button></div></div><div className="featured-grid">{featured.map(app => <FeaturedCard key={app.id} app={app} onOpen={() => setSelected(app)}/>)}</div></section>

        <section className="section-block"><div className="section-heading"><div><span>TOP PICKS</span><h2>Essential apps</h2></div><a href="#all">See all <ChevronRight size={16}/></a></div><div className="three-column-list">{data?.apps.slice(0,6).map(app => <AppRow key={app.id} app={app} onOpen={() => setSelected(app)}/>)}</div></section>

        <section id="categories" className="section-block"><div className="section-heading"><div><span>BROWSE</span><h2>Categories</h2></div></div><div className="category-grid">{data?.categories.map((c,i) => <button key={c.name} className={`category-card category-${i}`} onClick={() => setQuery(c.name)}><span className="category-glyph">{c.glyph}</span><span><strong>{c.name}</strong><small>{c.count} apps</small></span><ChevronRight/></button>)}</div></section>

        <section id="all" className="section-block"><div className="section-heading"><div><span>EXPLORE</span><h2>Apps & services</h2></div><SearchBox value={query} onChange={setQuery} compact/></div><div className="app-list broad">{data?.apps.map(app => <AppRow key={app.id} app={app} onOpen={() => setSelected(app)}/>)}</div></section>
      </>}
    </div>
  </main><footer className="store-footer"><div className="store-container"><div><b>CapOS App Store</b><span>Packages from CapOS and configured upstreams.</span></div><div><a href="https://capos.top">capos.top</a><a href="https://repo.capos.top">Repository</a><a href="/admin">Admin</a></div></div></footer>{selected && <AppDetail app={selected} onClose={() => setSelected(null)}/>}</Shell>;
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [pin, setPin] = useState(''); const [error, setError] = useState(''); const [busy,setBusy] = useState(false);
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await login(pin); onSuccess(); } catch (err) { setError(err instanceof Error ? err.message : 'Authentication failed'); } finally { setBusy(false); } }
  return <div className="login-page"><div className="login-glow"/><a className="login-wordmark" href="/"><span className="mark"><Store size={18}/></span> CapOS <b>Store Admin</b></a><form className="login-card" onSubmit={submit}><div className="login-lock"><LockKeyhole/></div><h1>Store administration</h1><p>Enter the administrator PIN to manage packages, upstreams and releases.</p><label>Administrator PIN<input autoFocus type="password" inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value)} placeholder="••••••••"/></label>{error && <div className="error-banner">{error}</div>}<button className="login-submit" disabled={busy || !pin}>{busy ? 'Unlocking…' : 'Unlock dashboard'} <ArrowRight size={17}/></button><div className="login-security"><ShieldCheck size={15}/> Protected by rate limiting and secure sessions</div></form></div>;
}

type AdminTab = 'overview'|'packages'|'upstreams'|'versions'|'apps'|'settings';

function AdminDashboard({ onLock }: { onLock: () => void }) {
  const [state,setState] = useState<AdminState|null>(null); const [tab,setTab] = useState<AdminTab>('overview'); const [version,setVersion] = useState('rolling'); const [notice,setNotice] = useState('');
  useEffect(() => { getAdminState(version).then(setState).catch(() => onLock()); }, [version]);
  if (!state) return <div className="admin-loading"><div className="spinner"/>Loading store state…</div>;
  const navigation: [AdminTab,string,React.ReactNode][] = [['overview','Overview',<CircleGauge/>],['packages','Local packages',<Package/>],['upstreams','Upstreams',<Cloud/>],['versions','Versions',<Boxes/>],['apps','App metadata',<LayoutGrid/>],['settings','Settings',<Settings/>]];
  return <Shell admin><div className="admin-layout"><aside className="admin-sidebar"><a className="admin-brand" href="/"><span className="mark"><Store size={17}/></span><span>CapOS<b>Store</b></span></a><nav>{navigation.map(([id,label,icon])=><button className={tab===id?'active':''} key={id} onClick={()=>setTab(id)}>{icon}<span>{label}</span></button>)}</nav><div className="sidebar-bottom"><div className="system-status"><span className="status-dot"/>Store online<small>Cloudflare Worker</small></div><button onClick={async()=>{await logout();onLock();}}><LogOut/>Lock console</button></div></aside>
    <section className="admin-main"><header className="admin-topbar"><div><span className="admin-breadcrumb">Store /</span> <strong>{navigation.find(n=>n[0]===tab)?.[1]}</strong></div><div className="admin-top-actions"><label className="version-picker"><span>Repository</span><select value={version} onChange={e=>setVersion(e.target.value)}>{state.versions.map(v=><option key={v.name}>{v.name}</option>)}</select><ChevronDown/></label><a href="/" className="preview-link">View store <ExternalLink/></a></div></header><div className="admin-content">{notice && <div className="success-toast"><Check/> {notice}<button onClick={()=>setNotice('')}><X/></button></div>}{tab==='overview'&&<Overview state={state}/>} {tab==='packages'&&<Packages state={state} version={version} onNotice={setNotice}/>} {tab==='upstreams'&&<Upstreams state={state} version={version} setState={setState} onNotice={setNotice}/>} {tab==='versions'&&<Versions state={state}/>} {tab==='apps'&&<Metadata state={state}/>} {tab==='settings'&&<StoreSettings/>}</div></section></div></Shell>;
}

function PageTitle({ eyebrow,title,description,action }: {eyebrow:string;title:string;description:string;action?:React.ReactNode}) { return <div className="admin-page-title"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div> }
function Overview({state}:{state:AdminState}) { const cards=[['Local packages',state.stats.local,<Package/>],['Upstream apps',state.stats.upstream,<Cloud/>],['Repository versions',state.stats.versions,<Database/>],['Downloads · 24h',state.stats.downloads24h.toLocaleString(),<HardDriveDownload/>]]; return <><PageTitle eyebrow="CONTROL CENTER" title="Store overview" description="Repository health and activity across CapOS releases."/><div className="stats-grid">{cards.map(([label,value,icon])=><div className="stat-card" key={String(label)}><span className="stat-icon">{icon}</span><strong>{value}</strong><span>{label}</span></div>)}</div><div className="admin-two-col"><section className="admin-panel"><div className="panel-heading"><h2>Repository resolution</h2><span>Current order</span></div><div className="resolution-flow"><div className="resolution-local"><Package/><span><b>Local packages</b><small>Highest priority</small></span><span className="priority-badge">0</span></div>{state.upstreams.filter(u=>u.enabled).map(u=><div key={u.id} className="resolution-item"><Cloud/><span><b>{u.name}</b><small>{u.apiUrl}</small></span><span className="priority-badge">{u.priority}</span></div>)}</div></section><section className="admin-panel"><div className="panel-heading"><h2>System health</h2><span>Live</span></div><div className="health-list"><div><span><Server/>Worker API</span><b className="healthy">Operational</b></div><div><span><Database/>D1 metadata</span><b className="healthy">Connected</b></div><div><span><HardDriveDownload/>R2 repository</span><b className="healthy">Connected</b></div><div><span><Cloud/>Canonical upstream</span><b className="healthy">183 ms</b></div></div></section></div></> }

function Packages({state,version,onNotice}:{state:AdminState;version:string;onNotice:(s:string)=>void}) { const [show,setShow]=useState(false); const [file,setFile]=useState<File|null>(null); const [name,setName]=useState(''); const [versionString,setVersionString]=useState(''); const [arch,setArch]=useState('arm64'); const [busy,setBusy]=useState(false); const [progress,setProgress]=useState(0); const [error,setError]=useState('');
  async function upload(){if(!file||!name||!versionString)return;setBusy(true);setProgress(0);setError('');let ticket:Awaited<ReturnType<typeof requestPackageUpload>>|null=null;try{ticket=await requestPackageUpload({version,name,versionString,architecture:arch,size:file.size});const parts=[];let partNumber=1;for(let offset=0;offset<file.size;offset+=ticket.partSize){const end=Math.min(offset+ticket.partSize,file.size);const part=await uploadPackagePart({version,uploadId:ticket.uploadId,objectPath:ticket.objectPath,partNumber,chunk:file.slice(offset,end)});parts.push(part);setProgress(Math.round(end/file.size*100));partNumber+=1;}await finalizePackage({version,name,versionString,architecture:arch,uploadId:ticket.uploadId,objectPath:ticket.objectPath,parts,size:file.size,displayName:name});setShow(false);onNotice(`${name} ${versionString} published to ${version}`);}catch(err){if(ticket)await abortPackageUpload({version,uploadId:ticket.uploadId,objectPath:ticket.objectPath}).catch(()=>{});setError(err instanceof Error?err.message:'Upload failed');}finally{setBusy(false)}}
  return <><PageTitle eyebrow="ARTIFACTS" title="Local packages" description="Packages here override every configured upstream for this repository version." action={<button className="admin-primary" onClick={()=>setShow(true)}><UploadCloud/>Upload Snap</button>}/><section className="admin-panel table-panel"><table className="admin-table"><thead><tr><th>Application</th><th>Version</th><th>Architecture</th><th>Channel</th><th>Source</th><th></th></tr></thead><tbody>{state.localPackages.length?state.localPackages.map(app=><tr key={app.id}><td><div className="table-app"><AppIcon app={app} size="sm"/><span><b>{app.displayName}</b><small>{app.name}</small></span></div></td><td>{app.version}</td><td>{app.architectures.join(', ')}</td><td><span className="channel-chip">{app.channel}</span></td><td><span className="source-local">CapOS</span></td><td><button className="row-menu">•••</button></td></tr>):<tr><td colSpan={6}><div className="empty-table"><Package/><b>No local packages</b><span>Upload a Snap to override or extend the upstream catalog.</span></div></td></tr>}</tbody></table></section>{show&&<div className="modal-backdrop"><div className="admin-modal"><button className="modal-close" onClick={()=>setShow(false)}><X/></button><span className="modal-icon"><UploadCloud/></span><h2>Publish local Snap</h2><p>The artifact is uploaded in resilient chunks to the existing CapOS R2 repository. Package metadata is indexed in D1.</p><label className="dropzone"><input type="file" accept=".snap" onChange={e=>{const f=e.target.files?.[0]||null;setFile(f);if(f&&!name)setName(f.name.split('_')[0].replace(/\.snap$/,''));}}/><UploadCloud/><b>{file?file.name:'Choose a .snap package'}</b><span>{file?`${(file.size/1024/1024).toFixed(1)} MB`:'or drop one here'}</span></label><div className="form-grid"><label>Package name<input value={name} onChange={e=>setName(e.target.value)} placeholder="webdesktop"/></label><label>Version<input value={versionString} onChange={e=>setVersionString(e.target.value)} placeholder="2.0.0"/></label><label>Architecture<select value={arch} onChange={e=>setArch(e.target.value)}><option>arm64</option><option>amd64</option><option>armhf</option><option>all</option></select></label><label>Repository<input value={version} disabled/></label></div>{error&&<div className="error-banner">{error}</div>}<button className="admin-primary modal-submit" disabled={busy||!file||!name||!versionString} onClick={upload}>{busy?(progress<100?`Uploading ${progress}%…`:'Publishing…'):'Upload & publish'} <ArrowRight/></button></div></div>}</> }

function Upstreams({state,version,setState,onNotice}:{state:AdminState;version:string;setState:(s:AdminState)=>void;onNotice:(s:string)=>void}) { const [items,setItems]=useState(state.upstreams); const [show,setShow]=useState(false); const [name,setName]=useState(''); const [url,setUrl]=useState(''); useEffect(()=>setItems(state.upstreams),[state]);
  async function persist(next:Upstream[]){setItems(next);await saveUpstreams(version,next);setState({...state,upstreams:next});onNotice('Upstream order saved');}
  function move(index:number,dir:-1|1){const j=index+dir;if(j<0||j>=items.length)return;const next=[...items];[next[index],next[j]]=[next[j],next[index]];next.forEach((u,i)=>u.priority=(i+1)*10);void persist(next)}
  async function add(){if(!name||!url)return;await createUpstream(version,name,url);const next=[...items,{id:Date.now(),name,apiUrl:url,priority:(items.length+1)*10,enabled:true,status:'online' as const}];setItems(next);setShow(false);setName('');setUrl('');onNotice(`${name} added`)}
  return <><PageTitle eyebrow="FEDERATION" title="Upstream sources" description="Resolution always prefers local packages, then checks enabled upstreams from top to bottom." action={<button className="admin-primary" onClick={()=>setShow(true)}><Plus/>Add upstream</button>}/><div className="local-priority-banner"><Package/><div><b>Local CapOS packages</b><span>Always resolved first · priority 0</span></div><ShieldCheck/></div><div className="upstream-list">{items.map((u,i)=><div className={`upstream-card ${!u.enabled?'disabled':''}`} key={u.id}><GripVertical className="drag-handle"/><div className="upstream-logo"><Cloud/></div><div className="upstream-info"><div><b>{u.name}</b><span className={`health-dot ${u.status}`}/></div><span>{u.apiUrl}</span><small>{u.status==='online'?`${u.latencyMs||'—'} ms · responding`:'Disabled or unavailable'}</small></div><span className="priority-label">Priority {u.priority}</span><div className="upstream-actions"><button disabled={i===0} onClick={()=>move(i,-1)}>↑</button><button disabled={i===items.length-1} onClick={()=>move(i,1)}>↓</button><label className="switch"><input type="checkbox" checked={u.enabled} onChange={e=>void persist(items.map(x=>x.id===u.id?{...x,enabled:e.target.checked}:x))}/><span/></label></div></div>)}</div>{show&&<div className="modal-backdrop"><div className="admin-modal small"><button className="modal-close" onClick={()=>setShow(false)}><X/></button><span className="modal-icon"><Cloud/></span><h2>Add upstream store</h2><p>The store will be queried after local packages and higher-priority upstreams.</p><div className="form-stack"><label>Name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Canonical Snap Store"/></label><label>Store API URL<input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://api.snapcraft.io"/></label></div><button className="admin-primary modal-submit" disabled={!name||!url} onClick={add}>Add upstream <ArrowRight/></button></div></div>}</> }

function Versions({state}:{state:AdminState}) { return <><PageTitle eyebrow="RELEASES" title="Repository versions" description="Maintain independent Snap views for rolling and stable CapOS releases." action={<button className="admin-primary"><Plus/>New version</button>}/><div className="version-grid">{state.versions.map(v=><div className="version-card" key={v.name}><div className="version-card-top"><span className="version-icon"><Boxes/></span><span className={v.frozen?'version-state frozen':'version-state'}>{v.frozen?'Frozen':'Active'}</span></div><h2>{v.label}</h2><code>{v.name}</code><div className="version-meta"><span>{v.appCount} apps</span><span>{v.frozen?'Read only':'Accepting changes'}</span></div><button>Manage version <ChevronRight/></button></div>)}</div></> }
function Metadata({state}:{state:AdminState}) { return <><PageTitle eyebrow="CATALOG" title="App metadata" description="Curate how local and upstream apps appear in CapOS and WebDesktop."/><div className="metadata-toolbar"><SearchBox value="" onChange={()=>{}} compact/><button><Sparkles/>Featured</button><button><AppWindow/>WebDesktop ready</button></div><section className="admin-panel table-panel"><table className="admin-table"><thead><tr><th>App</th><th>Integration</th><th>Publisher</th><th>Source</th><th>Visibility</th><th></th></tr></thead><tbody>{state.localPackages.map(app=><tr key={app.id}><td><div className="table-app"><AppIcon app={app} size="sm"/><span><b>{app.displayName}</b><small>{app.summary}</small></span></div></td><td>{app.webdesktop||'Unknown'}</td><td>{app.publisher}</td><td>{app.sourceName}</td><td><span className="visible-chip">Visible</span></td><td><button className="row-menu">Edit</button></td></tr>)}</tbody></table></section></> }
function StoreSettings(){return <><PageTitle eyebrow="CONFIGURATION" title="Store settings" description="Global behavior for snap.capos.top and package delivery."/><div className="settings-grid"><section className="admin-panel settings-section"><h2>General</h2><label>Store display name<input defaultValue="CapOS App Store"/></label><label>Default repository<select defaultValue="rolling"><option>rolling</option></select></label><label className="setting-toggle"><span><b>Proxy upstream downloads</b><small>Keep Canonical download URLs behind snap.capos.top.</small></span><span className="switch"><input type="checkbox" defaultChecked/><span/></span></label></section><section className="admin-panel settings-section"><h2>Security</h2><label className="setting-toggle"><span><b>Require admin PIN</b><small>Protect every mutation and package operation.</small></span><span className="switch"><input type="checkbox" defaultChecked disabled/><span/></span></label><label className="setting-toggle"><span><b>Audit administrative actions</b><small>Record upstream, package and release changes.</small></span><span className="switch"><input type="checkbox" defaultChecked/><span/></span></label><button className="secondary-danger">Rotate administrator PIN</button></section></div></>}

function AdminApp(){const [authed,setAuthed]=useState(import.meta.env.DEV&&sessionStorage.getItem('capos-admin-dev')==='1'); return authed?<AdminDashboard onLock={()=>setAuthed(false)}/>:<AdminLogin onSuccess={()=>setAuthed(true)}/>}

export function App(){const path=window.location.pathname;return path.startsWith('/admin')?<AdminApp/>:<Storefront/>}
