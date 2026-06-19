# Access Review Log

This file is the audit trail for periodic access reviews of Mission Control, as
required by the **Access-Control Policy** (§5). Each review records the date, who
performed it, the scope checked, findings, and any remediation. Reviews occur at
least semi-annually and on significant access changes.

---

## Review — 2026-06-19
**Reviewer:** Parker Gent (owner/operator) · **Type:** baseline (first review)

**Scope checked:** application login allow-list, Google Cloud project IAM,
service-account permissions, Secret Manager secrets, GitHub collaborators, connected
Plaid institutions, third-party OAuth grants.

**Findings:**
- **Application login allow-list** — `ALLOWED_LOGIN_EMAILS` = `parkergent7@gmail.com`
  only. Appropriate. ✓
- **Google Cloud IAM (human members)** — only `roles/owner` → `parkergent7@gmail.com`.
  No other human members. Appropriate. ✓
- **Service accounts** — only the **default compute service account**
  (`568559213462-compute@developer.gserviceaccount.com`); no orphaned or unused
  service accounts. ✓
  - ⚠️ **Least-privilege note:** this runtime service account holds `roles/editor`
    (broad), plus `run.admin` and `iam.serviceAccountUser`. The application only needs
    object access to the data bucket, secret access, and log writing. **Follow-up
    (hardening, not urgent):** scope it down to e.g. `storage.objectAdmin` (data
    bucket), `secretmanager.secretAccessor`, and `logging.logWriter`. Tracked for a
    future change; tested in staging before applying so deploys/runtime aren't broken.
- **Secret Manager** — 5 secrets, all in active use: `anthropic-api-key`,
  `flask-secret`, `github-token`, `plaid-client-id`, `plaid-secret`. None orphaned. ✓
- **GitHub collaborators** — to confirm in repo settings that the only collaborator is
  the owner. *(Manual check — confirm and note here.)*
- **Connected Plaid institutions** — reviewed via the Finance card; disconnect any no
  longer in use. *(Record current connections here.)*
- **Third-party OAuth grants** — reviewed at https://myaccount.google.com/permissions;
  revoke apps no longer used. *(Note any revoked.)*

**Remediation performed:** none required for access removal (no excess human access,
no orphaned service accounts or secrets).

**Open follow-up:** tighten the runtime service account from `editor` to least
privilege (see note above).

**Next review due:** 2026-12-19 (or sooner on a significant access change).

---

<!-- Add the next review above this line, newest first. Template:
## Review — YYYY-MM-DD
**Reviewer:** … · **Type:** periodic
**Scope checked:** …
**Findings:** …
**Remediation performed:** …
**Next review due:** …
-->
