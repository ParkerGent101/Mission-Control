FROM python:3.11-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /data

ENV PORT=8080
ENV DATA_DIR=/data

EXPOSE 8080

# --threads 8: the dashboard fires many /api/* calls at once, each blocking on a
# Sheets/GCS/Anthropic round-trip. With 1 sync worker they serialized; gunicorn
# auto-promotes to the gthread worker when threads>1 so they run concurrently.
CMD exec gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 120 --log-level info app:app
