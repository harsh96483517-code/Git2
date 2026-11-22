import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { config } from './config.js';
import { createSession, destroySession, getSession } from './sessions.js';
import { gh, ghPaged, GitHubError, refPath, revokeToken, validBranch, validRepo } from './github.js';
import { extractZip, ZipError, type ExtractedFile } from './zip.js';
import { getJob, publicJob, runningJob, startJob } from './jobs.js';
import { deletePath, FileOpError, makeFolder, previewFile, renamePath } from './fileops.js';
import { deleteAllFor, deleteExtraction, getExtraction, saveExtraction, type Extraction } from './extractions.js';

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: config.prod, path: '/' };
type Authed = Request & { token: string; sid: string };

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const s = getSession(req.cookies.gp_sid);
  if (!s) return res.status(401).json({ error: 'Not signed in' });
  (req as Authed).token = s.token;
  (req as Authed).sid = req.cookies.gp_sid;
  next();
};

// CSRF: every state-changing request must carry a custom header, which cross-site forms cannot set.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('x-requested-with') === 'gitpush') return next();
  res.status(403).json({ error: 'Forbidden' });
});

app.get('/health', (_q, res) => res.json({ ok: true }));

// Basic per-IP limiter for the sign-in endpoints (20 requests per minute).
const hits = new Map<string, { n: number; reset: number }>();
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); }, 60_000).unref();
const authLimiter = (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now(), k = req.ip ?? 'unknown', h = hits.get(k);
  if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + 60_000 }); return next(); }
  if (++h.n > 20) return res.status(429).send('Too many sign-in attempts. Wait a minute and try again.');
  next();
};
const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

app.get('/auth/login', authLimiter, (_q, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('gp_state', state, { ...cookieOpts, maxAge: 10 * 60 * 1000 });
  const p = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.baseUrl}/auth/callback`, scope: 'repo workflow', state });
  res.redirect(`https://github.com/login/oauth/authorize?${p}`);
});

app.get('/auth/callback', authLimiter, async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const back = (reason: string) => res.redirect(`${config.webOrigin}/?auth_error=${reason}`);
  const expected = req.cookies.gp_state as string | undefined;
  res.clearCookie('gp_state', cookieOpts);
  if (!state || !expected || !safeEqual(state, expected)) return back('state');
  if (error) return back(error === 'access_denied' ? 'denied' : 'failed');
  if (!code) return back('failed');
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: `${config.baseUrl}/auth/callback` })
    });
    const { access_token } = (await r.json()) as { access_token?: string };
    if (!access_token) return back('failed');
    const u = await gh<{ login: string; avatar_url: string }>(access_token, '/user');
    // Always issue a fresh session id on login (prevents session fixation) and drop any old one.
    deleteAllFor(req.cookies.gp_sid); destroySession(req.cookies.gp_sid);
    res.cookie('gp_sid', createSession(access_token, { login: u.login, avatar: u.avatar_url }), { ...cookieOpts, maxAge: 8 * 3600 * 1000 });
    res.redirect(config.webOrigin);
  } catch {
    back('failed');
  }
});

app.post('/auth/logout', (req, res) => {
  const sid = req.cookies.gp_sid as string | undefined;
  const sess = getSession(sid);
  deleteAllFor(sid); destroySession(sid);
  res.clearCookie('gp_sid', cookieOpts);
  res.json({ ok: true });
  if (sess) void revokeToken(config.clientId, config.clientSecret, sess.token);
});
app.get('/api/me', (req, res) => { const s = getSession(req.cookies.gp_sid); s ? res.json(s.user) : res.status(401).json({ error: 'Not signed in' }); });

interface GhRepo { full_name: string; private: boolean; default_branch: string; archived: boolean; permissions?: { push?: boolean } }
const toRepo = (x: GhRepo) => ({
  fullName: x.full_name, private: x.private, defaultBranch: x.default_branch, archived: x.archived,
  canPush: !x.archived && (x.permissions ? !!x.permissions.push : true)
});

app.get('/api/repos', requireAuth, async (req, res, next) => {
  try { res.json((await ghPaged<GhRepo>((req as Authed).token, '/user/repos?sort=updated')).map(toRepo)); } catch (e) { next(e); }
});

// New repositories start with a README so they already have a branch to push to.
app.post('/api/repos', requireAuth, async (req, res, next) => {
  const { name, private: priv } = (req.body ?? {}) as { name?: unknown; private?: unknown };
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(name) || /^\.+$/.test(name)) {
    return res.status(400).json({ error: 'Use letters, numbers, dots, dashes, or underscores (up to 100 characters).' });
  }
  try {
    const r = await gh<GhRepo>((req as Authed).token, '/user/repos', { method: 'POST', body: JSON.stringify({ name, private: priv !== false, auto_init: true }) });
    res.status(201).json(toRepo(r));
  } catch (e) { next(e); }
});

app.get('/api/repos/:owner/:repo/branches', requireAuth, async (req, res, next) => {
  const { owner, repo } = req.params;
  if (!validRepo(owner, repo)) return res.status(400).json({ error: 'Invalid repository' });
  try {
    const r = await ghPaged<{ name: string; protected: boolean }>((req as Authed).token, `/repos/${owner}/${repo}/branches`);
    res.json(r.map((b) => ({ name: b.name, protected: b.protected })));
  } catch (e) { next(e); }
});

app.post('/api/repos/:owner/:repo/branches', requireAuth, async (req, res, next) => {
  const { owner, repo } = req.params;
  const { name, from } = (req.body ?? {}) as { name?: unknown; from?: unknown };
  if (!validRepo(owner, repo)) return res.status(400).json({ error: 'Invalid repository' });
  if (!validBranch(name) || !validBranch(from)) return res.status(400).json({ error: 'Enter a valid branch name, such as feature/new-files.' });
  try {
    const t = (req as Authed).token, base = `/repos/${owner}/${repo}`;
    const src = await gh<{ object: { sha: string } }>(t, `${base}/git/ref/heads/${refPath(from)}`);
    await gh(t, `${base}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${name}`, sha: src.object.sha }) });
    res.status(201).json({ name, protected: false });
  } catch (e) { next(e); }
});

app.get('/api/repos/:owner/:repo/folders', requireAuth, async (req, res, next) => {
  const { owner, repo } = req.params;
  const branch = req.query.branch;
  if (!validRepo(owner, repo) || !validBranch(branch)) return res.status(400).json({ error: 'Invalid repository or branch' });
  try {
    const t = (req as Authed).token, base = `/repos/${owner}/${repo}`;
    const ref = await gh<{ object: { sha: string } }>(t, `${base}/git/ref/heads/${refPath(branch)}`);
    const c = await gh<{ tree: { sha: string } }>(t, `${base}/git/commits/${ref.object.sha}`);
    const tree = await gh<{ tree: { path: string; type: string }[]; truncated: boolean }>(t, `${base}/git/trees/${c.tree.sha}?recursive=1`);
    res.json({ folders: tree.tree.filter((x) => x.type === 'tree').map((x) => x.path).slice(0, 500), truncated: tree.truncated });
  } catch (e) { next(e); }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.limits.zipBytes, files: 1 } });
const summary = (e: Extraction) => ({
  id: e.id, name: e.name, fileCount: e.files.length, totalBytes: e.bytes,
  files: e.files.map((f) => ({ path: f.path, size: f.data.length }))
});

app.post('/api/zip/extract', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, async (err?: { code?: string }) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'ZIP is larger than the upload limit' : 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    try {
      const files = await extractZip(req.file.buffer);
      res.json(summary(saveExtraction((req as Authed).sid, req.file.originalname.slice(-200), files)));
    } catch (e) { e instanceof ZipError ? res.status(400).json({ error: e.message }) : next(e); }
  });
});

app.get('/api/extractions/:id', requireAuth, (req, res) => {
  const e = getExtraction((req as Authed).sid, req.params.id);
  e ? res.json(summary(e)) : res.status(404).json({ error: 'Extraction expired or not found' });
});

app.delete('/api/extractions/:id', requireAuth, (req, res) => { deleteExtraction((req as Authed).sid, req.params.id); res.json({ ok: true }); });

const mutate = (fn: (files: ExtractedFile[], body: Record<string, unknown>) => ExtractedFile[]) => (req: Request, res: Response, next: NextFunction) => {
  const e = getExtraction((req as Authed).sid, req.params.id);
  if (!e) return res.status(404).json({ error: 'Extraction expired or not found' });
  try {
    e.files = fn(e.files, (req.body ?? {}) as Record<string, unknown>);
    e.bytes = e.files.reduce((n, f) => n + f.data.length, 0);
    res.json(summary(e));
  } catch (err) { err instanceof FileOpError ? res.status(400).json({ error: err.message }) : next(err); }
};
app.post('/api/extractions/:id/rename', requireAuth, mutate((f, b) => renamePath(f, b.from, b.to)));
app.post('/api/extractions/:id/delete', requireAuth, mutate((f, b) => deletePath(f, b.path)));
app.post('/api/extractions/:id/mkdir', requireAuth, mutate((f, b) => makeFolder(f, b.path)));

app.get('/api/extractions/:id/file', requireAuth, (req, res, next) => {
  const e = getExtraction((req as Authed).sid, req.params.id);
  if (!e) return res.status(404).json({ error: 'Extraction expired or not found' });
  try { res.json(previewFile(e.files, req.query.path)); }
  catch (err) { err instanceof FileOpError ? res.status(400).json({ error: err.message }) : next(err); }
});

app.post('/api/push', requireAuth, (req, res) => {
  const a = req as Authed;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const e = typeof b.extractionId === 'string' ? getExtraction(a.sid, b.extractionId) : undefined;
  if (!e) return res.status(404).json({ error: 'Extraction expired or not found. Extract the ZIP again.' });
  if (typeof b.repo !== 'string' || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(b.repo)) return res.status(400).json({ error: 'Choose a repository first.' });
  if (!validBranch(b.branch)) return res.status(400).json({ error: 'Choose a valid branch first.' });
  const folder = typeof b.folder === 'string' ? b.folder.trim() : '';
  if (folder.length > 500 || folder.split('/').some((x) => x === '.git')) return res.status(400).json({ error: 'That destination folder is not allowed.' });
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message || message.length > 500) return res.status(400).json({ error: 'Enter a commit message (up to 500 characters).' });
  if (runningJob(a.sid)) return res.status(409).json({ error: 'An upload is already running. Wait for it to finish or cancel it.' });
  const onConflict = b.onConflict === 'skip' || b.onConflict === 'overwrite' ? b.onConflict : 'abort';
  const job = startJob(a.sid, { token: a.token, repo: b.repo, branch: b.branch, folder, message, onConflict, files: e.files }, typeof b.retryOf === 'string' ? b.retryOf : undefined);
  res.status(202).json(publicJob(job));
});
app.get('/api/push/:id', requireAuth, (req, res) => {
  const j = getJob((req as Authed).sid, req.params.id);
  j ? res.json(publicJob(j)) : res.status(404).json({ error: 'Upload not found' });
});
app.post('/api/push/:id/cancel', requireAuth, (req, res) => {
  const j = getJob((req as Authed).sid, req.params.id);
  if (!j) return res.status(404).json({ error: 'Upload not found' });
  if (j.status === 'running') j.ctl.abort();
  res.json(publicJob(j));
});

// Errors never include tokens: GitHubError messages contain only method + path.
app.use((err: Error, req: Request, res: Response, _n: NextFunction) => {
  if (err instanceof GitHubError) {
    if (err.status === 401) {
      const sid = req.cookies.gp_sid as string | undefined;
      deleteAllFor(sid); destroySession(sid); res.clearCookie('gp_sid', cookieOpts);
      return res.status(401).json({ error: 'GitHub rejected your sign-in. Connect GitHub again.' });
    }
    if (err.status === 429) return res.status(429).json({ error: 'GitHub rate limit reached. Try again in a minute.' });
    if (err.status === 403) return res.status(403).json({ error: 'GitHub refused the request. You may have hit a rate limit or lack access.' });
    if (err.status === 409) return res.status(409).json({ error: 'This repository is empty. Create a repository here, or add a first commit on GitHub.' });
    if (err.status === 422) return res.status(422).json({ error: 'GitHub rejected that. The name may already exist or be invalid.' });
    if (err.status === 404) return res.status(404).json({ error: 'GitHub could not find that, or you do not have access to it.' });
  }
  console.error(err.message);
  res.status(500).json({ error: 'Request failed' });
});

app.listen(config.port, () => console.log(`GitPush server on :${config.port}`));
