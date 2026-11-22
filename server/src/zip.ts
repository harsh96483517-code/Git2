import yauzl from 'yauzl';
import { config } from './config.js';

export class ZipError extends Error {}
export interface ExtractedFile { path: string; data: Buffer }

const JUNK = (p: string) => p.startsWith('__MACOSX/') || p.endsWith('.DS_Store') || p === '.git' || p.startsWith('.git/');

/** Returns a clean relative path, or throws on traversal / absolute / drive-letter paths (ZIP Slip). */
export function safePath(raw: string): string {
  const p = raw.replace(/\\/g, '/');
  if (p.includes('\0') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) throw new ZipError(`Unsafe path in ZIP: ${raw}`);
  const parts = p.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.includes('..')) throw new ZipError(`Path traversal in ZIP: ${raw}`);
  return parts.join('/');
}

/**
 * Sizes are checked from the central directory BEFORE any data is inflated, and yauzl errors if an
 * entry inflates past its declared size, so a lying archive cannot exhaust memory.
 */
export function extractZip(buf: Buffer): Promise<ExtractedFile[]> {
  const L = config.limits;
  return new Promise((resolve, reject) => {
    if (buf.length > L.zipBytes) return reject(new ZipError('ZIP exceeds upload size limit'));
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(new ZipError('Invalid or corrupted ZIP file'));
      const out: ExtractedFile[] = [];
      const seen = new Set<string>();
      let total = 0;
      const fail = (e: Error) => { zf.close(); reject(e); };
      zf.on('error', () => fail(new ZipError('Invalid or corrupted ZIP file')));
      zf.on('end', () => (out.length ? resolve(out) : reject(new ZipError('ZIP contains no files'))));
      zf.on('entry', (entry: yauzl.Entry) => {
        let path: string;
        try {
          if (entry.fileName.endsWith('/')) return zf.readEntry();
          path = safePath(entry.fileName);
          if (!path || JUNK(path)) return zf.readEntry();
          if (seen.has(path)) throw new ZipError(`Duplicate path in ZIP: ${path}`);
          if (out.length >= L.files) throw new ZipError('Too many files in ZIP');
          if (entry.uncompressedSize > L.fileBytes) throw new ZipError(`${path} exceeds GitHub's 100 MB file limit`);
          total += entry.uncompressedSize;
          if (total > L.extractedBytes) throw new ZipError('Extracted size exceeds limit');
          seen.add(path);
        } catch (e) { return fail(e as Error); }
        zf.openReadStream(entry, (e, stream) => {
          if (e || !stream) return fail(new ZipError('Corrupted ZIP entry (or encrypted, which is not supported)'));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', () => fail(new ZipError('Corrupted ZIP entry')));
          stream.on('end', () => { out.push({ path, data: Buffer.concat(chunks) }); zf.readEntry(); });
        });
      });
      zf.readEntry();
    });
  });
}
