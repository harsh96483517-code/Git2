import crypto from 'node:crypto';
import { commitFiles, ConflictError, GitHubError } from './github.js';

export interface PushRequest {
  token: string; repo: string; branch: string; folder: string; message: string;
  onConflict: 'abort' | 'skip' | 'overwrite'; files: { path: string; data: Buffer }[];
}
export interface Job {
  id: string; sid: string; repo: string; status: 'running' | 'done' | 'conflict' | 'failed' | 'cancelled';
  done: number; total: number; commitUrl?: string; uploaded?: number; skipped?: string[]; unchanged?: number;
  conflicts?: string[]; failed?: string[]; error?: string;
  ctl: AbortController; cache: Map<string, string>; exp: number;
}

const jobs = new Map<string, Job>();
setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (j.exp < now && j.status !== 'running') jobs.delete(id); }, 60_000).unref();

export const getJob = (sid: string, id: string) => { const j = jobs.get(id); return j && j.sid === sid ? j : undefined; };
export const runningJob = (sid: string) => [...jobs.values()].find((j) => j.sid === sid && j.status === 'running');
export const publicJob = ({ ctl: _c, cache: _k, sid: _s, exp: _e, ...rest }: Job) => rest;

const friendly = (e: unknown): string => {
  if (e instanceof GitHubError) {
    if (e.status === 401) return 'GitHub rejected your sign-in. Sign out and connect again.';
    if (e.status === 403) return 'GitHub refused the request. You may lack write access, hit a rate limit, or the branch is protected.';
    if (e.status === 404) return 'The repository or branch was not found, or you do not have access.';
    if (e.status === 409 || e.status === 422) return 'The branch changed on GitHub or rejected the update. Nothing was changed. Try again.';
    return 'GitHub returned an error. Nothing was changed. Try again.';
  }
  return e instanceof Error ? e.message : 'Upload failed';
};

export function startJob(sid: string, req: PushRequest, retryOf?: string): Job {
  const prev = retryOf ? getJob(sid, retryOf) : undefined;
  const job: Job = {
    id: crypto.randomBytes(12).toString('hex'), sid, repo: req.repo, status: 'running', done: 0, total: 0,
    ctl: new AbortController(), cache: prev && prev.repo === req.repo ? prev.cache : new Map(), exp: Date.now() + 3600_000
  };
  jobs.set(job.id, job);
  const [owner, repo] = req.repo.split('/');
  commitFiles({
    token: req.token, owner, repo, branch: req.branch, destDir: req.folder, files: req.files, message: req.message,
    onConflict: req.onConflict, signal: job.ctl.signal, cache: job.cache,
    onProgress: (d, t) => { job.done = d; job.total = t; }
  }).then((r) => {
    if (r.ok) Object.assign(job, { status: 'done', commitUrl: r.url, uploaded: r.uploaded, skipped: r.skipped, unchanged: r.unchanged });
    else Object.assign(job, { status: 'failed', failed: r.failed, error: `${r.failed.length} ${r.failed.length === 1 ? 'file' : 'files'} could not be uploaded. Nothing was committed.` });
  }).catch((e: unknown) => {
    if (e instanceof ConflictError) Object.assign(job, { status: 'conflict', conflicts: e.paths });
    else if (job.ctl.signal.aborted) job.status = 'cancelled';
    else Object.assign(job, { status: 'failed', error: friendly(e) });
  }).finally(() => { job.exp = Date.now() + 3600_000; });
  return job;
}
