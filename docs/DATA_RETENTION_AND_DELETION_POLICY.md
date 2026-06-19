# Data Retention & Deletion Policy

**System:** Mission Control · **Owner / Operator:** Parker Gent
**Version:** 1.0 · **Effective:** 2026-06-19 · **Last reviewed:** 2026-06-19 · **Next review:** 2027-06-19

## 1. Purpose
Define how long Mission Control retains data and how it is deleted, so that data is
kept only as long as it is useful and can be removed on demand.

## 2. Principle
Retain the minimum data needed to operate the dashboard. Data is not kept beyond its
usefulness to the operator.

## 3. Retention by data type
| Data | Retention |
|------|-----------|
| Financial transactions / budget figures | Kept for the current and recent periods for trend/budget context; superseded by yearly rollover. |
| Plaid access tokens | Kept only while the institution is connected; revoked on disconnect. |
| Google OAuth tokens | Kept only while the integration is connected; the stored token is deleted on credential rotation / re-auth (full revocation via the operator's Google Account third-party-access settings). |
| Calendar, tasks, health, band, and other module data | Kept while relevant to the operator; deletable per item or in bulk. |
| Activity log | Bounded/rolling; not retained indefinitely. |
| Secrets (API keys, client secrets) | Kept while the integration is in use; rotated if exposure is suspected. |

## 4. Deletion mechanisms
- **In-app data reset** — clears application data on demand.
- **Disconnect a financial institution** — removes its Plaid item and **revokes the
  associated access token**.
- **Disconnect Google integrations** — deletes the stored Google OAuth token (on
  credential rotation / re-auth, or by removing it from storage); full revocation of
  the grant is performed via the operator's Google Account third-party-access settings.
- **Storage deletion** — data objects can be removed directly from Google Cloud
  Storage; **secret rotation/deletion** via Secret Manager.
- Deletions propagate to the durable cloud storage backing the application.

## 5. Third-party data
Data held by sub-processors (Plaid, Google, Anthropic) is governed by their own
retention controls; the operator can revoke connections to stop further processing.

## 6. Review
Reviewed at least annually and on significant change; revisions tracked in this
file's Git history.

### Approval
| Role | Name | Date |
|------|------|------|
| Owner & Operator | Parker Gent | 2026-06-19 |
