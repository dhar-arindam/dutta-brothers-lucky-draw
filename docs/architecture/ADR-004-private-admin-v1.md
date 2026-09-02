# ADR-004: Admin V1 operates at /admin with no authentication

- Status: APPROVED
- Date: 2026-08-19
- Owner: Principal Software Engineer

## Context

Admin V1 is a shop-owner operational console intended for fast, low-friction campaign operations.

Approved V1 behavior:

- Route: `/admin`
- Admin page loads operational content directly
- No separate dashboard landing step
- No authentication or identity bootstrap in V1

This decision is aligned with:

- `docs/specs/03-admin/dashboard.md`
- `docs/specs/04-api/api-contract.md`
- `docs/specs/07-acceptance/acceptance-criteria.md`
- `docs/specs/06-architecture/architecture.md`

## Decision

Admin V1 intentionally does not include app-level authentication.

There is no:

- login
- token entry
- token-header authentication
- cookie/session authentication
- Cognito
- OIDC
- OAuth/SSO
- JWT
- authentication bootstrap

Customer and admin concerns remain separated by route and endpoint paths.

Backend validation and business-rule enforcement remain mandatory and authoritative.

## Consequences

### Positive

- Faster and simpler operations for V1 shop-owner workflows.
- Reduced UX friction for campaign management tasks.
- Lower delivery complexity for the seasonal scope.

### Trade-offs

- Admin route is not protected by app-level identity in V1.
- Operational environments must still enforce standard platform controls (explicit CORS, least-privilege IAM, request limits, monitoring).
- This ADR does not weaken backend business validation or data integrity controls.

## Non-goals for V1

- Identity providers or account systems.
- Session lifecycle management.
- Role/permission matrices.
- Authentication bootstrap flows.

## Notes

This ADR defines the final Admin V1 access model and supersedes any prior draft text that referenced token-based V1 admin access.
