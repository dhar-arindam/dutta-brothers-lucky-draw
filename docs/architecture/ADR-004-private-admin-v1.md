# ADR-004: Admin V1 uses Cognito local-user authentication

- Status: APPROVED
- Date: 2026-09-03
- Owner: Principal Software Engineer

## Context

Admin V1 is a shop-owner operational console intended for fast, low-friction campaign operations.

Approved V1 behavior:

- Route: `/admin`
- Admin page loads operational content directly
- No separate dashboard landing step
- Cognito-managed local users authenticate through the Hosted UI
- OAuth2 Authorization Code + PKCE is used for the browser client
- MFA is disabled for the two V1 Admin users

This decision is aligned with:

- `docs/specs/03-admin/dashboard.md`
- `docs/specs/04-api/api-contract.md`
- `docs/specs/07-acceptance/acceptance-criteria.md`
- `docs/specs/06-architecture/architecture.md`

## Decision

Admin V1 uses Amazon Cognito for app-level authentication.

There is no Google federation, custom password form, or MFA in V1.

The Cognito access token is sent to API Gateway as a Bearer token. A native API Gateway JWT authorizer protects `/api/admin/*`; `/api/draw` remains public.

Customer and admin concerns remain separated by route and endpoint paths.

Backend validation and business-rule enforcement remain mandatory and authoritative.

## Consequences

### Positive

- Managed user lifecycle without Google or a custom identity system.
- Native API Gateway JWT validation without a Lambda authorizer.
- Admin API is protected while the customer draw remains public.

### Trade-offs

- Admin users must be provisioned and removed in Cognito.
- Lost or expired sessions require a new Hosted UI login.
- Operational environments must still enforce standard platform controls (explicit CORS, least-privilege IAM, request limits, monitoring).
- This ADR does not weaken backend business validation or data integrity controls.

## Non-goals for V1

- Google or other external identity federation.
- MFA.
- Role/permission matrices beyond the Admin scope.
- Custom password or token bootstrap flows.

## Notes

This ADR defines the final Admin V1 access model and supersedes the previous unauthenticated decision.
