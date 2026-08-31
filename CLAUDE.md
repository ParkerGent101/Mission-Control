# Mission Control — Claude Code Agent Context

## What this project is
Parker's personal **finance** app. One job: keep a Google Sheet of monthly budgets and
transactions honest against Rocket Money, and answer four questions a spreadsheet can't —
am I about to blow a category, what's still going out this month, what am I worth, and
where is spending drifting.

Live at https://mission-control-568559213462.us-central1.run.app (Google sign-in + 2FA;
password login is off in production).

**It used to be a multi-purpose "AI command center"** covering Band, Health, TCPG, tasks,
reminders and an agenda, with a Claude agent routing voice/text to modules. All of that was
removed on 2026-08-30, along with a Warhammer-40k UI skin. Don't reintroduce any of it, and
distrust older notes that describe it. The last multi-purpose commit is tagged
`pre-finance-only`.

## Tech stack
- Backend: Python/Flask — `app.py`, **3,300 lines**, 48 routes, all finance/auth/Drive
- Frontend: React 18 + ReactDOM from unpkg (UMD). **There IS a build step in production**:
  the Dockerfile's first stage runs `@babel/cli` + `@babel/preset-react` over `static/*.jsx`
  and sets `PRECOMPILED_ASSETS=1` so the image serves plain `.js`. Localhost leaves that
  unset and transpiles in-browser with `@babel/standalone` — that's the no-build dev path.
- Storage: JSON in `data/` (10 files), backed by a GCS bucket on Cloud Run
- **No LLM.** The `anthropic` dependency, the agent loop and all 19 `tool_*` functions are gone.
- Fonts: IBM Plex Sans/Mono. Colours: oklch.

## GCP infrastructure
- Project `mission-control-496004`, Cloud Run service `mission-control`, region `us-central1`
- GCS bucket `parker-mission-control-data`, mounted at `/data`
- Secret Manager: **`flask-secret` is the only secret that exists.** `anthropic-api-key`,
  `github-token`, `plaid-client-id` and `plaid-secret` were deleted 2026-08-30.
- Finance Sheet ID: `1UaFkSQ3wwrPt6pfZIfnNrlMQmerv-ZQ52KYyCF5rIvo`
- Deploy: `powershell -ExecutionPolicy Bypass -File deploy.ps1 -SkipData` (the only deploy
  path; `deploy.sh` was deleted — it still set `min-instances 1`, 512Mi, and password login).
  **Use `-SkipData`** unless you actually mean to overwrite live bucket data with local files.
- The data bucket holds 10 finance/auth files. A pre-cleanup backup of everything removed is in
  `..\mission-control-archive-2026-08-30\`.

## Key files
| File | What it is |
|---|---|
| `app.py` | Every route, the Sheet parsers, the Rocket Money reconcile, Drive/Sheets OAuth, GCS helpers |
| `static/finance-core.jsx` | Shared helpers, categories, budget-pace maths, `useFinanceData`, `Panel`/`PaceBar`/`MiniLine` |
| `static/finance-{overview,transactions,bills,accounts,trends}.jsx` | One file per tab |
| `static/app.jsx` | Shell: tabs, the month stepper, toasts, the 3-min refresh |
| `static/settings.jsx` | Connections (Drive/Sheets) + Data. No themes, no profile. |
| `templates/index.html` | The whole stylesheet |
| `static/_harness.html` | Dev-only: renders every view against fixtures, no Sheet and no login needed. Excluded from the image. |

## The data model
**Rocket Money is the point of truth; the Sheet reconciles to it.** `/api/finance/import/drive`
reads the newest Rocket Money CSV export from a Drive folder and makes the month tab match it:
adds new charges, updates changed amounts in place, drops rows a previous sync wrote that the
export no longer has. Do **not** reintroduce fingerprint-only dedup — Rocket Money rewrites a
charge's date/amount/name after it posts, which is what caused duplicate rows before.

A Sheet row is a **template row Parker maintains** (leave it alone unless a charge matches it)
when it carries a category label, account, due date or budgeted amount. A row with only a
description + actual is import output the sync owns.

New months are created by rolling over from an existing month tab, not curated by hand.
`_resolve_month_tab()` tolerates drifted tab titles (`'July 2026'`, `'JULY '`).

## Colour rules (these are decisions, not preferences)
Colour carries meaning in exactly two places, and never alone:
- **green / red** = money in / money out
- **`--pace-good|warn|serious|crit`** = budget state, always beside an icon and a word

There is deliberately **no per-category palette.** Ten categories cannot be given ten
colourblind-safe hues once segments can appear in any order — only three of the eight
validated slots clear all-pairs separation. Category identity comes from the row label;
Trends uses small multiples rather than one many-hued chart. If you add a chart, keep it to
one hue or facet it, and run the `dataviz` skill's `validate_palette.js` before shipping any
categorical palette.

The pace bar stays recessive ink when a category is fine and only lights up when it is
off-track, so the one row worth looking at is the one that stands out. Don't "improve" this
by colouring every bar.

## Development rules
- Every Flask route is covered by `require_auth()` via `@app.before_request`; the exempt list
  is in that function. `/api/healthz` is intentionally unauthenticated (a bare `/healthz` is swallowed by Google Frontend on Cloud Run).
- `_load(FILE, default)` and `_save(FILE, data)` are the only data-access primitives.
- **`_rocket_to_finance_category` must only ever return a category in `PLACEABLE_CATEGORIES`.**
  `_finance_sync_month` counts a charge toward `csv_total` before choosing where to write it,
  so a category the Sheet has no section for is counted as spending and never written, and the
  tab can never reconcile. This is why the catch-all is `Fun` and not `Other`.
  `tests/test_rocket_sync.py` fails if you get this wrong.
- **`DETAIL_TABLE_FALLBACK` lets a category exist before the Sheet has a table for it.**
  Shopping maps to `Shopping`, but on a tab with no "Shopping Total" table the sync folds
  those charges into Fun for that run and warns. The month total is identical either way.
  Add a `Shopping Total` table to a month tab and it starts tracking separately with no
  code change. Use the same pattern for any future category.
- Google Sheets / GCS calls must have a local JSON fallback.
- New env var: add it to `deploy.ps1` `--set-env-vars`, to `.env.example`, and guard with `if VAR:`.
- Never commit `.env`, `token.json`, `drive_token.json`, `credentials.json`.
- `/api/finances/trends` reads one Sheet tab per month and the container runs gunicorn with a
  single worker and no threads (`--threads 8` was tried and OOM-killed), so an uncached call
  blocks everything. Keep the 12-month cap and the 15-min `_TRENDS_CACHE`.

## Scripts
| Script | Purpose |
|---|---|
| `deploy.ps1` | Cloud Run deploy (canonical) |
| `scripts\deploy-quick.ps1` | Commit + deploy + verify |
| `scripts\sheets-reauth.ps1` | Re-auth Google OAuth. **Needs Parker's interactive sign-in.** |
| `scripts\health-check.ps1` | Ping the live URL + Cloud Run status + error logs |
| `scripts\jsx_check.py` | Babel-parse a JSX file (needs playwright) |
| `python tests\test_rocket_sync.py` | Pins the Rocket Money import arithmetic. Run it after touching `_rocket_*` or the category maps. |
| `scripts\clean.ps1` | Preview/remove generated artifacts |

## Known issues
- **The Drive/Sheets refresh token is dead** (checked 2026-08-30): refreshing returns
  `invalid_grant`, so `/api/drive/status` reports `auth_required` and every Sheet-backed
  feature falls back to local JSON. Fix is `scripts\sheets-reauth.ps1`, which requires
  Parker's own Google sign-in. Until then use `static/_harness.html` to work on the UI.
- Local scripts hitting the Sheet directly: `_sheets_svc()` uses ADC, and Parker's local ADC
  lacks the spreadsheets scope. Monkeypatch it instead of re-authing:
  `A._sheets_svc = lambda: A._gdrive_service()[0]`.
- `docs/` holds seven signed, dated policy documents. Several name Google Calendar, Health
  data and Anthropic as sub-processors / data categories, all of which are now wrong. They
  are versioned and approved documents — flag them for Parker, don't edit them silently.

## Related projects
- **CUA Website**: `Desktop\Projects\Software\coming-up-aces` → comingupaces.net. Mission
  Control no longer touches it; `scripts/cua.py` in that repo owns show/video updates.
