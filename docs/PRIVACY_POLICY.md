# Privacy Policy

**System:** Mission Control (personal dashboard application)
**Operator / Owner:** Parker Gent
**Version:** 1.0 · **Effective:** 2026-06-19 · **Last reviewed:** 2026-06-19 · **Next review:** 2027-06-19
**Contact:** parkergent7@gmail.com

## 1. Overview
Mission Control is a **single-user personal application** operated by Parker Gent.
It processes the operator's own financial, scheduling, and personal-productivity
data. There are no third-party end users; access is limited to the operator.

## 2. Data the application processes
- **Financial data** — account balances, transactions, holdings, and budget figures,
  obtained through connected financial institutions (via Plaid), Google Sheets, and
  manual entry.
- **Identity data** — the Google account email used to sign in.
- **Productivity data** — calendar events, contacts, tasks, notes, health/habit logs,
  and band/work data entered by or synced for the operator.
- **Credentials** — OAuth tokens and API keys required to operate integrations
  (stored securely; see §5).

## 3. How and why it is collected
Data is collected only to provide the operator's own dashboard functionality:
displaying finances, calendar, tasks, health, and related modules. The application
does **not** use data for advertising and does **not** sell or share data for
marketing purposes.

## 4. Third-party services (sub-processors)
- **Plaid** — connects to financial institutions to retrieve account and transaction
  data, at the operator's instruction. Used only to deliver the finance features.
- **Google** — identity/sign-in (OAuth/OIDC), Calendar, Drive/Sheets, and hosting
  (Cloud Run, Cloud Storage, Secret Manager).
- **Anthropic** — powers AI assistant features; only the content the operator submits
  for a given request is sent.

Each receives only the minimum data necessary for its function, under its own terms.

## 5. Storage & security
- Data is stored in Google Cloud (Cloud Storage) and secrets in Google Secret
  Manager, **encrypted at rest** by default.
- All traffic is served over **TLS/HTTPS** (encrypted in transit).
- Application access requires **Sign in with Google restricted to an allow-list**,
  protected by the operator's **multi-factor authentication**. Shared-password login
  is disabled in production.
- See the companion **Information Security Policy** and **Access-Control Policy**.

## 6. Retention & deletion
Data is retained only while useful to the operator and can be deleted on demand
(in-app data reset, disconnecting financial institutions to revoke Plaid tokens,
and secret rotation). See the **Data Retention & Deletion Policy**.

## 7. Rights & control
As the sole data subject and operator, Parker Gent has full control over all data in
the system, including the ability to access, correct, export, and delete it, and to
revoke any third-party connection at any time.

## 8. Changes
This policy is reviewed at least annually and updated on any significant change to
the data handled or the services used. Revisions are recorded in this file's Git
history.

### Approval
| Role | Name | Date |
|------|------|------|
| Owner & Operator | Parker Gent | 2026-06-19 |
