import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AppWindow, ArrowLeft, ArrowRight, BadgeCheck, BookOpen, Boxes, Bug, Check, ChevronDown, ChevronRight,
  CircleDollarSign, CircleGauge, Cloud, Database, Download, ExternalLink, FileCode2, Globe2, GripVertical,
  HardDriveDownload, LayoutGrid, Link2, LockKeyhole, LogOut, Mail, Menu, MessageCircle, Package, Play, Plus,
  Search, Server, Settings, ShieldCheck, Sparkles, Star, Store, UploadCloud, Users, X
} from 'lucide-react';
import { abortPackageUpload, createUpstream, createVersion, finalizePackage, getAdminState, getAppDetails, getCatalog, getStorefront, requestPackageUpload, saveUpstreams, searchApps, uploadPackagePart } from './api';
import { snapInstallCommand } from './install';
import type { AdminState, StoreApp, StorefrontData, Upstream } from './types';
import { useWebDesktopBridge } from './webdesktop';

function initials(app: StoreApp) {
  return app.displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function AppIcon({ app, size = 'md' }: { app: StoreApp; size?: 'sm' | 'md' | 'lg' }) {
  return <div className={`app-icon app-icon-${size}${app.icon ? ' app-icon-image' : ''}`} style={{ '--accent': app.accent } as React.CSSProperties}>
    {app.icon ? <img src={app.icon} alt="" /> : <span>{initials(app)}</span>}
  </div>;
}

function Verified({ app }: { app: StoreApp }) {
  return app.verified ? <BadgeCheck size={15} className="verified" aria-label="Verified publisher" /> : null;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the DOM copy path for browsers that deny Clipboard API access.
    }
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  return copied;
}

type AppAction = {
  kind: 'get' | 'install' | 'open' | 'installing';
  progress?: number;
  disabled?: boolean;
  label?: string;
  title?: string;
};

function InstallProgress({ progress, large = false }: { progress: number; large?: boolean }) {
  return <span
    className={`install-progress${large ? ' large' : ''}`}
    style={{ '--install-progress': `${Math.max(0, Math.min(100, progress))}%` } as React.CSSProperties}
    role="progressbar"
    aria-label={`Installing ${progress}%`}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={progress}
  ><span>{progress}</span></span>;
}

function AppActionButton({ action, onAction, detail = false }: { action: AppAction; onAction: () => void; detail?: boolean }) {
  if (action.kind === 'installing') return <InstallProgress progress={action.progress || 0} large={detail}/>;
  const label = action.label || (action.kind === 'open' ? 'OPEN' : action.kind === 'install' ? 'Install' : 'GET');
  return <button
    type="button"
    className={detail ? 'primary-action' : 'get-button'}
    disabled={action.disabled}
    title={action.title}
    onClick={event => { event.stopPropagation(); onAction(); }}
  >{label}</button>;
}

function Shell({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const [mobile, setMobile] = useState(false);
  const embedded = !admin && window.location.pathname.startsWith('/embed');
  const home = embedded ? '/embed' : '/';
  return <div className={admin ? 'admin-shell' : undefined}>
    {!admin && <header className="site-header">
      <div className="header-inner">
        <a className="wordmark" href={home} aria-label="CapOS App Store home"><span className="mark"><Store size={18} /></span><span>CapOS</span><b>App Store</b></a>
        <nav className={mobile ? 'top-nav mobile-open' : 'top-nav'}>
          <a href={home} className="active">Discover</a><a href={`${home}#categories`}>Categories</a><a href="https://capos.top">CapOS</a>
        </nav>
        <div className="header-actions"><a href="/admin" target={embedded ? '_blank' : undefined} className="admin-link"><LockKeyhole size={16} /> Admin</a><button className="menu-button" onClick={() => setMobile(v => !v)}>{mobile ? <X /> : <Menu />}</button></div>
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

function AppRow({ app, onOpen, action, onAction }: { app: StoreApp; onOpen: () => void; action: AppAction; onAction: () => void }) {
  return <div className="app-row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onOpen();
  }}>
    <AppIcon app={app} /><span className="app-row-main"><span className="app-title-line"><strong>{app.displayName}</strong><Verified app={app}/></span><span>{app.summary}</span><small>{app.category} · {app.sourceName}</small></span>
    <AppActionButton action={action} onAction={onAction}/>
  </div>;
}

function videoEmbedUrl(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

function formatReleasedAt(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function linkDestination(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'mailto:') return decodeURIComponent(url.pathname);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

function PublisherLinkIcon({ label }: { label: string }) {
  switch (label.trim().toLowerCase()) {
    case 'website': return <Globe2 />;
    case 'contact': return <Mail />;
    case 'documentation': return <BookOpen />;
    case 'report a bug': return <Bug />;
    case 'source code': return <FileCode2 />;
    case 'donate': return <CircleDollarSign />;
    case 'video': return <Play />;
    case 'community': return <Users />;
    case 'chat': return <MessageCircle />;
    default: return <Link2 />;
  }
}

function MediaGallery({ app }: { app: StoreApp }) {
  const items = [
    ...(app.videos || []).map(url => ({ kind: 'video' as const, url })),
    ...(app.screenshots || []).map(url => ({ kind: 'image' as const, url })),
  ];
  const [active, setActive] = useState(0);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  useEffect(() => { if (active >= items.length) setActive(0); }, [active, items.length]);
  if (!items.length) return null;
  const current = items[active] || items[0];
  const embed = current.kind === 'video' ? videoEmbedUrl(current.url) : null;
  return <section className="detail-section media-section">
    <div className="detail-section-heading"><h3>Preview</h3><span>{items.length} {items.length === 1 ? 'item' : 'items'}</span></div>
    <div className="media-stage">
      {current.kind === 'image' ? <button type="button" className="media-image-button" onClick={() => setExpandedImage(current.url)} aria-label="Enlarge screenshot"><img src={current.url} alt={`${app.displayName} screenshot ${active + 1}`} /></button> : embed ? <iframe src={embed} title={`${app.displayName} video`} referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen /> : <a className="video-link-preview" href={current.url} target="_blank" rel="noreferrer"><span><Play /></span><strong>Watch app video</strong><small>Open the publisher's video <ExternalLink /></small></a>}
    </div>
    {items.length > 1 && <div className="media-strip">{items.map((item, index) => <button key={`${item.kind}:${item.url}`} type="button" className={index === active ? 'active' : ''} onClick={() => setActive(index)} aria-label={`Show ${item.kind} ${index + 1}`}>{item.kind === 'image' ? <img src={item.url} alt="" loading="lazy" /> : <span className="video-thumb"><Play /></span>}</button>)}</div>}
    {expandedImage && createPortal(<div className="media-lightbox" role="dialog" aria-modal="true" aria-label={`${app.displayName} screenshot`} onClick={() => setExpandedImage(null)}><button type="button" className="media-lightbox-close" onClick={() => setExpandedImage(null)} aria-label="Close enlarged screenshot"><X /></button><img src={expandedImage} alt={`${app.displayName} screenshot enlarged`} onClick={event => event.stopPropagation()} /></div>, document.body)}
  </section>;
}

function AppDetail({ app, loading, onClose, action, onAction }: { app: StoreApp; loading: boolean; onClose: () => void; action: AppAction; onAction: () => void }) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);
  const releasedAt = formatReleasedAt(app.releasedAt);
  const links = app.links || [];
  return <div className="detail-overlay" role="dialog" aria-modal="true" aria-label={`${app.displayName} details`} onClick={onClose}>
    <div className="detail-panel" onClick={event => event.stopPropagation()}>
      <button className="close-detail" onClick={onClose} aria-label="Close app details"><X /></button>
      {app.banner && <div className="detail-banner"><img src={app.banner} alt="" /><span /></div>}
      <div className={`detail-hero${app.banner ? ' with-banner' : ''}`}>
        <AppIcon app={app} size="lg" />
        <div className="detail-identity"><div className="app-title-line big"><h1>{app.displayName}</h1><Verified app={app}/></div><p>{app.summary}</p><div className="publisher">{app.publisher}{app.publisherUsername && app.publisherUsername !== app.publisher ? <span>@{app.publisherUsername}</span> : null}</div></div>
        <AppActionButton action={action} onAction={onAction} detail/>
      </div>
      <div className="detail-stats">
        <div><span>VERSION</span><strong>{app.version}</strong></div><div><span>CHANNEL</span><strong>{app.channel}</strong></div><div><span>ARCHITECTURES</span><strong>{app.architectures.join(' · ') || '—'}</strong></div><div><span>SOURCE</span><strong>{app.sourceName}</strong></div>
      </div>
      <MediaGallery app={app} />
      <section className="detail-section"><h3>About</h3>{loading ? <div className="detail-about-loading"><div className="spinner"/>Loading details…</div> : <div className="detail-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{app.description || app.summary}</ReactMarkdown></div>}</section>
      {(links.length > 0 || app.storeUrl) && <section className="detail-section"><div className="detail-section-heading"><h3>Links</h3><span>From publisher</span></div><div className="app-link-grid">{links.map(link => <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noreferrer"><span className="app-link-icon"><PublisherLinkIcon label={link.label} /></span><span><strong>{link.label}</strong><small>{linkDestination(link.url)}</small></span><ExternalLink /></a>)}{app.storeUrl && <a href={app.storeUrl} target="_blank" rel="noreferrer"><span className="app-link-icon"><Store /></span><span><strong>Snap Store</strong><small>Official listing</small></span><ExternalLink /></a>}</div></section>}
      <section className="detail-section"><h3>CapOS integration</h3><div className="integration-card"><div className="integration-icon"><AppWindow /></div><div><strong>{app.webdesktop === 'native' ? 'Native WebDesktop app' : app.webdesktop === 'web' ? 'Web service integration' : app.webdesktop === 'gui' ? 'GUI bridge ready' : app.webdesktop === 'service' ? 'Service integration' : 'Snap managed by CapOS'}</strong><p>CapOS can install, update and manage this app from WebDesktop.</p></div><Check /></div></section>
      <section className="detail-section"><h3>Information</h3><dl className="info-list"><div><dt>Publisher</dt><dd>{app.publisher}</dd></div>{app.license && <div><dt>License</dt><dd>{app.license}</dd></div>}{app.confinement && <div><dt>Confinement</dt><dd className="info-capitalize">{app.confinement}</dd></div>}<div><dt>Category</dt><dd>{app.category}</dd></div><div><dt>Updated</dt><dd>{releasedAt || app.updated || 'Recently'}</dd></div><div><dt>Package</dt><dd><code>{app.name}</code></dd></div></dl></section>
    </div>
  </div>;
}

function Storefront() {
  const webdesktop = useWebDesktopBridge();
  const [data, setData] = useState<StorefrontData | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StoreApp[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selected, setSelected] = useState<StoreApp | null>(null);
  const [detailLoadingName, setDetailLoadingName] = useState<string | null>(null);
  const [featuredPage, setFeaturedPage] = useState(0);
  const [visibleCatalogCount, setVisibleCatalogCount] = useState(36);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [copiedInstall, setCopiedInstall] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempts = 0;
    void getStorefront().then(result => { if (!cancelled) setData(current => !current || result.apps.length > current.apps.length ? result : current); });
    const loadCatalog = async () => {
      attempts += 1;
      try {
        const result = await getCatalog();
        if (cancelled) return;
        setData(current => !current || result.apps.length >= current.apps.length ? result : current);
        if (result.apps.length > 120) setCatalogLoading(false);
        if (result.refreshing && attempts < 8) retryTimer = window.setTimeout(() => void loadCatalog(), 5000);
        else setCatalogLoading(false);
      } catch {
        if (!cancelled) setCatalogLoading(false);
      }
    };
    void loadCatalog();
    return () => { cancelled = true; if (retryTimer) window.clearTimeout(retryTimer); };
  }, []);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchResults(null); setSearchLoading(false); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchApps(q).then(results => {
        if (cancelled) return;
        setSearchResults(results);
        setSearchLoading(false);
      }).catch(() => {
        if (cancelled) return;
        if (!data) { setSearchResults([]); setSearchLoading(false); return; }
        const local = q.toLowerCase();
        setSearchResults(data.apps.filter(a => [a.displayName,a.publisher,a.summary,a.category,a.name].some(v => v.toLowerCase().includes(local))));
        setSearchLoading(false);
      });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, data]);
  const updateQuery = (value: string) => {
    setQuery(value);
    setSearchResults(null);
    setSearchLoading(Boolean(value.trim()));
  };
  const openApp = (app: StoreApp) => {
    setSelected(app);
    setDetailLoadingName(app.name);
    void getAppDetails(app.name).then(detail => {
      setSelected(current => current?.name === app.name ? { ...current, ...detail, version: current.version, channel: current.channel, architectures: current.architectures } : current);
    }).catch(() => {}).finally(() => {
      setDetailLoadingName(current => current === app.name ? null : current);
    });
  };
  const closeDetail = () => { setSelected(null); setDetailLoadingName(null); };
  const actionFor = (app: StoreApp, detail = false): AppAction => {
    if (!webdesktop.connected) {
      const installCommand = snapInstallCommand(app);
      return detail
        ? { kind: 'install', label: copiedInstall === app.name ? 'Copied' : 'Install', title: `Copy: ${installCommand}` }
        : { kind: 'get' };
    }
    if (webdesktop.installed.has(app.name)) return { kind: 'open' };
    if (Object.prototype.hasOwnProperty.call(webdesktop.installing, app.name)) {
      return { kind: 'installing', progress: webdesktop.installing[app.name] };
    }
    return {
      kind: detail ? 'install' : 'get',
      disabled: !webdesktop.canInstall,
      title: webdesktop.canInstall ? `Install ${app.name} on this CapOS system` : 'Administrator access is required to install snaps',
    };
  };
  const performAction = async (app: StoreApp, detail = false) => {
    if (webdesktop.connected) {
      if (webdesktop.installed.has(app.name)) webdesktop.open(app.name);
      else if (webdesktop.canInstall && !Object.prototype.hasOwnProperty.call(webdesktop.installing, app.name)) webdesktop.install(app.name, app.channel || 'stable', app.confinement);
      return;
    }
    if (!detail) {
      openApp(app);
      return;
    }
    try {
      if (!await copyText(snapInstallCommand(app))) return;
      setCopiedInstall(app.name);
      window.setTimeout(() => setCopiedInstall(current => current === app.name ? null : current), 1600);
    } catch {
      setCopiedInstall(null);
    }
  };
  const apps = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.apps;
    return searchResults ?? [];
  }, [data, query, searchResults]);
  const featuredApps = data?.apps.filter(a => a.featured) || [];
  const featuredPageCount = Math.max(1, Math.ceil(featuredApps.length / 4));
  const featured = featuredApps.slice(featuredPage * 4, featuredPage * 4 + 4);
  const essential = data?.apps.filter(a => !a.featured).slice(0, 8) || [];
  const categoryShelves = (data?.categories || []).slice(0, 3).map(category => ({ category, apps: data?.apps.filter(app => app.category === category.name).slice(0, 4) || [] })).filter(shelf => shelf.apps.length > 0);
  const visibleCatalog = data?.apps.slice(0, visibleCatalogCount) || [];
  const catalogRemaining = Math.max(0, (data?.apps.length || 0) - visibleCatalogCount);
  useEffect(() => { if (featuredPage >= featuredPageCount) setFeaturedPage(0); }, [featuredPage, featuredPageCount]);

  return <Shell><main>
    <section className="store-hero"><div className="hero-glow"/><div className="store-container hero-content"><div className="hero-kicker"><Sparkles size={16}/> Apps for your CapOS</div><h1>Everything your server<br/>can become.</h1><p>Discover trusted apps, services and tools from CapOS and the wider Snap ecosystem.</p><SearchBox value={query} onChange={updateQuery}/><div className="hero-note"><ShieldCheck size={15}/> Verified packages · Fast proxied downloads · Managed by CapOS</div></div></section>

    <div className="store-container store-body">
      {query ? <section className="section-block">{searchLoading ? <div className="search-loading"><div className="spinner"/><span>Loading results…</span></div> : <><div className="section-heading"><div><span>SEARCH RESULTS</span><h2>{apps.length} app{apps.length === 1 ? '' : 's'} for “{query}”</h2></div></div><div className="app-list">{apps.map(app => <AppRow key={app.id} app={app} onOpen={() => openApp(app)} action={actionFor(app)} onAction={() => void performAction(app)}/>)}</div>{apps.length === 0 && <div className="search-empty">No apps found for “{query}”.</div>}</>}</section> : <>
        <section className="section-block"><div className="section-heading"><div><span>DISCOVER</span><h2>Featured this week</h2></div><div className="carousel-controls"><span>{featuredPage + 1} / {featuredPageCount}</span><div className="carousel-arrows"><button aria-label="Previous featured apps" disabled={featuredPageCount <= 1} onClick={() => setFeaturedPage(page => (page - 1 + featuredPageCount) % featuredPageCount)}><ArrowLeft/></button><button aria-label="Next featured apps" disabled={featuredPageCount <= 1} onClick={() => setFeaturedPage(page => (page + 1) % featuredPageCount)}><ArrowRight/></button></div></div></div><div className="featured-grid" key={featuredPage}>{featured.map(app => <FeaturedCard key={app.id} app={app} onOpen={() => openApp(app)}/>)}</div></section>

        <section className="section-block"><div className="section-heading"><div><span>TOP PICKS</span><h2>Essential apps</h2></div><a href="#all">See all <ChevronRight size={16}/></a></div><div className="three-column-list">{(essential.length ? essential : data?.apps.slice(0,8) || []).map(app => <AppRow key={app.id} app={app} onOpen={() => openApp(app)} action={actionFor(app)} onAction={() => void performAction(app)}/>)}</div></section>

        <section id="categories" className="section-block"><div className="section-heading"><div><span>BROWSE</span><h2>Categories</h2></div></div><div className="category-grid">{data?.categories.map((c,i) => <button key={c.name} className={`category-card category-${i}`} onClick={() => updateQuery(c.name)}><span className="category-glyph">{c.glyph}</span><span><strong>{c.name}</strong><small>{c.count} apps</small></span><ChevronRight/></button>)}</div></section>

        {categoryShelves.length > 0 && <section className="section-block"><div className="section-heading"><div><span>COLLECTIONS</span><h2>Explore more</h2></div></div><div className="store-shelves">{categoryShelves.map(shelf => <div className="store-shelf" key={shelf.category.name}><div className="shelf-heading"><span>{shelf.category.glyph}</span><div><strong>{shelf.category.name}</strong><small>{shelf.category.count} apps in this collection</small></div></div>{shelf.apps.map(app => <AppRow key={app.id} app={app} onOpen={() => openApp(app)} action={actionFor(app)} onAction={() => void performAction(app)}/>)}</div>)}</div></section>}

        <section id="all" className="section-block"><div className="section-heading"><div><span>EXPLORE</span><h2>Apps & services</h2><small className="catalog-note">{catalogLoading ? <><span className="catalog-spinner"/> Loading more apps…</> : <>{data?.availableCount ? `${data.availableCount.toLocaleString()} apps available upstream · search spans the full catalog` : 'Apps from CapOS and upstream stores'}</>}</small></div></div><div className="app-list broad">{visibleCatalog.map(app => <AppRow key={app.id} app={app} onOpen={() => openApp(app)} action={actionFor(app)} onAction={() => void performAction(app)}/>)}</div>{data && catalogRemaining > 0 && <div className="show-more"><button onClick={() => setVisibleCatalogCount(count => Math.min(count + 100, data.apps.length))}>Show {Math.min(100, catalogRemaining)} more <ChevronDown/></button></div>}</section>
      </>}
    </div>
  </main><footer className="store-footer"><div className="store-container"><div><b>CapOS App Store</b><span>Packages from CapOS and configured upstreams.</span></div><div><a href="https://capos.top">capos.top</a><a href="https://repo.capos.top">Repository</a><a href="/admin">Admin</a></div></div></footer>{webdesktop.error && <div className="bridge-error" role="alert">{webdesktop.error}</div>}{selected && <AppDetail app={selected} loading={detailLoadingName === selected.name} onClose={closeDetail} action={actionFor(selected, true)} onAction={() => void performAction(selected, true)}/>}</Shell>;
}

type AdminTab = 'overview'|'packages'|'upstreams'|'versions'|'apps'|'settings';

function AdminDashboard() {
  const [state,setState] = useState<AdminState|null>(null); const [tab,setTab] = useState<AdminTab>('overview'); const [version,setVersion] = useState('rolling'); const [notice,setNotice] = useState(''); const [error,setError] = useState('');
  useEffect(() => { setState(null); setError(''); getAdminState(version).then(setState).catch(err => setError(err instanceof Error ? err.message : 'Could not load store state.')); }, [version]);
  if (error) return <div className="admin-loading"><ShieldCheck/>Cloudflare Access is active, but the store state could not be loaded: {error}</div>;
  if (!state) return <div className="admin-loading"><div className="spinner"/>Loading store state…</div>;
  const navigation: [AdminTab,string,React.ReactNode][] = [['overview','Overview',<CircleGauge/>],['packages','Local packages',<Package/>],['upstreams','Upstreams',<Cloud/>],['versions','Versions',<Boxes/>],['apps','App metadata',<LayoutGrid/>],['settings','Settings',<Settings/>]];
  return <Shell admin><div className="admin-layout"><aside className="admin-sidebar"><a className="admin-brand" href="/"><span className="mark"><Store size={17}/></span><span>CapOS<b>Store</b></span></a><nav>{navigation.map(([id,label,icon])=><button className={tab===id?'active':''} key={id} onClick={()=>setTab(id)}>{icon}<span>{label}</span></button>)}</nav><div className="sidebar-bottom"><div className="system-status"><span className="status-dot"/>Store online<small>Cloudflare Access</small></div><button onClick={()=>window.location.assign('/cdn-cgi/access/logout')}><LogOut/>Sign out</button></div></aside>
    <section className="admin-main"><header className="admin-topbar"><div><span className="admin-breadcrumb">Store /</span> <strong>{navigation.find(n=>n[0]===tab)?.[1]}</strong></div><div className="admin-top-actions"><label className="version-picker"><span>Repository</span><select value={version} onChange={e=>setVersion(e.target.value)}>{state.versions.map(v=><option key={v.name}>{v.name}</option>)}</select><ChevronDown/></label><a href="/" className="preview-link">View store <ExternalLink/></a></div></header><div className="admin-content">{notice && <div className="success-toast"><Check/> {notice}<button onClick={()=>setNotice('')}><X/></button></div>}{tab==='overview'&&<Overview state={state}/>} {tab==='packages'&&<Packages state={state} version={version} onNotice={setNotice}/>} {tab==='upstreams'&&<Upstreams state={state} version={version} setState={setState} onNotice={setNotice}/>} {tab==='versions'&&<Versions state={state} setState={setState} version={version} setVersion={setVersion} onNotice={setNotice}/>} {tab==='apps'&&<Metadata state={state}/>} {tab==='settings'&&<StoreSettings/>}</div></section></div></Shell>;
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

function Versions({state,setState,version,setVersion,onNotice}:{state:AdminState;setState:(s:AdminState)=>void;version:string;setVersion:(v:string)=>void;onNotice:(s:string)=>void}) { const [show,setShow]=useState(false); const [name,setName]=useState(''); const [label,setLabel]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function add(){if(!name||!label)return;setBusy(true);setError('');try{const created=await createVersion({name,label,copyFrom:version});setState({...state,versions:[created,...state.versions],stats:{...state.stats,versions:state.stats.versions+1}});setVersion(created.name);setShow(false);setName('');setLabel('');onNotice(`${created.label} created and selected`);}catch(err){setError(err instanceof Error?err.message:'Could not create repository version');}finally{setBusy(false)}}
  return <><PageTitle eyebrow="RELEASES" title="Repository versions" description="Maintain independent Snap views for rolling and stable CapOS releases." action={<button className="admin-primary" onClick={()=>setShow(true)}><Plus/>New version</button>}/><div className="version-grid">{state.versions.map(v=><div className={`version-card ${v.name===version?'selected':''}`} key={v.name}><div className="version-card-top"><span className="version-icon"><Boxes/></span><span className={v.frozen?'version-state frozen':'version-state'}>{v.frozen?'Frozen':v.name===version?'Selected':'Active'}</span></div><h2>{v.label}</h2><code>{v.name}</code><div className="version-meta"><span>{v.appCount} local apps</span><span>{v.frozen?'Read only':'Accepting changes'}</span></div><button onClick={()=>{setVersion(v.name);onNotice(`Now managing ${v.label}`)}}>{v.name===version?'Managing this version':'Manage version'} <ChevronRight/></button></div>)}</div>{show&&<div className="modal-backdrop"><div className="admin-modal small"><button className="modal-close" onClick={()=>setShow(false)}><X/></button><span className="modal-icon"><Boxes/></span><h2>Create repository version</h2><p>Create an independent Snap repository view. Upstream source order is copied from <b>{version}</b>; local packages start empty.</p><div className="form-stack"><label>Version name<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="v1.2"/></label><label>Display label<input value={label} onChange={e=>setLabel(e.target.value)} placeholder="CapOS 1.2"/></label></div>{error&&<div className="error-banner">{error}</div>}<button className="admin-primary modal-submit" disabled={busy||!name.trim()||!label.trim()} onClick={add}>{busy?'Creating…':'Create version'} <ArrowRight/></button></div></div>}</> }
function Metadata({state}:{state:AdminState}) { return <><PageTitle eyebrow="CATALOG" title="App metadata" description="Curate how local and upstream apps appear in CapOS and WebDesktop."/><div className="metadata-toolbar"><SearchBox value="" onChange={()=>{}} compact/><button><Sparkles/>Featured</button><button><AppWindow/>WebDesktop ready</button></div><section className="admin-panel table-panel"><table className="admin-table"><thead><tr><th>App</th><th>Integration</th><th>Publisher</th><th>Source</th><th>Visibility</th><th></th></tr></thead><tbody>{state.localPackages.map(app=><tr key={app.id}><td><div className="table-app"><AppIcon app={app} size="sm"/><span><b>{app.displayName}</b><small>{app.summary}</small></span></div></td><td>{app.webdesktop||'Unknown'}</td><td>{app.publisher}</td><td>{app.sourceName}</td><td><span className="visible-chip">Visible</span></td><td><button className="row-menu">Edit</button></td></tr>)}</tbody></table></section></> }
function StoreSettings(){return <><PageTitle eyebrow="CONFIGURATION" title="Store settings" description="Global behavior for snap.capos.top and package delivery."/><div className="settings-grid"><section className="admin-panel settings-section"><h2>General</h2><label>Store display name<input defaultValue="CapOS App Store"/></label><label>Default repository<select defaultValue="rolling"><option>rolling</option></select></label><label className="setting-toggle"><span><b>Proxy upstream downloads</b><small>Keep Canonical download URLs behind snap.capos.top.</small></span><span className="switch"><input type="checkbox" defaultChecked/><span/></span></label></section><section className="admin-panel settings-section"><h2>Security</h2><label className="setting-toggle"><span><b>Cloudflare Access</b><small>Email one-time-code authentication protects the admin UI and API.</small></span><span className="switch"><input type="checkbox" defaultChecked disabled/><span/></span></label><label className="setting-toggle"><span><b>Audit administrative actions</b><small>Record upstream, package and release changes.</small></span><span className="switch"><input type="checkbox" defaultChecked/><span/></span></label><button className="secondary-danger" onClick={()=>window.location.assign('/cdn-cgi/access/logout')}>Sign out of Access</button></section></div></>}

function AdminApp(){return <AdminDashboard/>}

export function App(){const path=window.location.pathname;return path.startsWith('/admin')?<AdminApp/>:<Storefront/>}
