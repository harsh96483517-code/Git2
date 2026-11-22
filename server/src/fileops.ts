import { safePath, type ExtractedFile } from './zip.js';

export class FileOpError extends Error {}

const clean = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw || raw.length > 1000) throw new FileOpError('Enter a valid path');
  let p: string;
  try { p = safePath(raw); } catch { throw new FileOpError('That path is not allowed'); }
  if (!p || p.split('/').some((s) => s === '.git')) throw new FileOpError('That path is not allowed');
  return p;
};
const under = (p: string, dir: string) => p === dir || p.startsWith(dir + '/');

function assertTree(files: ExtractedFile[]) {
  const set = new Set(files.map((f) => f.path));
  if (set.size !== files.length) throw new FileOpError('Something with that name already exists');
  for (const p of set) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) if (set.has(parts.slice(0, i).join('/'))) throw new FileOpError('A file and a folder cannot share a name');
  }
}

export function renamePath(files: ExtractedFile[], from: unknown, to: unknown): ExtractedFile[] {
  const a = clean(from), b = clean(to);
  if (!files.some((f) => under(f.path, a))) throw new FileOpError('Nothing found at that path');
  if (b !== a && under(b, a)) throw new FileOpError('A folder cannot be moved into itself');
  const out = files.map((f) => (under(f.path, a) ? { path: b + f.path.slice(a.length), data: f.data } : f));
  assertTree(out);
  return out;
}

export function deletePath(files: ExtractedFile[], path: unknown): ExtractedFile[] {
  const a = clean(path);
  const out = files.filter((f) => !under(f.path, a));
  if (out.length === files.length) throw new FileOpError('Nothing found at that path');
  if (!out.length) throw new FileOpError('An extraction needs at least one file. Remove the ZIP instead.');
  return out;
}

/** Git cannot store empty folders, so a new folder is created with an empty .gitkeep file inside. */
export function makeFolder(files: ExtractedFile[], path: unknown): ExtractedFile[] {
  const p = clean(path);
  if (files.some((f) => under(f.path, p))) throw new FileOpError('Something with that name already exists');
  const out = [...files, { path: `${p}/.gitkeep`, data: Buffer.alloc(0) }];
  assertTree(out);
  return out;
}

const IMG: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
export function previewFile(files: ExtractedFile[], path: unknown) {
  const p = clean(path);
  const f = files.find((x) => x.path === p);
  if (!f) throw new FileOpError('File not found');
  const ext = p.includes('.') ? p.split('.').pop()!.toLowerCase() : '';
  if (IMG[ext]) {
    return f.data.length <= 2 * 1024 * 1024
      ? { kind: 'image' as const, dataUrl: `data:${IMG[ext]};base64,${f.data.toString('base64')}` }
      : { kind: 'none' as const, reason: 'Image is larger than 2 MB' };
  }
  if (f.data.subarray(0, 8000).includes(0)) return { kind: 'none' as const, reason: 'Binary file, no preview' };
  const max = 200 * 1024;
  return { kind: 'text' as const, text: f.data.subarray(0, max).toString('utf8'), truncated: f.data.length > max };
}
