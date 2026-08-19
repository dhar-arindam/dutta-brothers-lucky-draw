# AWS Phase 1 Environment and Deployment Contract

Status: Draft for implementation handoff
Owner: Principal Software Engineer
Last Updated: 2026-08-18

## 1. Scope

This contract defines the required deployment inputs and routing behavior for Phase 1 AWS integration hardening.

Architecture in scope:

```text
Browser
  -> CloudFront
      -> S3 (frontend assets and SPA routes)
      -> API Gateway HTTP API (/api/*)
          -> Lambda
              -> DynamoDB
```

No new product features are introduced by this contract.

## 2. Required CDK Context Variables

The CDK application requires `stage` and stage-specific context values.

### Required keys

- `stage`: one of `dev`, `staging`, `prod`
- `frontendOriginDev`
- `frontendOriginStaging`
- `frontendOriginProd`
- `apiThrottleRateLimitDev`
- `apiThrottleBurstLimitDev`
- `apiThrottleRateLimitStaging`
- `apiThrottleBurstLimitStaging`
- `apiThrottleRateLimitProd`
- `apiThrottleBurstLimitProd`

### Guardrails

- `frontendOrigin<Stage>` must be non-empty for the selected stage.
- `stage=prod` must not use localhost or 127.0.0.1 origins.
- Throttling values must be positive numbers.

## 3. Frontend to API Routing Contract

1. Frontend code keeps relative API paths, for example `/api/draw`.
2. CloudFront default behavior serves frontend assets and SPA routes from S3.
3. CloudFront additional behavior routes `/api/*` to API Gateway.
4. API Gateway uses `$default` stage and routes `/api/{proxy+}` to Lambda.
5. CORS preflight is handled by API Gateway configuration and includes approved headers/methods.

## 4. Environment Expectations

### dev

- Frontend origin can be local (`http://localhost:5173`).
- Used for local validation and non-production cloud environments.
- Lower throttle defaults.

### staging

- Frontend origin must be the staging CloudFront/custom domain.
- Production-like routing and CORS must be validated here first.
- Medium throttle defaults.

### prod

- Frontend origin must be production CloudFront/custom domain.
- Localhost origins are explicitly blocked.
- Highest throttle defaults.
- Persistent resources use retain policies.

## 5. Deployment Prerequisites

1. Node.js and npm versions satisfy repository requirements.
2. AWS credentials target the intended account and region.
3. Bootstrap for CDK is completed in the target account/region.
4. `frontend/dist` is built before synth/deploy.
5. Deployment runbooks include Admin V1 no-auth access verification.
6. Context values are provided for the target stage.

## 6. Promotion Runbook (Staging to Production)

1. Validate unit and integration tests locally.
2. Validate infrastructure tests and CDK synth in staging config.
3. Deploy to staging account/environment.
4. Verify:
- customer draw success and duplicate behavior
- admin direct-access behavior with no login/token/session flow
- CORS preflight and browser calls through CloudFront `/api/*`
- API throttling and access logs are emitted
5. Review staging logs and error rates.
6. Confirm production context values and admin no-auth operational checks.
7. Deploy production stack with `stage=prod` and production context values.
8. Run production smoke tests for customer draw and admin endpoints.

## 7. Non-goals

- No change to product behavior or business rules.
- Admin V1 remains intentionally no-auth by approved specification.
- No multi-service or microservice split.
