# AGENTS.md

## Project

Mission Control is a personal AI dashboard. It is a Python/Flask backend with React 18 JSX served directly through static files and browser Babel. There is no frontend build step.

## Run And Deploy

- Local: `python app.py` or `start.bat`, then open `http://localhost:5000`.
- Production: `powershell -ExecutionPolicy Bypass -File deploy.ps1`.
- Cloud Run uses `DATA_DIR=/data`; local development usually uses the repo `data/` folder as cache/fallback storage.

## Data Source Of Truth

Google Sheets in the user's Google Drive is the intended source of truth for personal data. Local JSON files in `data/` should be treated as runtime cache, offline fallback, import/export scratch files, or migration helpers unless the user explicitly says a file is a seed/example file.

- Prefer Drive -> Local sync for personal data.
- Avoid hand-editing tracked `data/*.json` files as the long-term fix.
- Do not commit personal local data, OAuth tokens, local sheet IDs, screenshots, logs, or SQLite files.
- When adding new personal-data features, design around Google Sheets/Drive first, then use JSON only as a cache/fallback layer.

## Important Files

- `app.py`: Flask app, API routes, persistence helpers, AI tool loop, and server-side integration logic.
- `static/app.jsx`: app shell, sidebar, navigation, and top-level client state.
- `static/modules.jsx`: dashboard modules and most user-facing module UI.
- `static/settings.jsx`: settings/onboarding-related UI.
- `templates/index.html`: page shell and CSS variables/styles.
- `data/*.json`: local cache/fallback data. Google Sheets/Drive is the real source of truth unless a file is clearly a template or seed.
- `requirements.txt`: Python dependencies.
- `deploy.ps1` and `deploy.sh`: deployment entry points.

## Editing Rules

- Keep the no-build frontend model unless the user explicitly asks to introduce a bundler.
- Prefer small Flask route/helper changes over broad rewrites in `app.py`; it is a large central file.
- Keep JSON persistence stable as a cache/fallback layer. When adding a new data file, use the existing `_load`/`_save` style and include a safe default, but prefer Sheets/Drive for canonical user data.
- Never commit secrets, OAuth tokens, local databases, logs, screenshots, or personal runtime exports.
- Be careful with tracked `data/*.json` files: many contain real user state. Ask before replacing or mass-normalizing them.
- When touching deployed behavior, check local startup and the affected route/module before suggesting deployment.

## Cleanup

- Run `powershell -ExecutionPolicy Bypass -File scripts/clean.ps1` to preview removable generated artifacts.
- Add `-Apply` to remove Python caches, test caches, local logs, and local smoke-test screenshots.
- The cleanup script does not remove JSON data, token files, `.env`, or the SQLite database.
