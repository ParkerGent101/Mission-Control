# Consent Management Process

**System:** Mission Control · **Owner / Operator:** Parker Gent
**Version:** 1.0 · **Effective:** 2026-06-19 · **Last reviewed:** 2026-06-19 · **Next review:** 2027-06-19

## 1. Purpose
Describe how Mission Control informs the data subject about the collection, processing,
and storage of personal data; obtains explicit consent *before* any data is collected;
records (tracks) that consent; and lets the data subject withdraw it at any time.

## 2. Scope & data subjects
Mission Control is a **single-operator personal application**. The sole user and sole
data subject is the operator (Parker Gent); sign-in is restricted to a one-address
allow-list (`ALLOWED_LOGIN_EMAILS`). The application does **not** collect, process, or
store data belonging to any third-party consumer. All personal data handled is the
operator's own — his financial transactions (via Plaid), his Google Calendar/Drive
data (via Google OAuth), and the personal task / health / band data he enters directly.
"Consent" here is therefore the operator's own, informed authorization to connect his
own accounts and data sources.

## 3. Informing the data subject
A **Privacy Policy** is published in-app at `/privacy` and is linked from the **login
screen, before sign-in** (`templates/login.html`) and from **Settings → About**. It
discloses what data is collected, how it is processed and stored, the third parties
involved (Plaid, Google, Anthropic, Google Cloud), retention periods, and deletion
rights. (See `docs/PRIVACY_POLICY.md` and `templates/privacy.html`.)

## 4. Obtaining consent
Consent is obtained through explicit, **active** authorization at each point of
collection. No data is collected until the data subject completes the flow:

| Data collected | Consent mechanism |
|---|---|
| Application access (identity) | **Sign in with Google (OIDC).** Google presents its consent screen; the app forces it with `prompt='consent'`. No session is created without completing it. |
| Financial account data | **Plaid Link.** Plaid's own authorization UI requires the user to select the institution, authenticate, and explicitly authorize sharing before any token is issued. No financial data is retrieved until the user completes Link and the public token is exchanged (`/api/plaid/exchange`). |
| Google Calendar / Drive | **Google OAuth** consent screen with the relevant scopes, forced re-consent (`prompt='consent'`). |

## 5. Tracking consent
Consent is recorded as a durable, timestamped record — a record exists if and only if
consent was actively given:

- **Financial (Plaid):** each authorized connection is stored in `plaid_config.json`
  with the institution name/id and an `added` timestamp (ISO-8601) marking when consent
  was granted. Active connections are listed in the Finance card.
- **Google grants:** tracked by Google under the operator's Account → *third-party
  access*; the app forces an explicit consent screen on each authorization, so a grant
  is always the result of a deliberate consent action.

These connection/grant records constitute the consent audit trail for the sole data
subject.

## 6. Withdrawing consent / data-subject control
The data subject retains control and can withdraw consent at any time:

- **Disconnect a Plaid institution** — `/api/plaid/disconnect` calls Plaid `item/remove`,
  revoking the access token at Plaid and deleting the local connection record.
- **Revoke Google access** — remove the stored OAuth token (credential rotation / re-auth)
  and/or revoke the grant in the Google Account third-party-access settings.
- **Delete stored data** — `/api/data/reset` bulk-deletes the stored module data.

See `docs/DATA_RETENTION_AND_DELETION_POLICY.md` for retention and secure-deletion detail.

## 7. Review
This process is reviewed at least **annually** and whenever a new data source or third
party is added (which would introduce a new consent point). Revisions are tracked in
this file's Git history.

### Approval
| Role | Name | Date |
|------|------|------|
| Owner & Operator | Parker Gent | 2026-06-19 |
