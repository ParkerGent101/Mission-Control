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

# 1 sync worker (serial). NOTE: --threads 8 (gthread) was tried for parallel /api/*
# loads but OOM-killed the worker on the 512Mi instance — the dashboard fires ~15
# concurrent calls and 8 threads each holding Sheets data + response blew past 512Mi
# (SIGKILL -> 503s). Serial caps peak memory to one request. For real parallelism,
# raise --memory (in deploy.ps1) FIRST, then re-add --threads.
CMD exec gunicorn --bind 0.0.0.0:${PORT} --workers 1 --timeout 120 --log-level info app:app
