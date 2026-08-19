# Request-Size Policy Blocker

Status: RESOLVED
Owner: Principal Software Engineer
Date: 2026-08-18
Scope: Phase 1 Conditional Remediation, Condition 3

Resolution: Policy approved in `specs/04-api/api-contract.md` version 1.2 on 2026-08-18.

## Summary

An explicit approved request-size policy is not currently defined in the active specifications with a concrete numeric limit and enforcement contract.

Per remediation instructions, no size limit is implemented without an approved specification decision.

## Affected API Endpoints

- POST /api/draw
- POST /api/admin/prizes
- PATCH /api/admin/prizes/{prizeId}
- PATCH /api/admin/campaign

These are the JSON-body mutation endpoints currently accepting request payloads.

## Current Request-Size Behavior

- Application code does not apply an explicit byte-size limit before JSON parsing.
- API Gateway HTTP API service defaults are currently relied upon.
- Local Node runtime also has no explicit request-size guard in request-body accumulation.

## Available Enforcement Points

1. API Gateway layer (preferred primary guard for production traffic)
2. Lambda/application layer (secondary deterministic guard and response shaping)
3. Local Node handler layer (dev/test parity guard)

## AWS Platform Constraints and Considerations

- API Gateway HTTP API has platform request-payload limits.
- Lambda invocation/event payload limits apply at runtime.
- Service-level limits alone do not provide an application-specific error contract unless explicitly handled.

## Recommended Limit (Pending Approval)

- Recommendation: 32 KB maximum JSON request body for mutation endpoints in V1.

Rationale:

- Draw/admin mutation payloads are small by contract (name, phone, bill, prize/campaign fields).
- 32 KB is materially above expected operational payloads while reducing abuse surface.
- Leaves room for future metadata fields without encouraging oversized request bodies.

## Security and Operational Impact

- Reduces memory pressure risk from oversized payload reads.
- Limits abuse vectors for large-body request flooding.
- Improves deterministic client behavior when oversized payloads are rejected with a documented response.

## Required Specification Update

Specification update needed before implementation:

1. Maximum request body size (exact bytes/KB)
2. Enforcement layer(s) and precedence
3. Endpoint-specific exceptions, if any
4. Oversized response contract (status code and machine-readable error code)
5. Logging and telemetry expectations for oversize rejections
6. Automated test expectations across backend and infrastructure layers

## Proposed Response Contract (Pending Approval)

- HTTP status: 413 Payload Too Large
- Body shape:
  - status: ERROR
  - code: REQUEST_TOO_LARGE
  - message: Please reduce request size and try again.

This contract is proposed only and not implemented without specification approval.
