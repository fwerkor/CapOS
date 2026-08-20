export type SourceKind = 'local' | 'upstream';

export interface StoreApp {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  summary: string;
  description: string;
  category: string;
  icon?: string;
  accent: string;
  source: SourceKind;
  sourceName: string;
  verified: boolean;
  featured?: boolean;
  version: string;
  channel: string;
  architectures: string[];
  webdesktop?: 'native' | 'web' | 'gui' | 'service' | 'unknown';
  rating?: number;
  downloads?: string;
  banner?: string;
  screenshots?: string[];
  videos?: string[];
  license?: string;
  website?: string;
  contact?: string;
  storeUrl?: string;
  links?: { label: string; url: string }[];
  publisherUsername?: string;
  confinement?: 'strict' | 'classic' | 'devmode' | string;
  releasedAt?: string;
  updated?: string;
}

export interface Upstream {
  id: number;
  name: string;
  apiUrl: string;
  priority: number;
  enabled: boolean;
  status?: 'online' | 'degraded' | 'offline';
  latencyMs?: number;
}

export interface VersionInfo {
  name: string;
  label: string;
  active: boolean;
  frozen: boolean;
  appCount: number;
}

export interface StorefrontData {
  version: string;
  apps: StoreApp[];
  categories: { name: string; count: number; glyph: string }[];
  availableCount?: number;
  refreshing?: boolean;
}

export interface AdminState {
  versions: VersionInfo[];
  upstreams: Upstream[];
  localPackages: StoreApp[];
  stats: { local: number; upstream: number; versions: number; downloads24h: number };
}
