import crypto from 'node:crypto';
import { ZipError, type ExtractedFile } from './zip.js';

export interface Extraction { id: string; sid: string; name: string; files: ExtractedFile[]; bytes: number; exp: number }
const store = new Map<string, Extraction>();
const TTL = 60 * 60 * 1000, MAX_PER_SESSION = 3, MAX_TOTAL = 1024 ** 3;

setInterval(() => { const now = Date.now(); for (const [id, e] of store) if (e.exp < now) store.delete(id); }, 60_000).unref();

export function saveExtraction(sid: string, name: string, files: ExtractedFile[]): Extraction {
  const bytes = files.reduce((n, f) => n + f.data.length, 0);
  const mine = [...store.values()].filter((e) => e.sid === sid).sort((a, b) => a.exp - b.exp);
  while (mine.length >= MAX_PER_SESSION) store.delete(mine.shift()!.id);
  if ([...store.values()].reduce((n, e) => n + e.bytes, 0) + bytes > MAX_TOTAL) throw new ZipError('Server storage is full. Remove an extracted ZIP or try again shortly.');
  const e: Extraction = { id: crypto.randomBytes(12).toString('hex'), sid, name, files, bytes, exp: Date.now() + TTL };
  store.set(e.id, e);
  return e;
}
export const getExtraction = (sid: string, id: string) => { const e = store.get(id); return e && e.sid === sid && e.exp > Date.now() ? e : undefined; };
export const deleteExtraction = (sid: string, id: string) => { if (getExtraction(sid, id)) store.delete(id); };
export const deleteAllFor = (sid?: string) => { for (const [id, e] of store) if (e.sid === sid) store.delete(id); };
