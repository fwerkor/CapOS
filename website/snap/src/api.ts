import { mockAdmin, mockStorefront } from './mock';
import type { AdminState, StorefrontData } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function getStorefront(version = 'rolling'): Promise<StorefrontData> {
  if (import.meta.env.DEV) return mockStorefront;
  return request<StorefrontData>(`/api/storefront?version=${encodeURIComponent(version)}`).catch(() => mockStorefront);
}

export async function searchApps(query: string, version = 'rolling'): Promise<StorefrontData['apps']> {
  if (import.meta.env.DEV) {
    const q = query.trim().toLowerCase();
    return mockStorefront.apps.filter(app => [app.displayName, app.publisher, app.summary, app.category, app.name].some(value => value.toLowerCase().includes(q)));
  }
  const result = await request<{ apps: StorefrontData['apps'] }>(`/api/search?version=${encodeURIComponent(version)}&q=${encodeURIComponent(query)}`);
  return result.apps;
}

export async function login(pin: string): Promise<void> {
  if (import.meta.env.DEV) {
    if (!pin.trim()) throw new Error('Enter an administrator PIN.');
    sessionStorage.setItem('capos-admin-dev', '1');
    return;
  }
  await request('/api/admin/auth', { method: 'POST', body: JSON.stringify({ pin }) });
}

export async function logout(): Promise<void> {
  if (import.meta.env.DEV) sessionStorage.removeItem('capos-admin-dev');
  else await request('/api/admin/logout', { method: 'POST', body: '{}' });
}

export async function getAdminState(version = 'rolling'): Promise<AdminState> {
  if (import.meta.env.DEV) return mockAdmin;
  return request<AdminState>(`/api/admin/state?version=${encodeURIComponent(version)}`);
}

export async function saveUpstreams(version: string, upstreams: AdminState['upstreams']): Promise<void> {
  if (import.meta.env.DEV) return;
  await request('/api/admin/upstreams', { method: 'PUT', body: JSON.stringify({ version, upstreams }) });
}

export async function createUpstream(version: string, name: string, apiUrl: string): Promise<void> {
  if (import.meta.env.DEV) return;
  await request('/api/admin/upstreams', { method: 'POST', body: JSON.stringify({ version, name, apiUrl }) });
}

export interface PackageUploadTicket {
  uploadId: string;
  objectPath: string;
  partSize: number;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export async function requestPackageUpload(input: { version: string; name: string; versionString: string; architecture: string; size: number }): Promise<PackageUploadTicket> {
  if (import.meta.env.DEV) return { uploadId: 'mock-upload', objectPath: `${input.version}/snaps/${input.name}_${input.versionString}_${input.architecture}.snap`, partSize: 32 * 1024 * 1024 };
  return request<PackageUploadTicket>('/api/admin/packages/uploads', { method: 'POST', body: JSON.stringify(input) });
}

export async function uploadPackagePart(input: { version: string; uploadId: string; objectPath: string; partNumber: number; chunk: Blob }): Promise<UploadedPart> {
  if (import.meta.env.DEV) return { partNumber: input.partNumber, etag: `mock-${input.partNumber}` };
  const params = new URLSearchParams({ version: input.version, uploadId: input.uploadId, objectPath: input.objectPath, partNumber: String(input.partNumber) });
  const res = await fetch(`/api/admin/packages/upload-part?${params}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: input.chunk });
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Upload part failed (${res.status})`);
  }
  return res.json() as Promise<UploadedPart>;
}

export async function abortPackageUpload(payload: { version: string; uploadId: string; objectPath: string }): Promise<void> {
  if (import.meta.env.DEV) return;
  await request('/api/admin/packages/abort', { method: 'POST', body: JSON.stringify(payload) });
}

export async function finalizePackage(payload: Record<string, unknown>): Promise<void> {
  if (import.meta.env.DEV) return;
  await request('/api/admin/packages/finalize', { method: 'POST', body: JSON.stringify(payload) });
}
