# GitHub Actions CI/CD (V1)

Status: Implemented for repository automation
Owner: Principal Software Engineer
Last Updated: 2026-08-19

## Objectives

- Enforce CI quality gates on PRs and main.
- Support ephemeral staging deployments.
- Support protected persistent production deployments.
- Use GitHub OIDC for AWS authentication (no long-lived IAM user keys).
- Ensure staging cleanup runs only after successful production deployment and smoke tests.
- Keep default AWS CloudFront domain usage (no custom domain).

## Workflows

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-staging.yml`
- `.github/workflows/deploy-production.yml`
- `.github/workflows/destroy-staging.yml`

## CI Quality Gates

CI runs on:

- pull requests
- pushes to `main`

CI executes:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run test:coverage`
6. `npm run build`
7. `npm run cdk:synth -- --context stage=dev`

CI publishes an immutable validated source artifact (`validated-source`) used by staging validation and production deployment jobs.

Coverage thresholds remain enforced at >= 85 for statements, branches, functions, and lines by package Vitest configs.

## AWS Authentication (OIDC)

All deployment workflows use `aws-actions/configure-aws-credentials` with role assumption.

Required GitHub repository variables:

- `AWS_ACCOUNT_ID` — the target AWS account. Workflows fail before any stack-changing command if this is unset or does not match the assumed role's account.

Required GitHub environment variables:

- staging environment:
  - `AWS_ROLE_ARN_STAGING`
  - `STAGING_FRONTEND_ORIGIN`
- production environment:
  - `AWS_ROLE_ARN_PRODUCTION`
  - `PRODUCTION_FRONTEND_ORIGIN`

Reference trust policy templates are provided in `docs/deployment/aws-oidc-role-trust-policy-examples.json`. Replace `<AWS_ACCOUNT_ID>` with the real account when applying them.

No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` secrets are required.

## Third-Party Action Pinning

Every third-party action is pinned to a full commit SHA with the human-readable version in a trailing comment:

```yaml
uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
```

Floating tags such as `@v4` are mutable and would let a retagged or compromised release reach a workflow that holds OIDC credentials for the AWS account. Do not reintroduce them.

Local reusable workflow references (`uses: ./.github/workflows/ci.yml`) are not pinned, because they resolve within this repository at the triggering commit.

Dependabot is configured for the `github-actions` ecosystem and will propose SHA bumps with the updated version comment.

## Required GitHub Environments

Create environments:

- `staging`
- `production`

Configure environment protection:

- Production environment requires manual approvers.
- Restrict which branches can deploy to production (`main`).

## AWS Guardrails in Workflows

Before any stack-changing command, workflows verify:

- account ID matches the `AWS_ACCOUNT_ID` repository variable
- region is `ap-south-1`

Workflow fails immediately if checks do not match, or if `AWS_ACCOUNT_ID` is unset.

## Stage Isolation and Stack Names

Stage-specific stack names:

- `DuttaDrawFoundationStackDev`
- `DuttaDrawFoundationStackStaging`
- `DuttaDrawFoundationStackProd`

This prevents accidental overlap between staging and production resources.

## Staging Deployment

`deploy-staging.yml` (manual `workflow_dispatch`):

1. Reuses CI quality gates.
2. Assumes staging OIDC role.
3. Verifies account and region.
4. Runs staging synth + diff.
5. Deploys staging stack.
6. Resolves CloudFormation outputs.
7. Runs staging smoke tests.
8. Prints staging URLs.

## Production Deployment

`deploy-production.yml` (manual `workflow_dispatch`):

1. Reuses CI quality gates.
2. Deploys/validates staging first.
3. Runs staging smoke tests.
4. Requires production environment approval before production job executes.
5. Assumes production OIDC role.
6. Verifies account and region.
7. Runs production synth + diff.
8. Deploys production stack.
9. Runs production smoke tests.
10. Destroys staging stack only if staging validation + production deploy + production smoke all succeed.

Build-once/promotion behavior:

- Staging and production jobs consume the same `validated-source` artifact emitted by CI.
- This prevents rebuilding a different commit between staging validation and production deployment.

## Staging Destroy

`destroy-staging.yml` (manual `workflow_dispatch`):

- Requires explicit input: `DESTROY_STAGING`
- Uses staging role only
- Verifies account and region
- Destroys only `DuttaDrawFoundationStackStaging`

## Smoke Tests

Smoke entry points:

- `tests/smoke-staging.mjs`
- `tests/smoke-production.mjs`

They verify non-destructive endpoint availability and core route responsiveness.

## Recommended IAM Trust Policy Restrictions

Restrict staging role trust to:

- this repository only
- the staging environment context
- specific deployment workflow refs

Restrict production role trust to:

- this repository only
- the production environment context
- `refs/heads/main`

Avoid wildcard principal conditions such as `repo:*`.

## Branch Protection Recommendations

Recommended required checks on `main`:

- lint
- typecheck
- test
- coverage
- build
- CDK synth

Recommended repository controls:

- at least one PR approval
- no direct pushes to `main`
- require status checks before merge

## Domain Decision

V1 deployment intentionally uses default CloudFront domain outputs.

For staging and production in this repository, set `STAGING_FRONTEND_ORIGIN` and `PRODUCTION_FRONTEND_ORIGIN` to the default CloudFront URL for the target stack after first provisioning. Do not configure custom Route53/ACM domain wiring in V1.

Not included:

- Route53 custom-domain DNS
- ACM custom-domain certificate
- CloudFront alternate domain name
