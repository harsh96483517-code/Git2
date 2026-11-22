import { useEffect, useMemo, useState, type DragEvent, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { api, setUnauthorizedHandler, deletePath, discardExtraction, extractZip, makeFolder, previewFile, renamePath, type Extraction, type Item, type Me, type Preview, type Repo, type Branch, type Dest, type PushJob, cancelPush, getPush, startPush, createBranch, createRepo, listBranches, listFolders } from './api';
import { applyTheme, getTheme, type Theme } from './theme';

type View = 'home' | 'upload' | 'files' | 'repos' | 'settings';
const MAX_ZIP = 200 * 1024 * 1024;
const AUTH_MSG: Record<string, string> = {
  denied: 'GitHub sign-in was cancelled. Connect GitHub when you are ready.',
  state: 'We could not verify that sign-in. Please try connecting again.',
  failed: 'GitHub sign-in failed. Please try connecting again.'
};
// Read once at load: GitHub sends failed sign-ins back as ?auth_error=...
const AUTH_ERR = new URLSearchParams(location.search).get('auth_error');
if (AUTH_ERR) history.replaceState(null, '', location.pathname);
const ICON: Record<string, string> = {
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  upload: 'M12 16V4m0 0L8 8m4-4l4 4M4 20h16',
  files: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  repos: 'M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM9 4v16',
  settings: 'M4 7h9m4 0h3M4 12h3m4 0h9M4 17h11m4 0h1'
};
const NAV: { id: View; label: string }[] = [
  { id: 'home', label: 'Home' }, { id: 'upload', label: 'Upload' }, { id: 'files', label: 'Files' }, { id: 'repos', label: 'Repositories' }, { id: 'settings', label: 'Settings' }
];
const Icon = ({ name }: { name: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[name]} /></svg>
);
const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [view, setView] = useState<View>('home');
  const [items, setItems] = useState<Item[]>([]);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repoErr, setRepoErr] = useState('');
  const [dest, setDest] = useState<Dest | null>(null);
  const [notice, setNotice] = useState(AUTH_ERR ? AUTH_MSG[AUTH_ERR] ?? AUTH_MSG.failed : '');

  useEffect(() => { api<Me>('/api/me').then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => {
    if (!me) return;
    api<Repo[]>('/api/repos').then(setRepos).catch((e: Error) => setRepoErr(e.message));
  }, [me]);

  useEffect(() => {
    setUnauthorizedHandler(() => { setMe(null); setRepos(null); setDest(null); setItems([]); setNotice('Your session expired. Connect GitHub again to continue.'); });
    return () => setUnauthorizedHandler(null);
  }, []);

  if (me === undefined) return <div className="mx-auto max-w-md p-8"><div className="skeleton h-48" /></div>;
  if (me === null) return <Welcome notice={notice} />;

  const signOut = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); setMe(null); setRepos(null); setDest(null); setItems([]); setNotice(''); };
  const screen: Record<View, ReactNode> = {
    home: <Home me={me} zips={items.length} repos={repos?.length} go={setView} />,
    upload: <Upload items={items} setItems={setItems} dest={dest} go={setView} />,
    files: <Files items={items} setItems={setItems} go={setView} />,
    repos: <Repos repos={repos} error={repoErr} dest={dest} setDest={setDest} onCreated={(r) => setRepos((c) => [r, ...(c ?? [])])} />,
    settings: <Settings me={me} signOut={signOut} />
  };

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 p-4 md:block">
        <div className="glass flex h-full flex-col gap-1 rounded-[28px] p-3">
          <div className="px-3 pb-4 pt-3 text-lg font-bold tracking-tight">GitPush Browser</div>
          {NAV.map((n) => (
            <button key={n.id} className="nav-item" aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}><Icon name={n.id} />{n.label}</button>
          ))}
          <div className="mt-auto flex items-center gap-3 px-3 py-2">
            <img src={me.avatar} alt="" className="h-9 w-9 rounded-full" /><span className="truncate text-sm font-semibold">{me.login}</span>
          </div>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-3xl flex-1 p-5 pb-32 md:p-10">{screen[view]}</main>
      <nav className="glass fixed inset-x-3 z-10 flex justify-around rounded-full p-1.5 md:hidden" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }} aria-label="Main">
        {NAV.map((n) => (
          <button key={n.id} className="nav-item flex-col !gap-0.5 !px-3 !py-1.5 text-[11px]" aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}><Icon name={n.id} />{n.label === 'Repositories' ? 'Repos' : n.label}</button>
        ))}
      </nav>
    </div>
  );
}

function Welcome({ notice }: { notice: string }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 p-6">
      <div className="glass rounded-[36px] p-8 md:p-12">
        <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">Drop a ZIP. Land it on GitHub.</h1>
        <p className="muted mt-4 text-lg">Extract an archive, check what is inside, and push every file to the repository and branch you choose in a single commit.</p>
        {notice && <p role="alert" className="mt-6 rounded-3xl p-4 text-sm glass-strong" style={{ color: 'var(--danger)' }}>{notice}</p>}
        <a href="/auth/login" className="btn btn-accent mt-8 inline-flex">Connect GitHub</a>
        <p className="muted mt-4 text-sm">Your GitHub token stays on the server. The browser never sees it.</p>
      </div>
    </div>
  );
}

function Home({ me, zips, repos, go }: { me: Me; zips: number; repos?: number; go: (v: View) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Hi, {me.login}</h1>
      <div className="glass rounded-[32px] p-7">
        <p className="text-xl font-semibold">Ready to push a project?</p>
        <p className="muted mt-1">Start by choosing the ZIP you want to send to GitHub.</p>
        <button className="btn btn-accent mt-5" onClick={() => go('upload')}>Choose a ZIP</button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="glass rounded-[24px] p-5"><div className="text-3xl font-bold">{repos ?? '–'}</div><div className="muted text-sm">repositories you can push to</div></div>
        <div className="glass rounded-[24px] p-5"><div className="text-3xl font-bold">{zips}</div><div className="muted text-sm">ZIP files selected</div></div>
      </div>
    </div>
  );
}

type Setter = Dispatch<SetStateAction<Item[]>>;

function Upload({ items, setItems, dest, go }: { items: Item[]; setItems: Setter; dest: Dest | null; go: (v: View) => void }) {
  const [over, setOver] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const add = (list: FileList | File[]) => {
    const ok: Item[] = [], bad: string[] = [];
    for (const f of Array.from(list)) {
      if (!f.name.toLowerCase().endsWith('.zip')) bad.push(`${f.name} is not a .zip file`);
      else if (f.size > MAX_ZIP) bad.push(`${f.name} is larger than ${fmt(MAX_ZIP)}`);
      else ok.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f, state: 'idle' });
    }
    setErrors(bad);
    setItems((cur) => [...cur, ...ok]);
  };
  const patch = (key: string, p: Partial<Item>) => setItems((cur) => cur.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const run = async (it: Item) => {
    patch(it.key, { state: 'busy', error: undefined });
    try { patch(it.key, { state: 'done', result: await extractZip(it.file) }); }
    catch (e) { patch(it.key, { state: 'error', error: (e as Error).message }); }
  };
  const remove = (it: Item) => {
    if (it.result) discardExtraction(it.result.id).catch(() => undefined);
    setItems((cur) => cur.filter((x) => x.key !== it.key));
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); };
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl font-bold tracking-tight">Upload ZIP files</h1>
      <label className="drop glass flex cursor-pointer flex-col items-center gap-3 rounded-[32px] p-10 text-center" data-over={over} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <Icon name="upload" />
        <span className="text-lg font-semibold">Drop ZIP files here or tap to browse</span>
        <span className="muted text-sm">Up to {fmt(MAX_ZIP)} each</span>
        <input type="file" accept=".zip,application/zip" multiple className="sr-only" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
      </label>
      {errors.map((m) => <p key={m} role="alert" className="px-2 text-sm" style={{ color: 'var(--danger)' }}>{m}</p>)}
      {items.length === 0 ? <p className="muted px-2">No ZIP files yet.</p> : (
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <li key={it.key} className="glass rounded-[28px] p-2 pl-5">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 py-1"><span className="block truncate font-semibold">{it.file.name}</span><span className="muted text-xs">{fmt(it.file.size)}</span></span>
                <span className="flex shrink-0 gap-2">
                  {it.state !== 'done' && <button className="btn btn-accent !py-1.5" disabled={it.state === 'busy'} onClick={() => run(it)}>{it.state === 'busy' ? 'Extracting…' : it.state === 'error' ? 'Try again' : 'Extract'}</button>}
                  <button className="btn !py-1.5" onClick={() => remove(it)}>Remove</button>
                </span>
              </div>
              {it.state === 'error' && <p role="alert" className="px-1 pb-2 pt-1 text-sm" style={{ color: 'var(--danger)' }}>{it.error}</p>}
              {it.result && (
                <div className="flex flex-wrap items-center gap-2 px-1 pb-1 pt-2">
                  {dest
                    ? <><button className="btn btn-accent" onClick={() => setPushing(it.key)}>Upload to GitHub</button><span className="muted min-w-0 truncate text-xs">{dest.repo} · {dest.branch}{dest.folder ? ` · ${dest.folder}` : ''}</span></>
                    : <button className="btn" onClick={() => go('repos')}>Choose a destination first</button>}
                </div>
              )}
              {it.result && <Extracted ex={it.result} />}
            </li>
          ))}
        </ul>
      )}
      <p className="muted px-2 text-sm">Extracted ZIPs are held on the server for one hour, then deleted.</p>
      {(() => { const pit = items.find((x) => x.key === pushing); return pit && pit.result && dest ? <Push item={pit} dest={dest} onClose={() => setPushing(null)} /> : null; })()}
    </div>
  );
}

function Push({ item, dest, onClose }: { item: Item; dest: Dest; onClose: () => void }) {
  const ex = item.result!;
  const [message, setMessage] = useState(`Add files from ${item.file.name}`);
  const [policy, setPolicy] = useState<'abort' | 'skip' | 'overwrite'>('abort');
  const [job, setJob] = useState<PushJob | null>(null);
  const [err, setErr] = useState('');
  const [starting, setStarting] = useState(false);
  const jid = job?.id, running = job?.status === 'running';

  useEffect(() => {
    if (!jid || !running) return;
    const t = setInterval(() => { getPush(jid).then(setJob, (e: Error) => setJob((j) => (j ? { ...j, status: 'failed', error: e.message } : j))); }, 700);
    return () => clearInterval(t);
  }, [jid, running]);

  const start = async (p = policy, retryOf?: string) => {
    setStarting(true); setErr('');
    try { setJob(await startPush({ extractionId: ex.id, repo: dest.repo, branch: dest.branch, folder: dest.folder, message: message.trim(), onConflict: p, retryOf })); }
    catch (e) { setErr((e as Error).message); } finally { setStarting(false); }
  };
  const list = (xs: string[] = []) => <ul className="mt-2 max-h-40 overflow-auto rounded-2xl p-3 text-xs glass-strong">{xs.slice(0, 8).map((x) => <li key={x} className="truncate">{x}</li>)}{xs.length > 8 && <li className="muted">and {xs.length - 8} more</li>}</ul>;
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  const where = `${dest.repo} · ${dest.branch}${dest.folder ? ` · ${dest.folder}` : ''}`;

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Upload to GitHub">
      <div className="glass glass-strong max-h-[90dvh] w-full max-w-md overflow-auto rounded-[28px] p-6">
        <h2 className="text-xl font-bold">Upload to GitHub</h2>
        <p className="muted mt-1 truncate text-sm">{ex.fileCount} {ex.fileCount === 1 ? 'file' : 'files'} → {where}</p>
        {!job && (
          <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void start(); }}>
            <label className="text-sm font-semibold" htmlFor="gp-msg">Commit message</label>
            <textarea id="gp-msg" className="field !rounded-3xl" rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
            <fieldset className="flex flex-col gap-1.5 text-sm">
              <legend className="mb-1 font-semibold">If a file already exists</legend>
              {([['abort', 'Stop and show me which files'], ['skip', 'Skip files that already exist'], ['overwrite', 'Overwrite existing files']] as const).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2"><input type="radio" name="policy" checked={policy === v} onChange={() => setPolicy(v)} />{label}</label>
              ))}
            </fieldset>
            {err && <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>{err}</p>}
            <div className="mt-2 flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-accent" disabled={starting || !message.trim()}>{starting ? 'Starting…' : 'Upload'}</button></div>
          </form>
        )}
        {job?.status === 'running' && (
          <div className="mt-4">
            <div className="h-3 overflow-hidden rounded-full glass-strong" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)', transition: 'width .3s' }} /></div>
            <p className="mt-2 text-sm" role="status">{job.total ? `Uploaded ${job.done} of ${job.total} files` : 'Checking the repository…'}</p>
            <div className="mt-4 flex justify-end"><button className="btn" onClick={() => void cancelPush(job.id).then(setJob, () => undefined)}>Cancel upload</button></div>
          </div>
        )}
        {job?.status === 'done' && (
          <div className="mt-4">
            <p className="font-semibold" style={{ color: 'var(--ok)' }}>Committed {job.uploaded} {job.uploaded === 1 ? 'file' : 'files'}.</p>
            {!!job.unchanged && <p className="muted mt-1 text-sm">{job.unchanged} already in the repository with the same content.</p>}
            {!!job.skipped?.length && <p className="muted mt-1 text-sm">{job.skipped.length} existing {job.skipped.length === 1 ? 'file was' : 'files were'} skipped.</p>}
            <div className="mt-4 flex justify-end gap-2"><button className="btn" onClick={onClose}>Close</button><a className="btn btn-accent" href={job.commitUrl} target="_blank" rel="noopener noreferrer">View commit on GitHub</a></div>
          </div>
        )}
        {job?.status === 'conflict' && (
          <div className="mt-4">
            <p className="font-semibold">{job.conflicts?.length} {job.conflicts?.length === 1 ? 'file already exists' : 'files already exist'} with different content.</p>
            {list(job.conflicts)}
            <p className="muted mt-2 text-sm">Nothing was uploaded. Choose what to do:</p>
            <div className="mt-3 flex flex-wrap justify-end gap-2"><button className="btn" onClick={onClose}>Cancel</button><button className="btn" onClick={() => { setPolicy('skip'); void start('skip', job.id); }}>Skip existing</button><button className="btn btn-accent" onClick={() => { setPolicy('overwrite'); void start('overwrite', job.id); }}>Overwrite existing</button></div>
          </div>
        )}
        {job?.status === 'failed' && (
          <div className="mt-4">
            <p role="alert" style={{ color: 'var(--danger)' }}>{job.error}</p>
            {!!job.failed?.length && list(job.failed)}
            {err && <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger)' }}>{err}</p>}
            <div className="mt-4 flex justify-end gap-2"><button className="btn" onClick={onClose}>Close</button><button className="btn btn-accent" disabled={starting} onClick={() => void start(policy, job.id)}>Retry</button></div>
          </div>
        )}
        {job?.status === 'cancelled' && (
          <div className="mt-4"><p>Upload cancelled. Nothing was committed.</p><div className="mt-4 flex justify-end gap-2"><button className="btn" onClick={onClose}>Close</button><button className="btn btn-accent" onClick={() => void start(policy, job.id)}>Start again</button></div></div>
        )}
      </div>
    </div>
  );
}

interface TNode { name: string; size: number; file: boolean; kids: Map<string, TNode> }
function buildTree(files: Extraction['files']): TNode {
  const root: TNode = { name: '', size: 0, file: false, kids: new Map() };
  for (const f of files) {
    let n = root;
    const parts = f.path.split('/');
    parts.forEach((p, i) => {
      let c = n.kids.get(p);
      if (!c) { c = { name: p, size: 0, file: i === parts.length - 1, kids: new Map() }; n.kids.set(p, c); }
      c.size += f.size;
      n = c;
    });
  }
  return root;
}

function Branch({ node, depth }: { node: TNode; depth: number }) {
  const kids = [...node.kids.values()].sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
  return (
    <ul className={depth ? 'ml-4 border-l pl-3' : ''} style={{ borderColor: 'var(--edge)' }}>
      {kids.map((k) => k.file ? (
        <li key={k.name} className="flex justify-between gap-3 py-0.5 text-sm"><span className="truncate">{k.name}</span><span className="muted shrink-0">{fmt(k.size)}</span></li>
      ) : (
        <li key={k.name}>
          <details open={depth < 1}>
            <summary className="flex cursor-pointer justify-between gap-3 py-0.5 text-sm font-semibold"><span className="truncate">{k.name}/</span><span className="muted shrink-0 font-normal">{fmt(k.size)}</span></summary>
            <Branch node={k} depth={depth + 1} />
          </details>
        </li>
      ))}
    </ul>
  );
}

function Extracted({ ex }: { ex: Extraction }) {
  const tree = useMemo(() => buildTree(ex.files), [ex]);
  return (
    <div className="mt-1 rounded-3xl p-3 glass-strong">
      <p className="mb-2 text-sm font-semibold" style={{ color: 'var(--ok)' }}>Extracted {ex.fileCount} {ex.fileCount === 1 ? 'file' : 'files'} · {fmt(ex.totalBytes)}</p>
      <div className="max-h-80 overflow-auto"><Branch node={tree} depth={0} /></div>
    </div>
  );
}

interface Row { name: string; path: string; dir: boolean; size: number; count: number }
type Modal = { kind: 'rename' | 'mkdir' | 'delete'; path: string; dir: boolean };
const NO_FILES: Extraction['files'] = [];
const under = (p: string, dir: string) => p === dir || p.startsWith(dir + '/');

function Files({ items, setItems, go }: { items: Item[]; setItems: Setter; go: (v: View) => void }) {
  const done = items.filter((i) => i.result);
  const [sel, setSel] = useState('');
  const item = done.find((i) => i.key === sel) ?? done[0];
  const ex = item?.result;
  const files = ex?.files ?? NO_FILES;
  const [cwd, setCwd] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [pv, setPv] = useState<{ path: string; data?: Preview; error?: string } | null>(null);

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    if (needle) return files.filter((f) => f.path.toLowerCase().includes(needle)).slice(0, 200).map((f) => ({ name: f.path, path: f.path, dir: false, size: f.size, count: 1 }));
    const m = new Map<string, Row>();
    const prefix = cwd ? cwd + '/' : '';
    for (const f of files) {
      if (!f.path.startsWith(prefix)) continue;
      const rest = f.path.slice(prefix.length), i = rest.indexOf('/');
      const name = i < 0 ? rest : rest.slice(0, i);
      const r = m.get(name) ?? { name, path: prefix + name, dir: i >= 0, size: 0, count: 0 };
      r.size += f.size; r.count++; m.set(name, r);
    }
    return [...m.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  }, [files, cwd, q]);

  if (!ex || !item) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-3xl font-bold tracking-tight">Files</h1>
        <div className="glass rounded-[32px] p-7"><p className="text-lg font-semibold">Nothing to manage yet</p><p className="muted mt-1">Extract a ZIP to browse, rename, and clean up its files here.</p><button className="btn btn-accent mt-5" onClick={() => go('upload')}>Go to Upload</button></div>
      </div>
    );
  }

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(''), 2500); };
  const open = (m: Modal, v = '') => { setModal(m); setVal(v); setErr(''); };
  const apply = async (fn: () => Promise<Extraction>) => {
    setBusy(true); setErr('');
    try {
      const r = await fn();
      setItems((cur) => cur.map((x) => (x.key === item.key ? { ...x, result: r } : x)));
      if (cwd && !r.files.some((f) => f.path.startsWith(cwd + '/'))) setCwd('');
      setModal(null); setPv(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const submit = () => {
    if (!modal) return;
    if (modal.kind === 'delete') void apply(() => deletePath(ex.id, modal.path));
    else if (modal.kind === 'rename') void apply(() => renamePath(ex.id, modal.path, val.trim()));
    else void apply(() => makeFolder(ex.id, val.trim()));
  };
  const copy = (p: string) => (navigator.clipboard?.writeText(p) ?? Promise.reject(new Error('no clipboard'))).then(() => flash('Path copied'), () => flash('Could not copy. Select the path instead.'));
  const view = (path: string) => { setPv({ path }); previewFile(ex.id, path).then((data) => setPv({ path, data }), (e: Error) => setPv({ path, error: e.message })); };
  const crumbs = cwd ? cwd.split('/') : [];
  const delCount = modal?.kind === 'delete' ? files.filter((f) => under(f.path, modal.path)).length : 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold tracking-tight">Files</h1>
      {done.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Extracted ZIP">
          {done.map((i) => <button key={i.key} className={`btn !py-1.5 ${i.key === item.key ? 'btn-accent' : ''}`} aria-pressed={i.key === item.key} onClick={() => { setSel(i.key); setCwd(''); setQ(''); setPv(null); }}>{i.file.name}</button>)}
        </div>
      )}
      <div className="flex gap-2">
        <input className="field" placeholder="Search files" aria-label="Search files" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn shrink-0" onClick={() => open({ kind: 'mkdir', path: '', dir: true }, cwd ? cwd + '/' : '')}>New folder</button>
      </div>
      {!q && (
        <nav className="flex flex-wrap items-center gap-1 px-2 text-sm" aria-label="Folder path">
          <button className="font-semibold underline-offset-2 hover:underline" onClick={() => setCwd('')}>{ex.name}</button>
          {crumbs.map((c, i) => <span key={i} className="flex items-center gap-1"><span className="muted">/</span><button className="font-semibold hover:underline" onClick={() => setCwd(crumbs.slice(0, i + 1).join('/'))}>{c}</button></span>)}
        </nav>
      )}
      <p role="status" className="px-2 text-sm" style={{ color: 'var(--ok)', minHeight: '1.25rem' }}>{note}</p>
      {rows.length === 0 ? <p className="muted px-2">{q ? 'No files match your search.' : 'This folder is empty.'}</p> : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.path} className="glass flex flex-wrap items-center justify-between gap-2 rounded-[24px] py-2 pl-5 pr-2">
              <button className="min-w-0 flex-1 py-1 text-left" onClick={() => (r.dir ? (setCwd(r.path), setQ('')) : view(r.path))}>
                <span className="block truncate font-semibold">{r.dir ? `${r.name}/` : r.name}</span>
                <span className="muted text-xs">{r.dir ? `${r.count} ${r.count === 1 ? 'file' : 'files'}` : r.name.includes('.') ? r.name.split('.').pop()!.toLowerCase() : 'file'} · {fmt(r.size)}</span>
              </button>
              <span className="flex gap-1.5">
                <button className="btn !px-3 !py-1 !text-sm" onClick={() => open({ kind: 'rename', path: r.path, dir: r.dir }, r.path)}>Rename</button>
                <button className="btn !px-3 !py-1 !text-sm" onClick={() => copy(r.path)}>Copy path</button>
                <button className="btn !px-3 !py-1 !text-sm" onClick={() => open({ kind: 'delete', path: r.path, dir: r.dir })}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {pv && (
        <div className="glass rounded-[28px] p-4">
          <div className="mb-2 flex items-center justify-between gap-3"><span className="truncate font-semibold">{pv.path}</span><button className="btn !py-1" onClick={() => setPv(null)}>Close</button></div>
          {pv.error ? <p role="alert" style={{ color: 'var(--danger)' }}>{pv.error}</p>
            : !pv.data ? <div className="skeleton h-24" />
            : pv.data.kind === 'image' ? <img src={pv.data.dataUrl} alt={pv.path} className="max-h-96 max-w-full rounded-2xl" />
            : pv.data.kind === 'none' ? <p className="muted">{pv.data.reason}</p>
            : <><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-2xl p-3 text-xs glass-strong">{pv.data.text || '(empty file)'}</pre>{pv.data.truncated && <p className="muted mt-2 text-xs">Showing the first 200 KB.</p>}</>}
        </div>
      )}
      {modal && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-modal="true" onKeyDown={(e) => e.key === 'Escape' && setModal(null)}>
          <form className="glass glass-strong w-full max-w-md rounded-[28px] p-6" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <h2 className="text-xl font-bold">{modal.kind === 'delete' ? `Delete ${modal.path}?` : modal.kind === 'mkdir' ? 'New folder' : `Rename ${modal.dir ? 'folder' : 'file'}`}</h2>
            {modal.kind === 'delete'
              ? <p className="muted mt-2">This removes {delCount} {delCount === 1 ? 'file' : 'files'} from this extraction. Nothing on GitHub changes.</p>
              : <><input autoFocus className="field mt-4" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Path" />{modal.kind === 'mkdir' && <p className="muted mt-2 text-xs">Git cannot store empty folders, so an empty .gitkeep file is added inside.</p>}</>}
            {err && <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>{err}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-accent" disabled={busy || (modal.kind !== 'delete' && !val.trim())} style={modal.kind === 'delete' ? { background: 'var(--danger)' } : undefined}>{busy ? 'Working…' : modal.kind === 'delete' ? 'Delete' : modal.kind === 'mkdir' ? 'Create folder' : 'Rename'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const RECENT_KEY = 'gp_recent_repos';
const loadRecent = (): string[] => {
  try { const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5) : []; } catch { return []; }
};
const saveRecent = (r: string[]) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch { /* storage unavailable */ } };

function Dialog({ title, confirm, busy, error, disabled, onSubmit, onCancel, children }: { title: string; confirm: string; busy: boolean; error: string; disabled: boolean; onSubmit: () => void; onCancel: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <form className="glass glass-strong w-full max-w-md rounded-[28px] p-6" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <h2 className="text-xl font-bold">{title}</h2>
        {children}
        {error && <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-accent" disabled={busy || disabled}>{busy ? 'Working…' : confirm}</button>
        </div>
      </form>
    </div>
  );
}

function Repos({ repos, error, dest, setDest, onCreated }: { repos: Repo[] | null; error: string; dest: Dest | null; setDest: Dispatch<SetStateAction<Dest | null>>; onCreated: (r: Repo) => void }) {
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [br, setBr] = useState<{ list: Branch[]; loading: boolean; error: string }>({ list: [], loading: false, error: '' });
  const [folders, setFolders] = useState<string[]>([]);
  const [dlg, setDlg] = useState<'repo' | 'branch' | null>(null);
  const [name, setName] = useState('');
  const [priv, setPriv] = useState(true);
  const [busy, setBusy] = useState(false);
  const [derr, setDerr] = useState('');
  const repoName = dest?.repo, branch = dest?.branch;

  useEffect(() => {
    if (!repoName) return;
    let live = true;
    setBr({ list: [], loading: true, error: '' });
    (async () => {
      try {
        let list = await listBranches(repoName);
        // A repository created a moment ago can take a second to get its first branch.
        for (let i = 0; i < 3 && list.length === 0 && live; i++) { await new Promise((r) => setTimeout(r, 1200)); list = await listBranches(repoName); }
        if (live) setBr({ list, loading: false, error: list.length ? '' : 'This repository has no branches yet. Add a first commit on GitHub, then select it again.' });
      } catch (e) { if (live) setBr({ list: [], loading: false, error: (e as Error).message }); }
    })();
    return () => { live = false; };
  }, [repoName]);

  useEffect(() => {
    if (!repoName || !branch) { setFolders([]); return; }
    let live = true;
    listFolders(repoName, branch).then((r) => { if (live) setFolders(r.folders); }, () => { if (live) setFolders([]); });
    return () => { live = false; };
  }, [repoName, branch]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(needle));
    if (needle) return list;
    const rank = (r: Repo) => { const i = recent.indexOf(r.fullName); return i < 0 ? 99 : i; };
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [repos, q, recent]);

  const choose = (r: Repo) => {
    if (!r.canPush) return;
    setDest({ repo: r.fullName, branch: r.defaultBranch, folder: '' });
    const next = [r.fullName, ...recent.filter((x) => x !== r.fullName)].slice(0, 5);
    setRecent(next); saveRecent(next);
  };
  const openDlg = (k: 'repo' | 'branch') => { setDlg(k); setName(''); setDerr(''); setPriv(true); };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setDerr('');
    try { await fn(); setDlg(null); } catch (e) { setDerr((e as Error).message); } finally { setBusy(false); }
  };
  const submit = () => run(async () => {
    if (dlg === 'repo') { const r = await createRepo(name.trim(), priv); onCreated(r); choose(r); }
    else if (dest) { const b = await createBranch(dest.repo, name.trim(), dest.branch); setBr((s) => ({ ...s, list: [...s.list, b] })); setDest({ ...dest, branch: b.name }); }
  });
  const current = br.list.find((b) => b.name === branch);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Repositories</h1>
        <button className="btn shrink-0" onClick={() => openDlg('repo')}>New repository</button>
      </div>
      {dest && (
        <div className="glass flex flex-col gap-3 rounded-[28px] p-5">
          <div><p className="muted text-sm">Push destination</p><p className="truncate text-lg font-semibold">{dest.repo}</p></div>
          {br.loading ? <div className="skeleton h-11" /> : br.error ? <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>{br.error}</p> : (
            <div className="flex gap-2">
              <select className="field" aria-label="Branch" value={dest.branch} onChange={(e) => setDest({ ...dest, branch: e.target.value })}>
                {br.list.map((b) => <option key={b.name} value={b.name}>{b.name}{b.protected ? ' (protected)' : ''}</option>)}
              </select>
              <button className="btn shrink-0" onClick={() => openDlg('branch')}>New branch</button>
            </div>
          )}
          {current?.protected && <p className="text-sm" style={{ color: 'var(--danger)' }}>This branch is protected, so a direct push may be rejected. Create a new branch to be safe.</p>}
          <input className="field" list="gp-folders" placeholder="Folder in the repository (empty = root)" aria-label="Destination folder" value={dest.folder} onChange={(e) => setDest({ ...dest, folder: e.target.value.replace(/\\/g, '/').replace(/^\/+/, '') })} />
          <datalist id="gp-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
        </div>
      )}
      <input className="field" placeholder="Search repositories" aria-label="Search repositories" value={q} onChange={(e) => setQ(e.target.value)} />
      {error ? <p role="alert" className="glass rounded-3xl p-5" style={{ color: 'var(--danger)' }}>Could not load repositories: {error}. Reload the page to try again.</p>
        : repos === null ? <div className="flex flex-col gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-16" />)}</div>
        : shown.length === 0 ? <p className="muted px-2">{q ? 'No repositories match your search.' : 'You have no repositories yet. Create one to get started.'}</p>
        : <ul className="flex flex-col gap-3">{shown.map((r) => (
          <li key={r.fullName}>
            <button className="glass flex w-full items-center justify-between gap-3 rounded-full px-5 py-3 text-left disabled:opacity-50" disabled={!r.canPush} aria-pressed={dest?.repo === r.fullName} style={dest?.repo === r.fullName ? { outline: '2px solid var(--accent)' } : undefined} onClick={() => choose(r)}>
              <span className="truncate font-semibold">{r.fullName}</span>
              <span className="muted shrink-0 text-xs">{r.archived ? 'Archived' : !r.canPush ? 'Read-only' : `${recent.includes(r.fullName) ? 'Recent · ' : ''}${r.private ? 'Private' : 'Public'} · ${r.defaultBranch}`}</span>
            </button>
          </li>))}</ul>}
      {dlg && (
        <Dialog title={dlg === 'repo' ? 'New repository' : `New branch from ${dest?.branch}`} confirm={dlg === 'repo' ? 'Create repository' : 'Create branch'} busy={busy} error={derr} disabled={!name.trim()} onSubmit={submit} onCancel={() => setDlg(null)}>
          <input autoFocus className="field mt-4" value={name} onChange={(e) => setName(e.target.value)} placeholder={dlg === 'repo' ? 'my-project' : 'feature/new-files'} aria-label="Name" />
          {dlg === 'repo' && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />Private repository</label>}
          {dlg === 'repo' && <p className="muted mt-2 text-xs">It starts with a README so there is a branch to push to.</p>}
        </Dialog>
      )}
    </div>
  );
}

function Settings({ me, signOut }: { me: Me; signOut: () => void }) {
  const [theme, setTheme] = useState<Theme>(getTheme());
  const pick = (t: Theme) => { setTheme(t); applyTheme(t); };
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      <div className="glass flex items-center gap-4 rounded-[28px] p-5">
        <img src={me.avatar} alt="" className="h-12 w-12 shrink-0 rounded-full" />
        <div className="min-w-0"><p className="truncate font-semibold">{me.login}</p><p className="muted text-sm">GitPush can read and write your repositories and workflow files so it can push your ZIPs. Signing out revokes its GitHub token.</p></div>
      </div>
      <div className="glass rounded-[28px] p-5">
        <p className="mb-3 font-semibold">Appearance</p>
        <div className="flex gap-2" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} className={`btn ${theme === t ? 'btn-accent' : ''}`} aria-pressed={theme === t} onClick={() => pick(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </div>
      <button className="btn self-start" onClick={signOut}>Sign out</button>
    </div>
  );
}
