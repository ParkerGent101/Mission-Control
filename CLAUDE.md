# Mission Control — Claude Code Agent Context

## What this project is
Parker's personal AI command center — a unified dashboard for his IT Manager, Band Manager, Freelancer, and Student roles. Claude (sonnet-4-6) is the agent that routes voice/text input to the appropriate module via tool use. Live at https://mission-control-568559213462.us-central1.run.app (password: aces2026).

## Parker's roles
- **IT Manager** at Ground Level Services (GLS) — Azure, SharePoint, MDM, security, vendor mgmt
- **Lead Guitarist / Band Manager** — Coming Up Aces (NWA classic rock). Site: comingupaces.net
- **Freelance Developer** — building "aGent Security Consultancy" brand
- **Student** — CISM exam target 2026-08-16; also CRISC + MBA

## Tech stack
- Backend: Python/Flask (`app.py`, ~2,500 lines)
- Frontend: React 18 + Babel, no build step (JSX served as static files)
- AI: Anthropic Claude — `claude-sonnet-4-6` for agent, `claude-haiku-4-5` for lightweight tasks
- Storage: JSON files in `data/` (GCS bucket `parker-mission-control-data` on Cloud Run)
- Fonts: IBM Plex Sans/Mono/Serif; Colors: oklch color space

## GCP infrastructure
- Project ID: `mission-control-496004`
- Cloud Run service: `mission-control`, region: `us-central1`
- GCS bucket: `parker-mission-control-data` (mounted at `/data` on Cloud Run)
- Secret Manager: `anthropic-api-key`, `flask-secret`, `github-token`
- Finance Sheet ID: `1UaFkSQ3wwrPt6pfZIfnNrlMQmerv-ZQ52KYyCF5rIvo`
- Deploy: `powershell -ExecutionPolicy Bypass -File deploy.ps1`

## Key files
- `app.py` — All Flask routes, Claude agent loop, 22 tools, Google integrations, GCS helpers
- `static/modules.jsx` — React module cards (~54KB): Agenda, Finance, Band, Health (Study is now a Health habit, not its own module), Work, Calendar, Practice, TCPG
- `static/app.jsx` — App shell, sidebar navigation, command parser
- `templates/index.html` — Full CSS (oklch vars, IBM Plex, grid system)
- `data/*.json` — Persistent storage (31 JSON files)
- `deploy.ps1` — Cloud Run deployment (canonical — use this)

## Development scripts (run from project root)
| Script | Purpose | Run When |
|--------|---------|---------|
| `scripts\deploy-quick.ps1` | Commit + deploy + verify | Ship any change |
| `scripts\fix-cloudrun-env.ps1` | Add/update Cloud Run env vars & secrets | After adding new secrets |
| `scripts\sheets-reauth.ps1` | Re-auth Google OAuth with correct Sheets scope | Finance card broken / SCOPE_INSUFFICIENT |
| `scripts\health-check.ps1` | Ping live URL + Cloud Run status + error logs | Something seems broken |

## Claude Code slash commands
- `/review-before-deploy` — reviews app.py and JSX changes for bugs before shipping
  (file: `.claude\commands\review-before-deploy.md`)

## Module architecture
Each module = one Flask API prefix + one React card in modules.jsx:
- Agent tools (`tool_*` functions in app.py) handle NLP-triggered mutations
- Direct API calls handle card load/save from the frontend
- Data lives in `data/<module>.json`, backed by GCS on Cloud Run

## Development rules
- All Flask routes must call `require_auth()` at the top
- Tool functions must return a plain string (not JSON, not None)
- `_load(FILE, default)` and `_save(FILE, data)` are the only data access primitives
- When adding a new env var: add to `deploy.ps1` `--set-env-vars`, to `.env.example`, and guard with `if VAR:` in app.py
- Never commit: `.env`, `token.json`, `drive_token.json`, `credentials.json`
- Google Sheets / GCS calls must have a local JSON fallback

## Known issues (as of 2026-05-25)
- **GITHUB_TOKEN not set on Cloud Run** → band push to comingupaces.net fails; fix: run `scripts\fix-cloudrun-env.ps1`
- **Google Sheets OAuth scope** → `drive_token.json` has insufficient scope for spreadsheets write; fix: run `scripts\sheets-reauth.ps1`
- **7 bug fixes + Study card not deployed** → local only; fix: run `scripts\deploy-quick.ps1`

## Related projects
- **CUA Website**: `c:\Users\Parker\projects\coming-up-aces` → comingupaces.net (Mission Control's `push_site` tool pushes here)
- **TCPG App**: GCP project `tcpgapplication`, Cloud Run `non-reporting-users` (monitored via the TCPG module in Mission Control)
