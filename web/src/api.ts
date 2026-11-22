export interface Me { login: string; avatar: string }
export interface Repo { fullName: string; private: boolean; defaultBranch: string; archived: boolean; canPush: boolean }
export interface Branch { name: string; protected: boolean }
export interface Dest { repo: string; branch: string; folder: string }

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'X-Requested-With': 'gitpush', ...init.headers } });
  if (res.status === 401 && path !== '/api/me') onUnauthorized?.();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), { status: res.status });
  }
  return res.json() as Promise<T>;
}

export interface Extraction { id: string; name: string; fileCount: number; totalBytes: number; files: { path: string; size: number }[] }
export interface Item { key: string; file: File; state: 'idle' | 'busy' | 'done' | 'error'; result?: Extraction; error?: string }

export function extractZip(file: File): Promise<Extraction> {
  const body = new FormData();
  body.append('file', file);
  return api<Extraction>('/api/zip/extract', { method: 'POST', body });
}
export const discardExtraction = (id: string) => api<{ ok: boolean }>(`/api/extractions/${id}`, { method: 'DELETE' });

export type Preview = { kind: 'text'; text: string; truncated: boolean } | { kind: 'image'; dataUrl: string } | { kind: 'none'; reason: string };
const post = (id: string, op: string, body: object) =>
  api<Extraction>(`/api/extractions/${id}/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const renamePath = (id: string, from: string, to: string) => post(id, 'rename', { from, to });
export const deletePath = (id: string, path: string) => post(id, 'delete', { path });
export const makeFolder = (id: string, path: string) => post(id, 'mkdir', { path });
export const previewFile = (id: string, path: string) => api<Preview>(`/api/extractions/${id}/file?path=${encodeURIComponent(path)}`);

const rp = (full: string) => full.split('/').map(encodeURIComponent).join('/');
const jsonPost = <T>(path: string, body: object) => api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const listBranches = (full: string) => api<Branch[]>(`/api/repos/${rp(full)}/branches`);
export const createBranch = (full: string, name: string, from: string) => jsonPost<Branch>(`/api/repos/${rp(full)}/branches`, { name, from });
export const createRepo = (name: string, isPrivate: boolean) => jsonPost<Repo>('/api/repos', { name, private: isPrivate });
export const listFolders = (full: string, branch: string) => api<{ folders: string[]; truncated: boolean }>(`/api/repos/${rp(full)}/folders?branch=${encodeURIComponent(branch)}`);

export interface PushJob {
  id: string; status: 'running' | 'done' | 'conflict' | 'failed' | 'cancelled'; done: number; total: number;
  commitUrl?: string; uploaded?: number; skipped?: string[]; unchanged?: number; conflicts?: string[]; failed?: string[]; error?: string;
}
export const startPush = (body: object) => jsonPost<PushJob>('/api/push', body);
export const getPush = (id: string) => api<PushJob>(`/api/push/${id}`);
export const cancelPush = (id: string) => jsonPost<PushJob>(`/api/push/${id}/cancel`, {});
