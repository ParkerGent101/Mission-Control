# Information Security Policy

**System:** Mission Control (personal dashboard application)
**Owner / Operator:** Parker Gent
**Policy version:** 1.0
**Effective date:** 2026-06-19
**Last reviewed:** 2026-06-19
**Next scheduled review:** 2027-06-19 (or sooner on any significant change)
**Approved by:** Parker Gent — Owner & Operator (sole responsible individual)

---

## 1. Purpose & Objectives

This Information Security Policy (ISP) is the foundation of the information
security program for Mission Control. It documents the commitment to protecting
the **confidentiality, integrity, and availability (CIA)** of the information
assets the application handles.

Objectives:

- **Confidentiality** — ensure financial, personal, and account data is
  accessible only to the authorized operator.
- **Integrity** — ensure data is accurate and is not altered by unauthorized
  parties or processes.
- **Availability** — ensure the operator can access the application and its data
  when needed, with recovery from loss where reasonably possible.

## 2. Scope

This policy applies to all components of Mission Control and the data it
processes, specifically:

- The Mission Control application (Python/Flask backend, React frontend).
- Hosting and infrastructure: Google Cloud Run, Google Cloud Storage (data
  bucket), and Google Secret Manager (Google Cloud project `mission-control-496004`).
- Data assets: financial and budget data, bank/brokerage connection tokens,
  calendar and contact data, and application configuration.
- Third-party services that process or store data on the system's behalf:
  **Plaid** (financial account connectivity), **Google** (identity, Calendar,
  Drive/Sheets, hosting), and **Anthropic** (AI features).
- The single authorized user/operator and the credentials used to administer the
  system.

## 3. Accountability & Roles

Mission Control is a single-operator system. **Parker Gent** holds all security
responsibilities, including those that would, in a larger organization, be split
across roles:

- **Policy owner / approver** — owns, approves, and maintains this policy.
- **System administrator** — manages infrastructure, access, secrets, and deploys.
- **Authorized user** — the sole person permitted to access the application.

Any future additional operators must be granted access explicitly under Section 4
and recorded by the owner.

## 4. Access Control & Authentication

- Application access requires **federated sign-in with Google (OAuth/OpenID
  Connect)**. Username/password shared-secret login is **disabled** in production.
- Sign-in is restricted to an **explicit allow-list of authorized Google
  accounts**; all other identities are denied by default.
- **Multi-factor authentication (MFA)** is enforced by the authorized Google
  account's 2-step verification. No account without MFA is authorized.
- Authenticated sessions expire and require re-authentication on a fixed interval
  (currently 7 days).
- Administrative access to the Google Cloud project and source repository is
  protected by the operator's MFA-enabled accounts and the principle of **least
  privilege** (service accounts hold only the permissions required to run).
- Access is reviewed at each policy review (Section 8) and immediately revoked
  when no longer required.

## 5. Data Protection

- **In transit:** all traffic is served over TLS/HTTPS; the hosting platform
  redirects/enforces HTTPS.
- **At rest:** application data is stored in Google Cloud Storage and secrets in
  Google Secret Manager, both encrypted at rest by the platform by default.
- **Secrets:** API keys, OAuth client secrets, and tokens are stored in Secret
  Manager or environment configuration — never committed to source control.
  Files known to contain secrets (`.env`, OAuth token files, credentials files)
  are excluded from version control and from deployment build images.
- **Access tokens** obtained from Plaid and Google are treated as sensitive
  credentials and are stored only in protected storage.

## 6. Acceptable Use & Third Parties

- The system is used only for the owner's personal and professional management
  purposes.
- Third-party processors (Plaid, Google, Anthropic) are used under their
  respective terms; only the minimum data necessary is shared with each, and only
  to deliver the relevant feature.

## 7. Vulnerability, Patch & Change Management

- Application dependencies are reviewed and updated when security-relevant issues
  are identified or at each significant release.
- The underlying runtime and base images are kept on supported, maintained
  versions; end-of-life software is replaced before or promptly after it loses
  vendor support.
- Changes are version-controlled in Git; production deployments are made from
  reviewed source.

## 8. Data Retention, Deletion & Incident Handling

- Data is retained only as long as it is useful to the operator and is deleted
  when no longer needed; the operator can clear application data on demand.
- Connected financial institutions can be **disconnected** within the
  application, revoking the associated access tokens.
- In the event of a suspected compromise, the operator will revoke affected
  credentials/tokens, rotate secrets, and disconnect affected integrations as a
  first response.
- (Detailed data-handling commitments are maintained in the companion **Data
  Retention & Deletion Policy** and **Privacy Policy**, where applicable.)

## 9. Backup & Availability

- Application data is held in durable, replicated cloud storage.
- Source code is maintained in version control (GitHub), enabling redeployment of
  the application if needed.

## 10. Policy Review & Maintenance

- This policy is reviewed at least **annually**, and additionally whenever there
  is a significant change to the application, its data, its infrastructure, or its
  third-party processors.
- Each review updates the **Last reviewed** date and version number above and is
  recorded in the Git history of this file, which serves as the change log.
- The owner approves each revision.

---

### Approval

| Role | Name | Date |
|------|------|------|
| Owner & Operator (approver) | Parker Gent | 2026-06-19 |

*This document is version-controlled. Its commit history in the project
repository constitutes the authoritative record of revisions and review dates.*
