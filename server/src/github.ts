import crypto from 'node:crypto';

const API = 'https://api.github.com';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GitHubError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export class ConflictError extends Error { constructor(public paths: string[]) { super('Files already exist in destination'); } }

export async function gh<T>(token: string, path: string, init: RequestInit = {}, retries = 2): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...init.headers }
  });
  if ((res.status === 403 || res.status === 429) && retries > 0) {
    const ra = Number(res.headers.get('retry-after'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const wait = ra ? ra * 1000 : res.headers.get('x-ratelimit-remaining') === '0' && reset ? reset * 1000 - Date.now() : 0;
    if (wait > 0 && wait <= 60_000) { await sleep(wait + 500); return gh<T>(token, path, init, retries - 1); }
  }
  if (!res.ok) throw new GitHubError(res.status, `GitHub API ${res.status} for ${init.method ?? 'GET'} ${path.split('?')[0]}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const SAFE = /^[A-Za-z0-9._-]+$/;
export const validRepo = (owner: string, repo: string) => SAFE.test(owner) && SAFE.test(repo);
export const refPath = (b: string) => b.split('/').map(encodeURIComponent).join('/');

export interface CommitOptions {
  token: string; owner: string; repo: string; branch: string; destDir: string;
  files: { path: string; data: Uint8Array }[]; message: string;
  onConflict: 'abort' | 'skip' | 'overwrite';
  cache?: Map<string, string>; // content hash -> blob sha, lets a retry skip blobs already uploaded to the same repo
  signal?: AbortSignal; onProgress?: (done: number, total: number) => void;
}
export type CommitResult =
  | { ok: true; sha: string; url: string; uploaded: number; skipped: string[]; unchanged: number }
  | { ok: false; failed: string[] };

export async function commitFiles(o: CommitOptions): Promise<CommitResult> {
  if (!validRepo(o.owner, o.repo)) throw new Error('Invalid repository name');
  const base = `/repos/${o.owner}/${o.repo}`;
  const dest = o.destDir.split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
  const full = (p: string) => (dest ? `${dest}/${p}` : p);

  const ref = await gh<{ object: { sha: string } }>(o.token, `${base}/git/ref/heads/${refPath(o.branch)}`);
  const parent = ref.object.sha;
  const commit = await gh<{ tree: { sha: string } }>(o.token, `${base}/git/commits/${parent}`);
  const tree = await gh<{ tree: { path: string; sha: string }[]; truncated: boolean }>(o.token, `${base}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('Repository tree too large for conflict detection');

  const existing = new Map(tree.tree.map((t) => [t.path, t.sha]));
  const gitSha = (d: Uint8Array) => crypto.createHash('sha1').update(`blob ${d.length}\0`).update(d).digest('hex');
  const clashes: string[] = [], same = new Set<string>();
  for (const f of o.files) {
    const have = existing.get(full(f.path));
    if (have === undefined) continue;
    if (have === gitSha(f.data)) same.add(full(f.path)); else clashes.push(full(f.path));
  }
  if (clashes.length && o.onConflict === 'abort') throw new ConflictError(clashes);
  const skip = new Set(o.onConflict === 'skip' ? clashes : []);
  const todo = o.files.filter((f) => !skip.has(full(f.path)) && !same.has(full(f.path)));
  if (!todo.length) throw new Error('Nothing new to upload. Every file already exists in the repository or was skipped.');

  // Blobs, 4 at a time. Any failure means no commit is made, so the repo is never left half-updated.
  const entries: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
  const failed: string[] = [];
  let done = 0, i = 0;
  const worker = async () => {
    while (i < todo.length) {
      if (o.signal?.aborted) return;
      const f = todo[i++];
      try {
        const key = crypto.createHash('sha256').update(f.data).digest('hex');
        let sha = o.cache?.get(key);
        if (!sha) {
          sha = (await gh<{ sha: string }>(o.token, `${base}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: Buffer.from(f.data).toString('base64'), encoding: 'base64' }) })).sha;
          o.cache?.set(key, sha);
        }
        entries.push({ path: full(f.path), mode: '100644', type: 'blob', sha });
      } catch { failed.push(full(f.path)); }
      o.onProgress?.(++done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (o.signal?.aborted) throw new Error('Upload cancelled');
  if (failed.length) return { ok: false, failed };

  const newTree = await gh<{ sha: string }>(o.token, `${base}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }) });
  const newCommit = await gh<{ sha: string }>(o.token, `${base}/git/commits`, { method: 'POST', body: JSON.stringify({ message: o.message, tree: newTree.sha, parents: [parent] }) });
  await gh(o.token, `${base}/git/refs/heads/${refPath(o.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha, force: false }) });
  return { ok: true, sha: newCommit.sha, url: `https://github.com/${o.owner}/${o.repo}/commit/${newCommit.sha}`, uploaded: entries.length, skipped: [...skip], unchanged: same.size };
}

/** Revokes just this token at GitHub (not the user's whole grant). Best effort: never throws. */
export async function revokeToken(clientId: string, clientSecret: string, token: string): Promise<void> {
  try {
    await fetch(`${API}/applications/${clientId}/token`, {
      method: 'DELETE',
      headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token })
    });
  } catch { /* best effort */ }
}

/** Fetches up to maxPages * 100 items from a list endpoint. */
export async function ghPaged<T>(token: string, path: string, maxPages = 3): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= maxPages; page++) {
    const r = await gh<T[]>(token, `${path}${sep}per_page=100&page=${page}`);
    out.push(...r);
    if (r.length < 100) break;
  }
  return out;
}

/** Conservative subset of git's ref-name rules; GitHub still has the final say. */
export const validBranch = (b: unknown): b is string =>
  typeof b === 'string' && b.length <= 200 && /^[A-Za-z0-9._\/-]+$/.test(b) && !/(^[/.-]|[/.]$|\.\.|\/\/|\/\.|\.lock(\/|$))/.test(b);
