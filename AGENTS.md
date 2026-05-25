# AGENTS.md

## Project

Mission Control is a personal AI dashboard. It is a Python/Flask backend with React 18 JSX served directly through static files and browser Babel. There is no frontend build step.

## Run And Deploy

- Local: `python app.py` or `start.bat`, then open `http://localhost:5000`.
- Production: `powershell -ExecutionPolicy Bypass -File deploy.ps1`.
- Cloud Run uses `DATA_DIR=/data`; local development usually uses the repo `data/` folder.

## Important Files

- `app.py`: Flask app, API routes, persistence helpers, AI tool loop, and server-side integration logic.
- `static/app.jsx`: app shell, sidebar, navigation, and top-level client state.
- `static/modules.jsx`: dashboard modules and most user-facing module UI.
- `static/settings.jsx`: settings/onboarding-related UI.
- `templates/index.html`: page shell and CSS variables/styles.
- `data/*.json`: local persistent data. Treat this as personal runtime data unless a file is clearly a template or seed.
- `requirements.txt`: Python dependencies.
- `deploy.ps1` and `deploy.sh`: deployment entry points.

## Editing Rules

- Keep the no-build frontend model unless the user explicitly asks to introduce a bundler.
- Prefer small Flask route/helper changes over broad rewrites in `app.py`; it is a large central file.
- Keep JSON persistence stable. When adding a new data file, use the existing `_load`/`_save` style and include a safe default.
- Never commit secrets, OAuth tokens, local databases, logs, screenshots, or personal runtime exports.
- Be careful with tracked `data/*.json` files: many contain real user state. Ask before replacing or mass-normalizing them.
- When touching deployed behavior, check local startup and the affected route/module before suggesting deployment.

## Cleanup

- Run `powershell -ExecutionPolicy Bypass -File scripts/clean.ps1` to preview removable generated artifacts.
- Add `-Apply` to remove Python caches, test caches, local logs, and local smoke-test screenshots.
- The cleanup script does not remove JSON data, token files, `.env`, or the SQLite database.
