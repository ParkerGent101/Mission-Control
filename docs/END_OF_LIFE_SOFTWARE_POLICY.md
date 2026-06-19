# End-of-Life (EOL) Software Policy

**System:** Mission Control · **Owner / Operator:** Parker Gent
**Version:** 1.0 · **Effective:** 2026-06-19 · **Last reviewed:** 2026-06-19 · **Next review:** 2027-06-19

## 1. Purpose
Ensure Mission Control does not run software that has reached end-of-life (no longer
receiving security support), reducing exposure to unpatched vulnerabilities.

## 2. Scope
- **Language runtime** — Python (and its base container image).
- **Application dependencies** — Python packages (e.g., Flask, the Plaid and Google
  client libraries) listed in `requirements.txt`, and frontend libraries loaded by the
  app.
- **Platform** — Google Cloud Run, Cloud Storage, Secret Manager (vendor-maintained).

## 3. Policy
- Run only **supported, maintained versions** of the runtime, base image, and
  dependencies.
- **Monitor for EOL / security advisories** — track the Python release schedule, base
  image updates, and dependency security advisories.
- **Replace or upgrade** software **before**, or promptly after, it reaches EOL or a
  security-relevant issue is disclosed.
- Managed platform components (Cloud Run, etc.) are kept current by the vendor;
  the operator stays on supported service configurations.

## 4. Change management
Runtime/dependency upgrades are made through normal version-controlled changes and
deployed from reviewed source. The Git history records when components were updated.

## 5. Review
This policy — and a check of current runtime/dependency support status — is reviewed
at least annually and on significant change. Revisions tracked in Git history.

### Approval
| Role | Name | Date |
|------|------|------|
| Owner & Operator | Parker Gent | 2026-06-19 |
