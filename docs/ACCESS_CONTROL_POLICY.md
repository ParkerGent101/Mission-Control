# Access-Control Policy

**System:** Mission Control · **Owner / Operator:** Parker Gent
**Version:** 1.0 · **Effective:** 2026-06-19 · **Last reviewed:** 2026-06-19 · **Next review:** 2027-06-19

## 1. Purpose
Define how access to Mission Control and its supporting infrastructure is granted,
controlled, and reviewed, so that only appropriate, current access exists.

## 2. Principles
- **Identity-based access** — access is tied to a verified identity, not a shared
  secret. Shared-password login is disabled in production.
- **Least privilege** — each identity (human or service account) holds only the
  permissions required for its function.
- **MFA required** — every identity with access uses multi-factor authentication.
- **Default deny** — anything not explicitly granted is denied.

## 3. Access surfaces & controls
| Surface | Control |
|---|---|
| Application login | Sign in with Google (OIDC), restricted to an email allow-list (`ALLOWED_LOGIN_EMAILS`); MFA via the Google account; 7-day sessions. |
| Google Cloud project | IAM; human access limited to the owner; service accounts scoped to function. |
| Runtime service account | Used by Cloud Run; permissions reviewed for least privilege. |
| Secrets (Secret Manager) | Access limited to the runtime; secrets rotated if exposed. |
| Source repository (GitHub) | Collaborators limited to the owner. |
| Financial institutions (Plaid) | Connected only at the operator's instruction; disconnect revokes tokens. |
| Third-party OAuth grants | Periodically reviewed; unused grants revoked. |

## 4. Granting & revoking access
- New access (a person or a service account permission) is granted explicitly by the
  owner, at the least privilege needed, and recorded in the next access review.
- Access that is no longer required is revoked promptly. Connected integrations are
  disconnected when no longer used.

## 5. Periodic access review process
- **Cadence:** at least **semi-annually**, and additionally whenever access materially
  changes (new integration, new collaborator, suspected compromise).
- **Checklist each review:**
  1. Application login allow-list — only intended accounts.
  2. Google Cloud IAM — only intended human members; roles appropriate.
  3. Service-account permissions — least privilege; no orphaned/unused accounts.
  4. Secret Manager — only needed secrets exist; rotate as required.
  5. GitHub collaborators — only intended people.
  6. Connected Plaid institutions — only those still in use.
  7. Third-party OAuth grants on the operator's Google account — revoke unused.
- **Remediation:** remove excess or outdated access found during the review.
- **Record:** each review is logged (date, scope, findings, actions) in
  `docs/ACCESS_REVIEW_LOG.md`, which serves as the audit trail.

## 6. Review of this policy
Reviewed at least annually and on significant change; revisions tracked in Git
history.

### Approval
| Role | Name | Date |
|------|------|------|
| Owner & Operator | Parker Gent | 2026-06-19 |
