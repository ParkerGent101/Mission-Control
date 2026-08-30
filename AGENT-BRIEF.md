# AGENT-BRIEF — mission-control

Load this instead of the wiki when you are a local model (`localcoder`, `localreviewer`, Aider).
Deliberately short: paths, the gotchas that cost real time, and pointers — never the detail
itself. The long version lives in `C:\Users\Parker\Desktop\Wiki\wiki\`, and
`wiki/projects/mission-control.md` is the page that owns the detail.

## Repo location moved (2026-08-11)

The real repo is now `C:\Users\Parker\Desktop\Projects\Software\mission-control`. Branch `main`.
Remote `github.com/ParkerGent101/Mission-Control.git`. It used to live at
`C:\Users\Parker\projects\mission-control` — that path no longer exists; don't trust old notes
that cite it.

The nine sibling `.claude\worktrees\<name>\` checkouts that used to sit alongside this repo
(`budget-row-insert`, `deploy-memory-1gi`, `finance-drive-import`, `finance-sheet-override`,
`finance-tab-resolver`, `mealprep`, `mealprep-recipes`, `mealprep-trim`, `plaid-investments`) were
removed on 2026-08-11 — they were orphaned from the repo move (their `.git` pointer files still
referenced the old absolute path) and carried no uncommitted work. Their branches/commits are
still intact in this repo's refs if anyone needs to resurrect one; there is currently just the one
tree. If you find new `.claude\worktrees\` checkouts later, confirm which tree you are in before
your first edit — a worktree you did not create is read-and-build-from, **not** commit-into.

## Build and test, exactly

- Run: `python app.py`, or `start.bat`. Serves `http://localhost:5000`.
- **There is no test suite.** No pytest, no `package.json`, no `tests/`. Do not claim tests passed.
- The only automated check is `python scripts\jsx_check.py static\modules.jsx` — it drives Playwright +
  Chromium to run `Babel.transform` and exits 1 on a syntax error. **Playwright is not in
  `requirements.txt`**; if the check won't start, that is why, and installing it is a separate task.
- Housekeeping: `powershell -ExecutionPolicy Bypass -File scripts\clean.ps1` (add `-Apply` to act).
- Deploy is `powershell -ExecutionPolicy Bypass -File deploy.ps1`. **Not yours to run.** No CI exists —
  `.github/` holds only `dependabot.yml`.

## Rules that are decisions, not preferences

- **Every Flask route calls `require_auth()` first.** No exceptions.
- **Every `tool_*` function returns a plain string.** Not a dict, not JSON.
- **`_load(FILE, default)` and `_save(FILE, data)` are the only data primitives.** Do not open files
  directly.
- **A new env var means three edits, not one**: `deploy.ps1 --set-env-vars`, `.env.example`, and an
  `if VAR:` guard in code.
- **Never commit `.env`, `token.json`, `drive_token.json`, `credentials.json`.**
- **Google Sheets/Drive is the source of truth; `data/*.json` is cache and fallback.** Hand-editing a
  tracked `data/*.json` is not the fix. Ask before mass-normalising them.
- **`app.py` is one 4,239-line file.** Small targeted edits. A rewrite of a region is out of scope
  unless the task says so.
- Every Sheets/GCS call needs a local JSON fallback path.
- `gunicorn --workers 1` is deliberate — `--threads 8` was OOM-killed. Do not "optimise" it.

## Three claims in this repo's own docs that are false

Verified against code on 2026-08-03 (source: `wiki/projects/mission-control.md`). Believe the code.

1. `AGENTS.md` says there is **no frontend build step**. In production there is: the Dockerfile runs
   `node:20-slim` + `@babel/cli` and sets `PRECOMPILED_ASSETS=1`.
2. `CLAUDE.md` advertises the slash command `.claude\commands\review-before-deploy.md`. That directory
   exists and is **empty**.
3. `HANDOFF.md` is a stale May-2026 chat handoff — wrong module count, and it still names retired work.
   **Do not cite it for anything.**

Also stale, harmless unless you repeat it: `CLAUDE.md`'s "~2,500 lines", "22 tools", "31 JSON files".
Real: 4,239 lines, 18 registered schemas over 19 `tool_*` functions (`tool_edit_show` is unregistered
and uncallable), 30 JSON files. The Calendar, Practice, and Routines modules (and Google Calendar
OAuth) were removed 2026-08-11 — MealPrep was removed just before that, on 2026-08-05.

## Before you claim a task

Read `wiki/meta/agent-coordination.md` and do its four checks — board first, then `git branch -a`, then
worktree mtimes, then "does this task name a check I can run?" With no test suite here, the answer to
the fourth is usually the jsx check or nothing, and *nothing* means the task needs a human-defined
acceptance bar before it starts.

## Stop and escalate

- Anything touching `coming-up-aces` — this repo writes into it via its `push_site` tool. That is a
  two-repo change and belongs to a cloud lane or a human.
- Auth, deploy, or secrets. Password login is off (`ALLOW_PASSWORD_LOGIN=false`); it is Google
  sign-in with 2FA now.
- "Find out why" tasks. See `wiki/meta/agent-lanes.md` for the escalation rule and what to carry with
  you when you escalate.
