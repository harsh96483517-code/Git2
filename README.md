# GitPush Browser

ZIP -> extract -> browse -> push to GitHub in one commit.

## Architecture
- `server/` Node + Express + TypeScript. Holds the GitHub OAuth secret and tokens. The browser only gets an httpOnly session cookie, never a token.
- `web/` React + TS + Tailwind + Vite. Dev server proxies `/api` and `/auth` to the server.
- Upload path: ZIP (multer, memory) -> `zip.ts` safe extract -> `github.ts` blobs -> tree -> commit -> fast-forward ref.

## Phase status
| # | Phase | Status |
|---|-------|--------|
| 1 | Architecture | scaffolded, NOT yet run (no npm access in the build sandbox) |
| 2 | Premium UI | shell, welcome, home, upload picker, repo list, settings written, untested; other screens come with their features |
| 3 | ZIP extraction | yauzl extractor, `/api/zip/extract`, tree view in Upload screen written, untested |
| 4 | File manager | rename/delete/new folder/search/preview/copy path on extracted files, written, untested |
| 5 | GitHub OAuth | hardened: error redirects, session expiry UI, token revocation on sign-out, login limiter; written, untested |
| 6 | Repo/branch selection | repo list (300 max), create repo, branch list, create branch, folder picker, recents; written, untested |
| 7 | Upload/commit engine | `/api/push` jobs, progress polling, cancel, conflict choices, retry, commit link; written, untested |
| 8-10 | Security hardening, tests, deploy | not started |

## Run
1. Create a GitHub OAuth App; callback `http://localhost:8787/auth/callback`.
2. `cd server && cp .env.example .env` and fill it in.
3. `npm install && npm run dev`, then open `/health`.
4. In another terminal: `cd web && npm install && npm run dev`, open http://localhost:5173.

## GitHub OAuth notes
- Scopes requested: `repo` (push to public and private repos) and `workflow` (needed to push files under `.github/workflows`). Remove `workflow` in `server/src/index.ts` if you never push workflow files.
- Sign-out revokes only this app's token at GitHub (the user does not have to re-authorize the whole app next time).
- A fresh session id is issued on every login. Failed or cancelled sign-ins return to the app with a readable message.
- Set `TRUST_PROXY=1` only behind a single reverse proxy; otherwise the per-IP limiter sees the proxy's address.

## Upload behaviour
- One commit per upload, built with the Git Data API (blobs, tree, commit, fast-forward ref update). If any file fails, no commit is made and the branch is untouched.
- Files already in the repo with identical content are left alone; different content is a conflict you resolve (stop, skip, or overwrite).
- Retry reuses blobs already uploaded to the same repo. Cancel works until the final commit step begins.
- If the branch moves on GitHub during an upload the ref update is rejected (never forced) and nothing changes.
- Large files go through the JSON blob API as base64, so files near 100 MB may fail; GitHub recommends staying under 50 MB.
- Upload history is not stored yet (jobs are kept in memory for one hour).

## Known limits (to fix in later phases)
- OAuth uses the classic web flow with a `state` check; PKCE is not added yet.
- Sessions are in memory (lost on restart); move to SQLite in Phase 8.
- Extracted files are held in server memory (3 per session, 1 GB total, 1 hour). Move to disk if you need more.
- Encrypted ZIPs are rejected, not prompted for a password.
- Very large trees and folders (thousands of files) render slowly in the UI; virtualize later.
- File manager edits the server-side copy only; no multi-select or move-between-folders UI yet (rename to a new path moves a file).
- Existing empty repos (no commits) are not supported by the commit engine; repos created in the app start with a README.
- Repo and branch lists are capped at 300 items; the folder suggestions at 500.
