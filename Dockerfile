# ---- Stage 1: transpile JSX -> plain JS at build time ----
# Production then serves precompiled .js and drops the ~3MB in-browser @babel/standalone
# download + per-load transpile. Dev (localhost) still uses Babel-in-browser (see index.html).
FROM node:20-slim AS jsx
WORKDIR /jsx
COPY babel.config.json ./
COPY static/*.jsx ./src/
RUN npm install --no-save @babel/core@^7.24 @babel/cli@^7.24 @babel/preset-react@^7.24 \
 && npx babel src --out-dir out --extensions ".jsx" \
 && ls -la out

# ---- Stage 2: Python runtime (no Node) ----
FROM python:3.11-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Transpiled JS from stage 1 — served instead of .jsx when PRECOMPILED_ASSETS=1.
# The .jsx sources stay in the image too, so the dev/Babel path remains a flip away.
COPY --from=jsx /jsx/out/*.js ./static/

RUN mkdir -p /data

ENV PORT=8080
ENV DATA_DIR=/data
# Serve precompiled .js. Break-glass: set this to 0 (gcloud run services update
# --update-env-vars PRECOMPILED_ASSETS=0) to fall back to in-browser Babel with NO rebuild.
ENV PRECOMPILED_ASSETS=1

EXPOSE 8080

# --threads 8: the dashboard fires many /api/* calls at once, each blocking on a
# Sheets/GCS/Anthropic round-trip. With 1 sync worker they serialized; gunicorn
# auto-promotes to the gthread worker when threads>1 so they run concurrently.
CMD exec gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 120 --log-level info app:app
