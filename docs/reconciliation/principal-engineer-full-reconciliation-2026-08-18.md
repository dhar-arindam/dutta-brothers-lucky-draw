# Principal Engineer Full Reconciliation Review

Status: Historical (Superseded for Admin V1 access model)
Owner: Principal Software Engineer
Date: 2026-08-18
Scope: Frontend + Backend/API + AWS/CDK + Specifications
Constraint: Repository-state review only (no git metadata available in workspace path)

Supersession note (2026-08-19):

- This document is retained for historical traceability.
- Final Admin V1 source of truth is in `/specs`.
- Any references here to `X-Admin-Token` or token-based admin authorization are superseded by the approved no-auth Admin V1 model.

## A. Repository Change Inventory

Because `.git` metadata is not available from the current workspace path, this inventory is based on current file state and implementation evidence only.

### Confirmed implementation surfaces

- Frontend customer journey and reveal flow in `frontend/src/App.tsx`
- Frontend reveal/mobile visual system in `frontend/src/styles.css`
- Frontend API clients in `frontend/src/services/draw-api.ts` and `frontend/src/services/admin-prize-api.ts`
- Backend local node handler in `backend/src/app.ts`
- Backend production Lambda handler in `backend/src/lambda.ts`
- Durable store + DynamoDB atomic claim/aggregate updates in `backend/src/durable-dynamodb-store.ts`
- Admin token secret integration in `backend/src/admin-token.ts`
- CDK stack and deployment wiring in `infrastructure/lib/foundation-stack.ts`

### Notable baseline characteristics

- Active customer reveal is gift-box overlay flow, not wheel rendering.
- Durable backend mode is implemented for production runtime (Lambda + DynamoDB + Secrets Manager).
- Local runtime is in-memory and intentionally AWS-independent.

## B. Frontend Change Review

### Positive alignment

- Gift-box reveal is presentation-only and uses authoritative backend result payload.
- Overlay focus entry/return and keyboard paths are implemented.
- Error, retry, and already-claimed states are represented and tested.
- Mobile-first visual layout has specific support for compact interaction zones.

### Drift and risks

1. `ANTICIPATION` state required by approved specs is not currently rendered as a customer-visible stage.
2. Success path transitions directly from API success to `BOX_REVEAL`, with no explicit anticipation state.
3. Confetti is currently absent; this is now considered acceptable because celebration particles are optional in updated reveal wording.

## C. Backend/API Review

### Positive alignment

- Backend performs authoritative request validation, campaign checks, weighted selection, and claim handling.
- Duplicate bill protection is enforced by atomic persistence semantics in durable mode.
- `ALREADY_CLAIMED` returns original claim details.
- Admin endpoints require `X-Admin-Token` validated server-side.
- CSV export includes formula-injection protection prefixing.

### Drift and risks

1. Optional `Idempotency-Key` retry-correlation header is documented in spec but not yet transmitted by frontend draw client.
2. Unknown route behavior returns `INTERNAL_ERROR` payload with 404, which is safe but semantically non-ideal.

## D. AWS Architecture Review

### Positive alignment

- Private S3 bucket + CloudFront distribution with OAC usage.
- API Gateway HTTP API with explicit CORS and stage throttling.
- Lambda Node.js runtime with DynamoDB and Secrets Manager integration.
- DynamoDB single table + GSI path supports required operational patterns.
- Production-aware removal policies for persistent data resources.

### Drift and open architecture points

1. CORS allow-headers list does not include `Idempotency-Key`.
2. Explicit request-size limit requirement exists in architecture guidance; HTTP API defaults are currently relied upon and not explicitly documented as accepted.

## E. Specification Gap Analysis (Required Classification)

### APPROVED - IMPLEMENTED

- Backend authoritative prize selection and claim creation.
- Bill-number normalization and duplicate prevention.
- `SUCCESS`, `ALREADY_CLAIMED`, `DRAW_ENDED`, `NO_ELIGIBLE_PRIZE`, `VALIDATION_ERROR`, `INTERNAL_ERROR` response patterns.
- Admin prize CRUD subset (`GET/POST/PATCH`) and summary/reporting endpoints.
- Secrets Manager based admin token validation.
- CloudFront/S3/API/Lambda/DynamoDB deployment wiring in CDK.

### APPROVED - NOT YET IMPLEMENTED

- Explicit customer-visible `ANTICIPATION` stage between eligibility and box reveal.
- Explicit frontend transmission of optional `Idempotency-Key` for retry correlation.

### IMPLEMENTATION REQUIRES CHANGE

- Frontend success flow must include `ANTICIPATION -> BOX_REVEAL` sequence per approved customer specs.
- Infrastructure CORS allow-headers should include `Idempotency-Key` for standards-compliant cross-origin retry correlation.

### DRAFT

- None remaining in core active contract specs after this reconciliation pass.

### SUPERSEDED

- Wheel customer reveal spec is now explicitly marked historical/superseded.

### TECHNICAL DEBT

- Route-not-found error body uses `INTERNAL_ERROR` code shape on 404 responses.
- Minor divergence between local node handler and Lambda handler routing behavior should remain intentionally tracked.

### OPEN ARCHITECTURE DECISION

- Whether explicit API request-size enforcement is required beyond HTTP API service defaults for Phase 1.

## F. Updated Specifications

This reconciliation updates specification baseline metadata and intent alignment:

1. `specs/04-api/api-contract.md`
- Status promoted: `DRAFT -> APPROVED`
- Version incremented to 1.1

2. `specs/05-data/data-model.md`
- Status promoted: `DRAFT -> APPROVED`
- Version incremented to 1.1

3. `specs/06-architecture/architecture.md`
- Status promoted: `DRAFT -> APPROVED`
- Version incremented to 1.1

4. `specs/01-customer/wheel.md`
- Status changed to `SUPERSEDED` (historical traceability retained)

5. `specs/01-customer/reveal.md`
- Confetti wording relaxed from mandatory to optional when used

6. `specs/01-customer/lucky-draw.md`
- Success presentation wording aligned to optional confetti usage

## G. Decision Log

1. Decision: Keep gift-box reveal as active customer experience baseline.
- Rationale: Approved UX redesign; backend and API remain authoritative and unchanged.

2. Decision: Keep `ANTICIPATION` as normative requirement.
- Rationale: It is a deliberate UX transition requirement and not an accidental implementation artifact.

3. Decision: Treat confetti as optional visual enhancement.
- Rationale: Recent approved UX iterations removed confetti without harming business behavior.

4. Decision: Promote API/data/architecture specs to approved status.
- Rationale: Implementation has already crossed these boundaries; process baseline must be brought back into SDD compliance.

## H. Test Gap Analysis

### Existing strengths

- Frontend tests validate success flow, overlay behavior, keyboard operation, retry/error paths, and reduced-motion path.
- Backend tests validate weighted selection, duplicate behavior, admin token semantics, and DynamoDB transaction semantics.
- Infrastructure tests validate presence and shape of core AWS resources and security posture patterns.

### Gaps

1. Missing automated assertion for mandatory `ANTICIPATION` customer-visible stage timing window.
2. No explicit test that `Idempotency-Key` is accepted and forwarded end-to-end where applicable.
3. No explicit acceptance-level test for API request-size policy decision.

## I. Implementation Backlog (Prioritized)

P0

1. Reinstate explicit `ANTICIPATION` state in frontend success flow (`CHECKING_ELIGIBILITY -> ANTICIPATION -> BOX_REVEAL -> RESULT`).
2. Add frontend + integration tests for anticipation timing/state progression.

P1

3. Add optional `Idempotency-Key` support in frontend draw client and validate backend acceptance behavior.
4. Add `Idempotency-Key` to API CORS allow-headers in CDK.

P2

5. Normalize route-not-found error contract to a dedicated machine-readable code for 404 paths.
6. Decide and document explicit request-size policy (explicit config vs accepted service default).

## Readiness Gate

READY FOR IMPLEMENTATION WITH CONDITIONS

Conditions:

1. `ANTICIPATION` state must be restored and tested before declaring frontend acceptance complete.
2. Retry-correlation header and CORS alignment should be completed before production hardening sign-off.
3. Request-size policy decision must be documented and approved by Principal Software Engineer.
