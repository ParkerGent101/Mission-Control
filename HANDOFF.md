# Mission Control — New Chat Handoff

## What this is
Mission Control is my personal AI dashboard — a Python/Flask + React web app that runs locally at localhost:5000 AND is live on Google Cloud Run for phone access. It's my central hub for all my roles. Claude is the agent powering it.

## My roles
- **IT Manager** at Ground Level Services (GLS) — Azure, SharePoint, MDM, security, vendor mgmt
- **Lead Guitarist / Band Manager** — Coming Up Aces (NWA classic rock: Parker on lead guitar/keys/harmonica, Nate Poplin vocals/rhythm, Brandon Hargis bass, Riley Gent drums). Sound: Lynyrd Skynyrd + Tom Petty + grunge. Site: comingupaces.net
- **Freelance Developer** — building "aGent Security Consultancy" brand
- **Student** — studying for CISM + CRISC + MBA
- **Personal** — dog owner, gamer, reader, traveler

## Tech stack
- Backend: Python/Flask (`app.py`)
- Frontend: React 18 + Babel (no build step, JSX served as static files)
- AI: Anthropic Claude (sonnet-4-6 for agent, talk card uses full tool-use loop)
- Storage: JSON files in `data/` (mounted from GCS bucket `parker-mission-control-data` on Cloud Run)
- Fonts: IBM Plex Sans/Mono/Serif
- Colors: oklch color space

## Repos
- Mission Control: github.com/ParkerGent101/Mission-Control (private)
- Band site: github.com/ParkerGent101/CUA-Website → deploys to comingupaces.net

## Deployment
- Local: `start.bat` or `python app.py` → localhost:5000
- Cloud Run (LIVE): https://mission-control-568559213462.us-central1.run.app
- GCP Project: mission-control-496004
- Redeploy: Cloud SDK Command Prompt → `powershell -ExecutionPolicy Bypass -File deploy.ps1`

## 6 Modules (all wired to Flask APIs)
2. **Agenda** — Today's schedule + todo items. Data: `data/agenda.json`
3. **Finance** — Expense/income tracking with pie chart. Data: `data/finances.json`, `data/savings.json`
4. **Band** — Upcoming shows, content queue, push to comingupaces.net. Data: `data/shows.json`, `data/band_content.json`
5. **Health** — Habit tracker (workout, water, guitar, dog meds), weight, calories. Data: `data/health.json`
6. **Work** — IT/GLS work tasks by project and priority. Data: `data/work_tasks.json`
7. **Study** — CISM exam progress across 4 domains, study sessions. Data: `data/study.json`

## Key files
- `app.py` — Flask backend, all API routes, Claude agent with tools
- `static/modules.jsx` — All 11 React module cards (~54KB)
- `static/app.jsx` — App shell, sidebar navigation, tweaks panel
- `templates/index.html` — Full CSS (oklch vars, IBM Plex, grid system)
- `data/*.json` — All persistent data

## Development Scripts

Run these from `c:\Users\Parker\projects\mission-control\`:

| Script | Purpose | Run When |
|--------|---------|---------|
| `scripts\deploy-quick.ps1` | Commit + deploy to Cloud Run + verify live URL | Anytime you want to ship changes |
| `scripts\fix-cloudrun-env.ps1` | Add GITHUB_TOKEN secret + sync all env vars | Band push fails / missing env vars |
| `scripts\sheets-reauth.ps1` | Delete stale OAuth token + re-auth with correct scope | Finance card shows fallback / SCOPE_INSUFFICIENT error |
| `scripts\health-check.ps1` | Ping live URL + Cloud Run status + error logs | Something seems broken |

```powershell
# Example usage
powershell -ExecutionPolicy Bypass -File scripts\fix-cloudrun-env.ps1
powershell -ExecutionPolicy Bypass -File scripts\deploy-quick.ps1
powershell -ExecutionPolicy Bypass -File scripts\sheets-reauth.ps1
powershell -ExecutionPolicy Bypass -File scripts\health-check.ps1
```

Claude Code slash command: `/review-before-deploy` — reviews app.py and JSX changes for bugs before shipping.
File: `.claude\commands\review-before-deploy.md`

## What I want to do in this chat
Walk through each module one by one and:
1. Fill in real personal data for each module
2. Set up permanent context in the system prompt so Claude always knows my full situation
3. Customize each module's behavior and defaults
4. Make the Talk card truly useful as a chief-of-staff AI
