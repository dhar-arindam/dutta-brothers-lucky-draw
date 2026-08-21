# Target Architecture

Status: APPROVED  
Owner: Principal Software Engineer  
Version: 1.5
Last Updated: 2026-08-21
Change: Claim lifecycle, contention handling, and deployment provenance
Reason: Align target architecture with implemented runtime and delivery controls

## Technology

- Frontend: React + TypeScript
- Admin styling: Tailwind CSS (Admin screen only)
- Backend: Node.js + TypeScript
- API style: REST
- Infrastructure: AWS CDK + TypeScript
- Monitoring: Amazon CloudWatch
- Secure configuration: environment-specific configuration and least-privilege IAM

## Frontend Hosting

```text
React + TypeScript
        |
        v
CloudFront
        |
        v
S3
```

The React application is static content hosted in a private S3 bucket and distributed through CloudFront.

## Backend

```text
React
  |
  v
API Gateway
  |
  v
AWS Lambda
Node.js + TypeScript
  |
  v
DynamoDB
```

## Principles

- The backend is the source of truth for business-critical behaviour.
- The frontend must not implement authoritative draw rules.
- The backend validates inputs, checks draw status, enforces bill uniqueness, selects the prize, and generates the claim ID.
- Campaign status is derived from configured From Date and To Date in `Asia/Kolkata`; backend enforcement is authoritative.
- DynamoDB must enforce bill uniqueness atomically.
- Claims preserve the historical prize name snapshot.
- Dashboard totals and prize distribution use lightweight DynamoDB aggregate records or counters updated with successful claim creation.
- Claim deletion and clear-all operations update or reset claim-derived aggregates and release deleted normalized bills.
- Transaction cancellation distinguishes duplicate-bill conflicts from transient DynamoDB contention. Only transient contention is retried with bounded backoff.
- No prize inventory or stock management exists.
- Prize activation/deactivation is a required V1 capability and affects future draws only.
- AWS infrastructure is managed using AWS CDK and TypeScript only.
- Infrastructure should remain simple, cost-conscious, and appropriate for a seasonal retail application.
- Do not introduce microservices.
- Do not introduce analytics databases, Redshift, OpenSearch, Athena, or a full-claim scan for dashboard metrics.

## Security Principles

- The S3 bucket must not be publicly readable.
- CloudFront is the public frontend entry point.
- API Gateway uses explicit CORS, throttling, and request limits.
- API Gateway exposes `DELETE /api/admin/claims/{claimId}` and `DELETE /api/admin/claims` for approved admin claim operations.
- IAM permissions follow least privilege.
- All taggable AWS resources created by CDK must include tags `project=lucky-draw` and `organization=dutta-brothers`.
- Customer PII is masked in admin responses and exports.
- V1 has no authentication model for admin routes or admin APIs (no login/token header auth/cookie auth/session/Cognito/OIDC/OAuth/SSO/JWT/bootstrap).
- Campaign dates use `Asia/Kolkata`; APIs use ISO 8601 UTC timestamps where time values are returned and the backend is authoritative for campaign-period enforcement.

## Frontend Isolation Constraint

- Tailwind usage is limited to Admin UI surfaces.
- Customer-facing layout, CSS, components, visual behaviour, and animations must remain unchanged unless separately approved.
- Any Tailwind global reset/preflight impact must be isolated so customer UI is unaffected.

IAM permissions are scoped by function and resource. Lambda receives only the minimum permissions required for its responsibilities. DynamoDB permissions remain least-privilege.

## Build and Deployment Provenance

- CI checks out and builds the exact Git SHA that triggered the workflow.
- CI packages validated source and generated frontend assets as one artifact identified by that SHA.
- Staging deploys the artifact produced by its associated successful CI run and does not independently rebuild application source.
- Artifact identity is immutable and is not based only on a reused generic artifact name.
- Deployment summaries and staging verification record and confirm the deployed Git SHA.
- Frontend deployments must not leave the SPA entry document serving an older cached bundle.

## Infrastructure Scope

CDK may define the required S3, CloudFront, API Gateway, Lambda, DynamoDB, IAM, and CloudWatch resources. No infrastructure code is created by this specification.
