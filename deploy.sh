#!/bin/bash
# Mission Control — Cloud Run deployment
# Prerequisites:
#   1. gcloud CLI installed and logged in (gcloud auth login)
#   2. ANTHROPIC_API_KEY set in your environment
#   3. Fill in PROJECT_ID below
#
# Run from this directory: bash deploy.sh

set -e

PROJECT_ID="mission-control-496004"
REGION="us-central1"
SERVICE="mission-control"
BUCKET="parker-mission-control-data"

echo "==> Setting project to $PROJECT_ID"
gcloud config set project $PROJECT_ID

echo "==> Enabling APIs..."
gcloud services enable run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com

echo "==> Creating data bucket..."
gcloud storage buckets create gs://$BUCKET \
  --location=$REGION \
  --uniform-bucket-level-access 2>/dev/null || echo "  (bucket already exists)"

echo "==> Uploading seed data..."
gcloud storage cp data/ gs://$BUCKET/ --recursive

echo "==> Storing secrets..."
# ANTHROPIC_API_KEY — reads from your local env
echo -n "$ANTHROPIC_API_KEY" | \
  gcloud secrets create anthropic-api-key --data-file=- 2>/dev/null || \
  echo -n "$ANTHROPIC_API_KEY" | \
  gcloud secrets versions add anthropic-api-key --data-file=-

# FLASK_SECRET — random string for session signing
FLASK_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
echo -n "$FLASK_SECRET" | \
  gcloud secrets create flask-secret --data-file=- 2>/dev/null || \
  echo "  (flask-secret already exists, skipping)"

echo "==> Deploying to Cloud Run..."
gcloud run deploy $SERVICE \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --memory 512Mi \
  --timeout 120 \
  --min-instances 1 \
  --set-env-vars "DASHBOARD_PASSWORD=aces2026,DATA_DIR=/data" \
  --set-secrets "ANTHROPIC_API_KEY=anthropic-api-key:latest,FLASK_SECRET=flask-secret:latest" \
  --add-volume "name=data,type=cloud-storage,bucket=$BUCKET" \
  --add-volume-mount "volume=data,mount-path=/data"

echo ""
echo "============================================"
echo "Deployed! Open the URL above on your phone."
echo "Password: aces2026"
echo "============================================"
