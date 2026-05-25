# Mission Control Data

Google Sheets in Google Drive is the intended source of truth for personal Mission Control data.

Files in this folder are local runtime cache, offline fallback data, import/export scratch files, or migration helpers unless they are explicitly named as examples. Do not commit personal data, local sheet IDs, OAuth tokens, logs, screenshots, or local databases.

If a feature needs durable personal data, prefer syncing with Google Sheets/Drive first and use JSON only as the local fallback layer.
