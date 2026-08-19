# Dutta Brothers Festive Lucky Draw
# Implementation Plan

Status: Planning
Source of truth: `/specs`
Project constraint: One developer

Controlled change notice (post-Phase-7):

- Change: Wheel/Envelope -> Festive Gift Box Reveal
- Reason: UX redesign following UI/UX review
- Backend impact: None
- API impact: None

## 1. Implementation Principles

- Follow Spec-Driven Development: SPEC -> REVIEW -> APPROVE -> DESIGN -> IMPLEMENT -> TEST -> REVIEW -> ACCEPT.
- Do not implement a feature without an approved specification and acceptance criteria.
- The backend is authoritative for validation, draw status, bill uniqueness, prize selection, claim creation, claim IDs, and aggregate consistency.
- The frontend owns presentation, interaction, client-side validation, responsive behaviour, API communication, and reveal animation.
- The frontend never selects or determines the winning prize.
- Bill Number is the only participation key and is enforced server-side using the normalized value.
- There is no prize inventory, stock, quantity, or depletion management.
- The customer experience is mobile-first at 360px, 375px, 390px, and 430px.
- The architecture remains a small modular monolith suitable for one developer.
- AWS services are limited to the approved serverless architecture: S3, CloudFront, API Gateway, Lambda, DynamoDB, Secrets Manager, IAM, and CloudWatch.
- Every test must trace to an approved acceptance criterion.
- Approved specifications must not be silently reinterpreted during implementation.

## 2. Architecture

### Frontend

```text
React + TypeScript -> S3 -> CloudFront
```

- Static React application hosted in a private S3 bucket.
- CloudFront is the public frontend entry point.
- Client-side validation provides immediate feedback but is never authoritative.
- The frontend consumes approved API responses and presents the backend-selected prize and claim ID through the approved reveal interaction.

### Backend

```text
React -> API Gateway -> Lambda (Node.js + TypeScript) -> DynamoDB
```

- API Gateway exposes the REST API and applies approved CORS, throttling, and request limits.
- Lambda validates requests, evaluates campaign state, enforces bill uniqueness, selects prizes, creates claims, updates aggregates, and returns contract-shaped responses.
- DynamoDB stores campaigns, prizes, claims, and lightweight dashboard aggregates.
- Claim creation and aggregate updates must preserve exactly-once business behaviour.

### Admin access model (V1)

```text
Admin route (/admin) -> API Gateway -> Lambda
```

- V1 intentionally has no authentication model for admin operations.
- No login, token, session, cookie auth, Cognito, OIDC, OAuth, SSO, JWT, or identity bootstrap is introduced.
- Backend validation and business-rule enforcement remain fully authoritative.
- Customer and admin API routes remain separated by endpoint path.

### Monitoring and infrastructure

- CloudWatch receives operational logs and metrics without unnecessary customer PII.
- AWS CDK + TypeScript defines the approved AWS resources.
- IAM permissions are scoped by function and resource.
- No analytics database, search service, microservice, or additional AWS service is introduced.

## 3. Repository Structure

Proposed structure:

```text
/frontend
  /src
    /components
    /pages
    /services
    /hooks
    /types
    /utils
    /assets
  /tests

/backend
  /src
    /controllers
    /routes
    /services
    /repositories
    /validators
    /models
    /types
    /config
    /utils
  /tests

/shared
  /types
  /contracts

/infrastructure
  /bin
  /lib
  /test

/specs
/docs
/.github
```

Guidelines:

- Keep frontend, backend, shared contracts, and CDK boundaries clear.
- Share API types where useful, but keep business logic in the backend.
- Do not create separate packages or services until a real ownership or build requirement exists.
- Keep tests close to the layer they verify, with cross-layer tests in dedicated integration locations.

## 4. Phase Plan

### Phase 1: Project Scaffolding

#### Objective

Create the minimal React, Node.js, shared-contract, test, and CDK project structure without implementing product features.

#### Specifications used

- [product-overview.md](../specs/00-product/product-overview.md)
- [architecture.md](../specs/06-architecture/architecture.md)
- [copilot-instructions.md](../.github/copilot-instructions.md)

#### Components affected

- Repository structure
- Frontend project configuration
- Backend project configuration
- Shared TypeScript contract location
- CDK project configuration
- Test and lint configuration

#### Agent responsible

Senior Frontend Developer, Senior Backend Developer, and Principal Software Engineer for cross-boundary decisions.

#### Implementation tasks

- Establish the approved directory structure.
- Configure strict TypeScript, linting, formatting, and Vitest.
- Establish frontend, backend, shared, and infrastructure build boundaries.
- Add configuration conventions for development and production without secrets.
- Do not add feature logic, routes, components, stacks, tables, or API handlers in this phase.

#### Tests required

- Toolchain smoke checks.
- TypeScript configuration checks.
- Lint and formatting checks.

#### Exit criteria

- Repository builds its empty approved project surfaces.
- No application feature or infrastructure resource exists.
- CI checks can run locally.

### Phase 2: Backend Customer Draw Vertical Slice

#### Objective

Implement the first meaningful customer draw path from validated request through one successful immutable claim.

#### Specifications used

- [business-rules.md](../specs/00-product/business-rules.md)
- [lucky-draw.md](../specs/01-customer/lucky-draw.md)
- [api-contract.md](../specs/04-api/api-contract.md)
- [data-model.md](../specs/05-data/data-model.md)
- [acceptance-criteria.md](../specs/07-acceptance/acceptance-criteria.md)

#### Components affected

- Backend request validation
- Bill normalization
- Campaign status check
- Eligible prize retrieval
- Weighted prize selection
- Claim repository/service
- Claim ID generation
- Dashboard aggregate update boundary
- Customer draw response contract

#### Agent responsible

Senior Backend Developer, with Principal Software Engineer review for atomicity and contract compliance.

#### Implementation tasks

- Validate name, phone, and bill deterministically.
- Normalize and persist the canonical bill number.
- Check campaign status using the approved timezone rules.
- Retrieve active positive-weight prizes for the current campaign.
- Select the winning prize using the approved relative-weight rules.
- Enforce ONE BILL = ONE CLAIM atomically or conditionally.
- Create an immutable claim with server-generated claim ID and timestamp.
- Update overall, campaign-date, and prize-distribution aggregates exactly once with successful claim creation.
- Return the approved success and already-claimed response shapes.

#### Tests required

- **Validation:** invalid phone rejected; invalid name rejected; invalid bill rejected; blank and whitespace-only values rejected; maximum-length and unsupported-character validation; bill normalization examples.
- **Draw lifecycle:** draw-ended request rejected; active draw accepted.
- **Prize selection:** active positive-weight prizes retrieved; weighted prize selected; inactive prizes excluded; invalid weights rejected or excluded according to the approved specification; no eligible prize handled correctly.
- **Bill uniqueness:** first valid bill succeeds; duplicate bill rejected; same normalized bill rejected; concurrent duplicate requests cannot create multiple claims.
- **Claim:** successful claim created; claim ID generated server-side; claim contains the correct prize snapshot and server timestamp.
- **Dashboard aggregates:** successful claim increments aggregates exactly once; duplicate claim does not increment; concurrent duplicate does not increment twice; retry does not increment again; validation failure does not increment; draw-ended request does not increment; no-eligible-prize request does not increment.

#### Exit criteria

- A valid active-draw request retrieves eligible prizes, selects one according to relative weights, creates exactly one immutable claim, generates the server-side claim ID, updates aggregates exactly once, and returns the approved success response.
- Draw-ended, no-eligible-prize, validation, duplicate, concurrent, and retry paths return the approved behaviour without creating duplicate claims or counters.
- All Phase 2 validation, lifecycle, selection, uniqueness, claim, and aggregate tests pass.
- No frontend or client value can determine eligibility, prize selection, claim identity, or aggregate state.

### Phase 3: Customer Frontend and API Integration

#### Objective

Connect the mobile-first customer form to the approved draw contract and render basic results.

#### Specifications used

- [lucky-draw.md](../specs/01-customer/lucky-draw.md)
- [api-contract.md](../specs/04-api/api-contract.md)
- [acceptance-criteria.md](../specs/07-acceptance/acceptance-criteria.md)

#### Components affected

- Customer form
- Inline validation
- Loading and disabled states
- API client
- Success, already-claimed, draw-ended, no-prize, and error states

#### Agent responsible

Senior Frontend Developer.

#### Implementation tasks

- Implement name, numeric phone, and bill inputs.
- Apply the approved mobile keyboard and autocorrect behaviour.
- Prevent double submission.
- Consume backend responses without selecting a prize.
- Display the approved prize, claim ID, and user guidance.
- Keep the reveal animation as a later phase.

#### Tests required

- Form validation and inline errors.
- Loading and disabled draw-CTA state.
- Successful draw.
- Already claimed with original claim details.
- Draw ended and no eligible prize.
- API and network failure handling.
- Mobile keyboard and touch interaction tests.

#### Exit criteria

- The customer can submit a valid request from the mobile UI.
- All approved customer states render correctly.
- The frontend never generates a prize or claim ID.

### Phase 4: Prize Configuration and Administration

#### Objective

Complete the remaining V1 prize configuration and administration capabilities after the customer draw selection path is working.

#### Specifications used

- [prize-management.md](../specs/02-prizes/prize-management.md)
- [weighted-selection.md](../specs/02-prizes/weighted-selection.md)
- [business-rules.md](../specs/00-product/business-rules.md)
- [api-contract.md](../specs/04-api/api-contract.md)

#### Components affected

- Prize domain model
- Prize repository
- Prize admin operations

#### Agent responsible

Senior Backend Developer.

#### Implementation tasks

- Reject zero and negative configuration updates.
- Add prize creation, weight update, activation, and deactivation operations.
- Preserve historical prize snapshots.
- Do not add stock, quantity, or depletion fields.

#### Tests required

- New active prize eligibility.
- Weight change affecting future draws.
- Deactivation and reactivation.
- Invalid configuration update rejection.
- Historical claim immutability.

#### Exit criteria

- Customer draw selection remains backend-owned from Phase 2.
- Prize configuration changes affect future draws only.
- Invalid configurations cannot become eligible.
- No inventory concept exists in the data or API model.

### Phase 5: Wheel Implementation (Historical, Deprecated)

#### Objective

Render the backend-selected prize using the previously approved deterministic wheel mathematics.

This phase is retained for historical traceability and was superseded for active UX by the controlled change in Phase 7.5.

#### Specifications used

- [wheel.md](../specs/01-customer/wheel.md)
- [lucky-draw.md](../specs/01-customer/lucky-draw.md)
- [api-contract.md](../specs/04-api/api-contract.md)

#### Components affected

- Wheel component
- Sector roster mapping
- Pointer and responsive layout
- Result display synchronization

#### Agent responsible

Senior Frontend Developer, with Senior UI/UX Designer review for responsive presentation.

#### Implementation tasks

- Consume the backend winning prize ID and ordered `sectorPrizeIds` roster.
- Preserve deterministic ascending prize-ID ordering.
- Map the winning prize to zero-based sector index `i`.
- Use `N` roster sectors and `W = 360 / N`.
- Use clockwise angles from the upward axis.
- Use pointer angle `P = 180` degrees.
- Calculate `C_i = (i + 0.5) * W`.
- Calculate `delta = normalize(P - (C_i + R_current), 360)`.
- Use `R_final = R_current + (M * 360) + delta`, with fixed `M >= 3`.
- Animate clockwise with an ease-out curve and no random final offset.
- Keep prize labels, names, icons, and images off the wheel.
- Keep result text synchronized with the backend prize.

#### Tests required

- Every configured eligible prize sector.
- Six-prize mathematical example.
- Current rotation handling.
- Pointer alignment and final-sector calculation.
- No misleading animation for non-success states.
- Wheel responsiveness at 360px, 375px, 390px, and 430px.

#### Exit criteria

For every eligible prize:

```text
backend prize ID = frontend sector = calculated rotation = sector under pointer = displayed prize
```

### Phase 6: Retry, Error, and Concurrency Hardening

#### Objective

Verify failure, retry, and race-condition behaviour across the vertical slice.

#### Specifications used

- [business-rules.md](../specs/00-product/business-rules.md)
- [lucky-draw.md](../specs/01-customer/lucky-draw.md)
- [api-contract.md](../specs/04-api/api-contract.md)
- [data-model.md](../specs/05-data/data-model.md)
- [acceptance-criteria.md](../specs/07-acceptance/acceptance-criteria.md)

#### Components affected

- Draw service
- Claim repository
- Aggregate update boundary
- Frontend retry handling
- API error mapping

#### Agent responsible

Senior Backend Developer and Senior Frontend Developer, with Principal Software Engineer review.

#### Implementation tasks

- Verify atomic claim creation under concurrency.
- Ensure a lost response followed by retry returns `ALREADY_CLAIMED`.
- Ensure different customers cannot reuse a normalized bill.
- Ensure counter updates are not repeated.
- Map validation, draw-ended, no-prize, unauthorized, and internal errors consistently.
- Use the optional idempotency key only as a retry correlation mechanism, not as a replacement for bill uniqueness.

#### Tests required

- Lost response and retry.
- Concurrent same-bill requests.
- Different-customer same-bill requests.
- Validation failure with no claim or counter update.
- Draw-ended request with no claim or counter update.
- No-eligible-prize request with no claim or counter update.
- Internal failure before claim creation with no counter update.

#### Exit criteria

- Exactly one claim can exist for a normalized bill.
- Exactly one aggregate increment occurs for a successful claim.
- No failure or retry path creates a duplicate claim or counter increment.

### Phase 7: Admin Claims Dashboard

#### Objective

Implement bounded admin claims viewing with the approved Admin V1 access model, search, filters, pagination, and CSV contract.

#### Specifications used

- [dashboard.md](../specs/03-admin/dashboard.md)
- [api-contract.md](../specs/04-api/api-contract.md)
- [data-model.md](../specs/05-data/data-model.md)
- [acceptance-criteria.md](../specs/07-acceptance/acceptance-criteria.md)

#### Components affected

- Claims API client
- Claims table
- Search and filters
- Pagination
- CSV export

#### Agent responsible

Senior Frontend Developer and Senior Backend Developer.

#### Implementation tasks

- Keep admin operations accessible without authentication in V1.
- Return masked phone numbers and operationally visible bill numbers.
- Implement exact/prefix claim ID and normalized bill search.
- Implement case-insensitive prefix customer and prize search.
- Bound page size and use opaque continuation tokens.
- Export only approved fields.
- Prefix formula-sensitive CSV values with an apostrophe before normal quoting.

#### Tests required

- Direct admin access without login/token/session flow.
- Claims listing and newest-first ordering.
- Date and prize filters.
- Search matching rules.
- Pagination and opaque token behaviour.
- PII masking and bill visibility.
- CSV fields, formula protection, quotes, commas, and line breaks.

#### Exit criteria

- Admin claims are bounded, searchable, filterable, and exportable.
- Internal database keys and unnecessary PII are never exposed.
- No authentication step exists for Admin V1 requests.

### Phase 7.5: Controlled Customer Reveal Redesign (Wheel/Envelope -> Gift Box)

#### Objective

Replace the active customer-facing reveal mechanism from wheel/envelope presentation to a staged festive gift box experience without changing backend business logic or API behaviour.

#### Specifications used

- [lucky-draw.md](../specs/01-customer/lucky-draw.md)
- [reveal.md](../specs/01-customer/reveal.md)
- [wheel.md](../specs/01-customer/wheel.md) (deprecated historical reference)
- [api-contract.md](../specs/04-api/api-contract.md)
- [acceptance-criteria.md](../specs/07-acceptance/acceptance-criteria.md)

#### Components affected

- Customer landing section, compact form section, and reveal/result presentation components
- Customer state machine (`LANDING` -> `FORM` -> `CHECKING_ELIGIBILITY` -> `ANTICIPATION` -> `BOX_REVEAL` -> `RESULT`)
- Existing special/error states (`ALREADY_CLAIMED`, `DRAW_ENDED`, `NO_ELIGIBLE_PRIZE`, `API_ERROR`, `NETWORK_ERROR`, `RETRY`)
- Animation orchestration (anticipation + reveal) and reduced-motion behaviour
- Accessibility semantics, live announcements, and focus management for state transitions
- Mobile layout behavior and CTA ergonomics at 360/375/390/430
- Customer UX tests and responsive checks

#### Agent responsible

Senior Frontend Developer with Principal Software Engineer review for backend-authority and contract integrity.

#### Implementation tasks

- Replace wheel/envelope-specific UI with staged landing/form/anticipation/box-reveal/result presentation.
- Keep the full gift box as a dedicated reveal state only; do not keep a large reveal object as a persistent form ornament.
- Keep form compact, with existing approved inputs/validation unchanged and one dominant CTA.
- Keep authoritative prize and claim data sourced only from backend response.
- Ensure frontend never performs prize selection or claim ID generation.
- Implement anticipation transition (~0.8-1.2s under normal motion) without implying client-side selection.
- Implement dedicated BOX_REVEAL state with tap-to-open interaction and result transition.
- Implement reduced-motion equivalent for anticipation/reveal with full information parity.
- Enforce accessibility requirements: WCAG AA contrast, visible focus, keyboard operability, 44x44 touch targets, semantic announcements, and reveal-to-result focus management.
- Validate 360px, 375px, 390px, and 430px layouts with no horizontal overflow, centered reveal, readable prize/claim ID, and thumb-reachable CTA.
- Preserve all approved non-success state behaviour and explicit API_ERROR/NETWORK_ERROR/RETRY distinction.

#### Tests required

- Landing screen rendering: short headline/promise and single dominant CTA.
- Compact form rendering: no persistent full gift-box hero, existing validations unchanged.
- Anticipation transition and timing budget verification.
- Anticipation timing QA: under normal motion, verify `ANTICIPATION -> BOX_REVEAL` transition within 0.65-1.35 seconds after successful authoritative response.
- Anticipation timing automation note: where timer precision is unreliable, verify configured duration and state sequencing in automated tests, then verify observed timing in runtime QA.
- Dedicated reveal progression and reveal-to-result transition on `SUCCESS`.
- Immersive overlay presentation for anticipation, reveal, and result.
- Backend response to result integrity (prize, claim ID, timestamp parity).
- No customer-visible technical API processing stage messaging.
- Non-success states do not trigger misleading winning reveal.
- Explicit API_ERROR/NETWORK_ERROR rendering and RETRY transition checks.
- Reduced-motion path with equivalent result information and controls, without forcing full anticipation animation wait.
- Accessibility checks: semantic announcements, focus management, keyboard operation, non-color-only status signaling.
- Mobile checks at 360/375/390/430 for overflow, CTA reachability, centered reveal, and result readability.
- Success-only confetti/sparkle behavior that does not obscure prize, claim ID, or controls.
- Mobile CTA QA at 360/375/390/430: CTA fully visible and operable without horizontal scrolling/zooming, minimum 44x44 touch target, not obscured/overlapped, focus-visible, and safe-area/sticky-element resilient.

#### Exit criteria

- Customer flow uses `LANDING -> FORM -> (BACKGROUND PROCESSING, NOT CUSTOMER-VISIBLE) -> ANTICIPATION -> BOX_REVEAL -> RESULT` for success path.
- Customer reveal uses festive gift box opening as the active interaction.
- Result remains in the same immersive overlay through completion controls.
- Backend and API contracts remain unchanged.
- Business rules remain backend-authoritative.
- Acceptance criteria for reveal and mobile behaviour pass.

Implementation scope boundary for this phase:

- Frontend presentation/state/animation/accessibility/mobile validation only.
- No new backend phase is introduced.
- No backend, API contract, data model, or infrastructure changes are introduced by this phase.

### Phase 8 UX Clarification Gate (Frontend QA Only)

This clarification gate is a frontend QA refinement only and does not add backend, API, data-model, or infrastructure scope.

Required validation additions:

- anticipation timing QA with target 0.8-1.2 seconds and accepted observed range 0.65-1.35 seconds under normal motion
- reduced-motion validation ensuring users are not forced to wait for full anticipation animation
- mobile CTA reachability QA at 360px, 375px, 390px, and 430px

Traceability chain for this gate:

`UX requirement -> specification -> acceptance criterion -> frontend implementation -> automated/runtime QA`

### Phase 8: Admin Summary

#### Objective

Implement aggregate dashboard reporting and campaign configuration.

#### Specifications used

- [dashboard.md](../specs/03-admin/dashboard.md)
- [api-contract.md](../specs/04-api/api-contract.md)
- [data-model.md](../specs/05-data/data-model.md)
- [business-rules.md](../specs/00-product/business-rules.md)

#### Components affected

- Summary endpoint and dashboard cards
- Aggregate repository/service
- Campaign configuration screen and endpoint

#### Agent responsible

Senior Backend Developer and Senior Frontend Developer.

#### Implementation tasks

- Read overall, daily, and prize-distribution counters.
- Keep aggregate updates coupled to successful claim creation.
- Implement campaign configuration retrieval and end-date update.
- Use `Asia/Kolkata` for campaign-day reporting and UTC ISO 8601 API timestamps.
- Do not calculate dashboard metrics by loading all claims or scanning the table.

#### Tests required

- Overall summary.
- Daily campaign-date summary.
- Prize distribution.
- Exactly-once successful claim counter updates.
- No counter updates for all rejected/error/retry states.
- Campaign end-date update and status reporting.

#### Exit criteria

- Dashboard metrics come from lightweight aggregate records or counters.
- Campaign reporting follows the approved contract.
- Prize administration was completed in Phase 4.

### Phase 9: AWS CDK Infrastructure

#### Objective

Define the approved AWS serverless resources and least-privilege access using CDK.

#### Specifications used

- [architecture.md](../specs/06-architecture/architecture.md)
- [data-model.md](../specs/05-data/data-model.md)
- [api-contract.md](../specs/04-api/api-contract.md)
- [copilot-instructions.md](../.github/copilot-instructions.md)

#### Components affected

- CDK application
- S3 and CloudFront
- API Gateway
- Lambda
- DynamoDB
- IAM
- CloudWatch

#### Agent responsible

Principal Software Engineer for architecture and security review; implementation by the relevant developer role.

#### Implementation tasks

- Use a small number of CDK stacks or constructs.
- Create a private S3 frontend origin and CloudFront distribution.
- Create API Gateway with approved CORS, throttling, and request limits.
- Create Lambda functions with scoped execution roles.
- Create DynamoDB resources for claims, prizes, campaign configuration, and aggregates.
- Grant DynamoDB permissions only to the resources and operations required by each function.
- Configure CloudWatch logs and operational metrics without unnecessary PII.
- Configure production data protection and environment-specific removal policies.

#### Tests required

- CDK unit tests where applicable.
- `cdk synth`.
- IAM policy assertions.
- Private S3 and CloudFront origin assertions.
- API Gateway security configuration assertions.
- DynamoDB protection and environment policy assertions.

#### Exit criteria

- CDK compiles and synthesizes.
- Security-sensitive resources and IAM policies are reviewed.
- No deployment is assumed from synthesis alone.

### Phase 10: End-to-End Testing and Production Hardening

#### Objective

Verify the complete customer and admin workflows against deployed development infrastructure and harden operational behaviour.

#### Specifications used

- All approved specifications under `/specs`.
- [acceptance-criteria.md](../specs/07-acceptance/acceptance-criteria.md)

#### Components affected

- Complete frontend
- Complete backend
- CDK environment
- CloudWatch logging and alarms

#### Agent responsible

All specialist roles used by one developer, coordinated by the Principal Software Engineer.

#### Implementation tasks

- Execute acceptance tests end to end.
- Verify customer, retry, duplicate, admin, summary, prize, and campaign flows.
- Verify mobile layout and reveal behaviour at all required widths.
- Verify logs do not expose secrets or unnecessary PII.
- Verify throttling, CORS, and IAM boundaries.
- Review rollback and data-protection behaviour.

#### Tests required

- Browser end-to-end tests.
- API integration tests.
- Concurrency tests against development persistence.
- Responsive tests at 360px, 375px, 390px, and 430px.
- Smoke tests for admin direct-access flow, summary, CSV, and campaign configuration.

#### Exit criteria

- All approved acceptance criteria pass.
- No critical security or data-integrity findings remain.
- Production verification steps are documented and repeatable.

### Phase 11: Deployment and Production Verification

#### Objective

Deploy approved infrastructure and application artifacts through development verification into production, only after explicit deployment approval.

#### Specifications used

- [architecture.md](../specs/06-architecture/architecture.md)
- [acceptance-criteria.md](../specs/07-acceptance/acceptance-criteria.md)
- [copilot-instructions.md](../.github/copilot-instructions.md)

#### Components affected

- CDK stacks
- Frontend assets
- Lambda artifacts
- API Gateway stages
- CloudWatch dashboards/logs

#### Agent responsible

Principal Software Engineer for release approval and infrastructure review; implementation by the relevant developer role.

#### Implementation tasks

- Synthesize and review the CDK change.
- Deploy development infrastructure.
- Upload frontend assets and verify CloudFront delivery.
- Deploy backend artifacts and verify API Gateway integration.
- Run development smoke and acceptance tests.
- Review `cdk diff` before production.
- Deploy production only after explicit approval.
- Run production verification and document rollback steps.

#### Tests required

- Development smoke tests.
- Production health and draw-flow smoke tests.
- Admin direct-access behavior test (no auth/token/session bootstrap).
- Draw-end enforcement test.
- Claim, retry, aggregate, and reveal-result verification.

#### Exit criteria

- Development verification passes.
- Production deployment is explicitly approved and successful.
- Production smoke tests pass.
- No claim is considered valid until backend and persistence verification succeeds.

## 5. API Implementation Map

| Endpoint | Purpose | Frontend | Lambda | Validation | DynamoDB | Response |
|---|---|---|---|---|---|---|
| `POST /api/draw` | Customer draw | Form submits approved fields; renders state | Orchestrates validation, campaign, bill, selection, claim, counters | Name, phone, bill, normalization, draw state | Atomic bill claim, claim creation, aggregate updates, prize/campaign reads | `SUCCESS`, `ALREADY_CLAIMED`, `DRAW_ENDED`, `NO_ELIGIBLE_PRIZE`, `VALIDATION_ERROR`, `INTERNAL_ERROR` |
| `GET /api/admin/claims` | Bounded claims listing | Admin table, filters, search, pagination | Parses query and returns approved data | Page size, dates, prize, search rules | Claim listing and approved filters | Claims, masked phone, opaque next token |
| `GET /api/admin/claims.csv` | Approved claims export | Download/export action | Queries approved set and sanitizes cells | Filters, CSV field rules | Claim query | Approved CSV only |
| `GET /api/admin/summary` | Dashboard aggregates | Summary cards and prize distribution | Reads counters and campaign reporting view | Campaign reporting semantics | Overall, daily, and prize counters | Summary object without internal keys |
| `GET /api/admin/prizes` | Retrieve prizes | Prize list/configuration UI | Reads configuration | Prize rules | Prize records | Prize list |
| `POST /api/admin/prizes` | Add prize | Prize form submits name, weight, active | Validates and creates prize | Name, positive weight, active status | Conditional prize creation | Created prize and timestamps |
| `PATCH /api/admin/prizes/{prizeId}` | Change weight/activation | Prize edit action | Validates and updates prize | Positive weight, active status | Conditional immutable-identity update | Updated prize |
| `GET /api/admin/campaign` | Retrieve campaign | Draw status/configuration view | Reads campaign configuration | Timestamp conversion and date semantics | Campaign record | Campaign status and timestamps |
| `PATCH /api/admin/campaign` | Update campaign dates | Campaign configuration form | Validates dates and updates campaign | Timezone, start/end rules | Conditional configuration update | Updated campaign |

## 6. Data Implementation Map

### Claims

Logical responsibilities:

- Store server-generated claim ID.
- Store customer name and phone according to approved privacy rules.
- Store normalized bill number for the only uniqueness key.
- Optionally retain displayed bill number for operational display.
- Store prize ID and prize name snapshot.
- Store server-generated claim timestamp.
- Keep claims immutable after creation.

Required operations:

- Atomically claim an unused normalized bill.
- Retrieve by claim ID.
- List, filter, and paginate claims for admin use.

Physical DynamoDB keys and indexes remain an implementation-design decision.

### Prizes

#### Customer Draw Prize Access

Purpose: retrieve prizes eligible for customer draw selection.

- Retrieve active prizes only.
- Retrieve positive-weight prizes only.
- Restrict the set to the current campaign configuration.
- Return data suitable for backend weighted selection.
- This access pattern is used by the customer draw Lambda in Phase 2.

#### Admin Prize Configuration Access

Purpose: retrieve all configured prizes for administration.

- Retrieve active and inactive prizes.
- Retrieve prize configuration, weight, status, and other approved admin fields.
- This access pattern is used by admin functionality in Phase 4 and Phase 8.

These are distinct logical access patterns even if they use the same DynamoDB table or index.

Shared prize responsibilities:

- Store ID, name, positive relative weight, active status, and timestamps.
- Reject invalid weight configuration.
- Preserve prize identity and historical snapshots.
- No stock, quantity, or depletion fields.

### Campaign configuration

- Store campaign identifier, status, timezone, start/end timestamps, and audit timestamps.
- Interpret campaign boundaries in `Asia/Kolkata`.
- Expose timestamps as UTC ISO 8601 values.

### Dashboard aggregates

Logical counters:

- Overall `totalSuccessfulSpins`.
- Daily `successfulSpins` keyed by `Asia/Kolkata` campaign date.
- Prize distribution `prizeId`, `prizeName`, and `successfulSpins`.

The implementation must evaluate a DynamoDB transaction or equivalent atomic strategy that creates the claim and updates all applicable counters together. A failed transaction must not leave a claim or partial counter update.

### Admin access model (V1)

- Admin V1 intentionally uses no authentication.
- No token, session, or identity bootstrap is introduced.
- Keep backend validation authoritative and customer/admin routes separated.

## 7. Wheel Implementation Map (Historical, Deprecated)

The previously approved flow was:

```text
Backend winning prize
-> winning prize ID
-> deterministic ordered sector roster
-> zero-based sector index i
-> sector centre angle C_i
-> pointer angle P = 180 degrees
-> clockwise rotation calculation
-> fixed multiple rotations M >= 3
-> final rotation
-> ease-out animation
-> result display
```

Approved mathematics:

```text
N = number of prize IDs in the roster
W = 360 / N
C_i = (i + 0.5) * W
P = 180
normalize(x, 360) = ((x % 360) + 360) % 360
delta = normalize(P - (C_i + R_current), 360)
R_final = R_current + (M * 360) + delta
```

The roster is ordered by immutable prize ID. The frontend maps the backend prize ID to `i`, but never chooses the prize. Positive rotation is clockwise, angles are measured clockwise from the upward axis, and the pointer faces downward.

The result is synchronized only after the backend result is known. The sector under the pointer, the selected prize ID, and displayed winning text must be the same result. Non-success states do not animate a winning wheel.

Active customer reveal behaviour is now defined in [reveal.md](../specs/01-customer/reveal.md) as festive gift box reveal.

## 8. Admin Implementation Map

### Claims

- Use the approved bounded page size and opaque page token.
- Support date and prize filters.
- Support exact/prefix claim ID and normalized bill search.
- Support case-insensitive prefix customer and prize-name search.
- Display masked phone, operational bill number, prize, claim ID, customer name, and Asia/Kolkata display time.

### Summary

- Read overall, current campaign-date, and prize-distribution aggregates.
- Never calculate metrics by loading all claims into the browser.
- Never require a full DynamoDB scan.
- Ensure counters represent successful claims only.

### Prize management

- Add a prize with initial active status.
- Update positive relative weight.
- Activate or deactivate.
- Preserve historical claims.

### Campaign

- Read and update campaign configuration.
- Enforce backend draw-end decisions.
- Use Asia/Kolkata for campaign semantics and UTC for API timestamps.

### CSV

- Export only approved fields.
- Mask phone numbers.
- Keep bill number visible for operational verification.
- Prefix cells beginning with `=`, `+`, `-`, or `@` with a single apostrophe before standard CSV quoting.
- Do not export internal database IDs or unnecessary PII.

## 9. Infrastructure Plan

Use a small CDK application with a minimal number of logical stacks or constructs. The exact boundary is an implementation-design choice, but avoid splitting every resource into a separate stack.

### Resource plan

- **S3:** private frontend asset bucket.
- **CloudFront:** frontend distribution with restricted private S3 origin.
- **API Gateway:** REST API, approved CORS, throttling, and request limits.
- **Lambda:** customer draw and admin API responsibilities, separated only where it improves IAM or operational clarity.
- **DynamoDB:** claims, prizes, campaign configuration, and lightweight aggregates.
- **IAM:** function- and resource-scoped permissions.
- **CloudWatch:** logs, metrics, and operational monitoring.

### Dependencies

```text
S3 -> CloudFront
DynamoDB -> Lambda
Lambda -> API Gateway
CloudWatch -> Lambda/API/infrastructure monitoring
IAM -> every resource access path
```

### IAM boundaries

- Customer API functions receive only required DynamoDB access.
- Admin API functions receive only required DynamoDB access.
- No broad wildcard permissions without documented approval.

## 10. Testing Strategy

Tests are traced from approved acceptance criteria to the phase that implements them.

| Acceptance area | Test types | Primary phase |
|---|---|---|
| Valid customer draw | Backend unit, API integration, frontend test, E2E | 2-3 |
| Name/phone/bill validation | Validator unit, API tests, frontend tests | 2-3 |
| Bill normalization | Validator unit and integration tests | 2 |
| Duplicate bill and different customer/device/browser | Repository integration and API tests | 2, 6 |
| Concurrent duplicate requests | Concurrency integration tests against persistence | 6 |
| Retry after lost response | API integration and frontend retry tests | 6 |
| Relative weighted selection | Backend unit/statistical tests | 4 |
| Invalid and corrupted prize configuration | Backend unit/API tests | 4 |
| New, changed, deactivated, and reactivated prizes | Backend integration and admin tests | 4, 8 |
| No inventory | Data-contract and API schema tests | 4 |
| Draw-end enforcement | Backend time-boundary tests and API tests | 6, 8 |
| Claim ID and server timestamp | Backend unit/API tests | 2 |
| Gift box reveal completion | Frontend integration and E2E tests | 7.5 |
| Backend-result to reveal/result parity | Frontend integration tests | 7.5 |
| Non-success no-misleading-reveal behaviour | Frontend integration tests | 7.5 |
| Reduced-motion reveal behaviour | Frontend accessibility tests | 7.5 |
| Reveal responsive behaviour | Browser viewport tests at 360/375/390/430px | 7.5, 10 |
| Customer error states | Frontend and API tests | 3, 6 |
| Admin authorization | API integration tests | 7, 9 |
| Claims search/filter/pagination | API and frontend tests | 7 |
| CSV masking and formula protection | Backend export tests | 7 |
| Summary counters and no double-counting | Transaction/integration tests | 6, 8 |
| Prize distribution and daily reporting | API, data-access, and admin tests | 8 |
| IAM boundaries and logging safety | CDK assertions and deployed smoke tests | 9, 10 |
| CloudFront/S3/API configuration | CDK assertions and smoke tests | 9-11 |

### Approved Definition of Done mapping

- Functional requirements: phases 2-8 and acceptance tests.
- TypeScript, lint, and builds: every phase and CI.
- Business rules: backend tests and API integration tests.
- Error handling: phases 3 and 6.
- Accessibility and mobile behaviour: phases 3, 5, and 10.
- CDK compilation, tests, synth, and diff review: phase 9.
- IAM and production data protection review: phases 9-11.
- Production verification: phase 11.

## 11. Local Development Strategy

- Run the React frontend and Node.js backend as separate local processes with a configured local API base URL.
- Use dependency injection for repositories and services.
- Use in-memory or deterministic test doubles for fast unit and frontend tests.
- Use backend integration tests against a controlled test persistence environment where available.
- Do not introduce LocalStack by default; use it only if a concrete AWS integration gap cannot be covered by tests and a real development AWS environment is unsuitable.
- Never place customer secrets in local source files or committed environment files.
- Run frontend, backend, shared-type, and CDK checks independently and through the same commands used by CI.

## 12. CI/CD Strategy

Use a lightweight pipeline appropriate for one developer:

1. Install locked dependencies.
2. Run formatting and lint checks.
3. Run strict TypeScript checks.
4. Run frontend, backend, shared, and CDK tests.
5. Build frontend, backend, and infrastructure packages.
6. Run `cdk synth`.
7. Run `cdk diff` for review in deployment workflows.
8. Deploy only from an explicitly approved release workflow.
9. Run smoke tests after deployment.

Do not introduce additional CI platforms, release services, or deployment abstractions unless required by the repository environment.

## 13. Deployment Strategy

### Development

- Synthesize and review CDK.
- Deploy development resources.
- Deploy Lambda artifacts and frontend assets.
- Verify API Gateway, CloudFront, S3, DynamoDB, and CloudWatch integration.
- Run smoke and acceptance tests.

### Production

- Review approved specification traceability and test results.
- Review `cdk diff`, IAM policies, data protection, and environment configuration.
- Deploy infrastructure through CDK.
- Deploy backend Lambda artifacts.
- Upload frontend assets to the private S3 bucket and invalidate or refresh CloudFront as required.
- Run production smoke tests before campaign use.

### Rollback considerations

- Use CDK deployment history and application artifact versions.
- Do not delete or recreate production claim data as a rollback strategy.
- Preserve immutable claims and aggregate consistency.
- Treat Admin V1 route exposure as an operational risk and maintain approved platform protections.
- Disable the draw through approved campaign configuration if a business-safe stop is required.

## 14. Production Verification

Verify:

- CloudFront serves the frontend from private S3.
- Customer draw API accepts valid requests and rejects invalid requests.
- Bill uniqueness holds under concurrent requests and retries.
- Claim IDs and timestamps are server-generated.
- Draw end is enforced by the backend.
- Prize selection is backend-owned and weighted correctly.
- Reveal result text and claim ID match the authoritative API response.
- Dashboard aggregates equal successful claims and do not double-count.
- Admin V1 access remains no-auth by design while backend validation and route separation remain enforced.
- Admin claims, summary, prizes, campaign, and CSV operations work within the contract.
- Phone masking, bill visibility, CSV formula protection, and PII limits hold.
- CloudWatch logs support diagnosis without unnecessary PII or secrets.
- Mobile smoke tests pass at 360px, 375px, 390px, and 430px.

## 15. Risks

| Risk | Mitigation |
|---|---|
| DynamoDB check-then-create race | Use conditional/transactional claim creation keyed by normalized bill. Test simultaneous requests. |
| Dashboard counter double-counting | Couple claim creation and aggregate updates atomically; test every failure and retry path. |
| Reveal-state mismatch | Keep reveal state transitions deterministic and test result parity against authoritative backend response. |
| Unauthenticated Admin V1 access risk | Keep explicit CORS, request limits, logging/monitoring, least-privilege IAM, and tight operational routing controls. |
| Excessive PII logging | Redact or avoid customer PII in CloudWatch logs and export only approved fields. |
| Mobile layout overflow | Use responsive sizing and test all approved viewport widths. |
| Weighted selection drift | Keep selection backend-only and test relative ratios and configuration changes. |
| Retry after lost response | Return original claim details as `ALREADY_CLAIMED`; never create or count a second claim. |
| Draw end race | Evaluate campaign state server-side at request time using `Asia/Kolkata` semantics. |
| One-developer complexity | Keep one modular monolith, minimal CDK boundaries, no search/analytics services, and defer physical key choices until justified by access patterns. |

## 16. Definition of Done

### Functional

- All approved customer, prize, reveal, admin, API, campaign, and aggregate behaviours pass their acceptance criteria.
- Backend remains authoritative for all business-critical rules.
- ONE BILL = ONE CLAIM is enforced under concurrency and retry.
- No inventory management exists.

### Testing and quality

- Unit, backend, API/integration, concurrency, frontend, reveal, responsive, admin, and end-to-end tests pass.
- TypeScript strict checks pass.
- Lint and formatting checks pass.
- Production builds pass.
- Every acceptance criterion maps to a passing test.

### Security

- Admin V1 intentionally has no authentication bootstrap while backend validation remains authoritative.
- IAM is least-privilege and reviewed by function/resource.
- CORS, throttling, request limits, PII masking, CSV protection, and safe logging are verified.

### Mobile

- Customer experience passes at 360px, 375px, 390px, and 430px.
- Reveal area, draw CTA, result, form, keyboard, and error states remain usable without overflow.

### AWS infrastructure

- CDK compiles.
- CDK tests pass where applicable.
- `cdk synth` succeeds.
- `cdk diff` is reviewed.
- S3, CloudFront, API Gateway, Lambda, DynamoDB, IAM, and CloudWatch configuration is verified.
- Production data protection is understood and reviewed.

### Observability and documentation

- CloudWatch logs and metrics support operational diagnosis without unnecessary PII or secrets.
- API, data, deployment, rollback, and operational documentation is current.
- The implementation remains maintainable by one developer.

### Production verification

- Development verification passes before production deployment.
- Production deployment is explicitly approved and successfully verified.
- No infrastructure is claimed as deployed without actual deployment evidence.

## 17. Recommended First Implementation Task

**PROJECT SCAFFOLDING**

Create only the approved frontend, backend, shared-contract, test, documentation, and CDK project boundaries with strict TypeScript, lint, formatting, and test configuration. Do not implement a feature, API handler, React component, DynamoDB table, or CDK resource in this first task.
