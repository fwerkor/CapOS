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

export async function requestPackageUpload(input: { version: string; name: string; versionString: string; architecture: string; size: number }): Promise<{ uploadUrl: string; objectPath: string }> {
  if (import.meta.env.DEV) return { uploadUrl: '#mock-upload', objectPath: `${input.version}/snaps/${input.name}_${input.versionString}_${input.architecture}.snap` };
  return request<{ uploadUrl: string; objectPath: string }>('/api/admin/packages/upload-url', { method: 'POST', body: JSON.stringify(input) });
}

export async function finalizePackage(payload: Record<string, unknown>): Promise<void> {
  if (import.meta.env.DEV) return;
  await request('/api/admin/packages/finalize', { method: 'POST', body: JSON.stringify(payload) });
}
