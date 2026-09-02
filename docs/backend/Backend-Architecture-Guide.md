# Dutta Brothers Festive Lucky Draw — Backend Architecture & Implementation Guide

> Historical guidance - Non-authoritative. Active business rules are defined in business-rules.md and reveal.md.

> **Status:** Legacy planning guide. Use the approved specifications in `/docs/specs` as the source of truth. This guide contains superseded phone-plus-bill and inventory assumptions and must be reconciled before backend implementation.

> **Admin V1 supersession note:** Any legacy references in this guide to private admin URLs, token-based admin access, or inventory/quantity prize models are superseded by the approved Admin V1 and product specs under `/docs/specs`.

## 1. Scope and responsibilities

This backend owns the authoritative business logic for the Dutta Brothers festive lucky draw.

It is responsible for:

- API request validation
- normalization of identifiers
- eligibility enforcement
- weighted prize selection
- transaction-safe uniqueness enforcement
- claim creation
- prize stock decrement
- claim ID generation
- admin listing, filtering, and CSV export
- structured logging and operational safety

It does not own:

- browser logic
- client-side prize selection
- claim decisions in the frontend
- direct trust of any client-supplied flag
- state that is not enforced on the server

The backend is the source of truth for all prize and claim decisions.

## 2. Architecture

### Modular monolith layout

```text
src/
  app/
    routes/
      drawRoutes.ts
      adminRoutes.ts
    server.ts
  controllers/
    drawController.ts
    adminController.ts
  services/
    drawService.ts
    prizeService.ts
    claimService.ts
    adminService.ts
  repositories/
    prizeRepository.ts
    claimRepository.ts
    adminRepository.ts
  validators/
    drawValidator.ts
    adminValidator.ts
  models/
    prize.ts
    claim.ts
    api.ts
  types/
    common.ts
    prize.ts
    claim.ts
    request.ts
    response.ts
  config/
    env.ts
    aws.ts
    logger.ts
    app.ts
  utils/
    normalize.ts
    weights.ts
    ids.ts
    errors.ts
    logger.ts
    csv.ts
  middleware/
    errorHandler.ts
    validateRequest.ts
    requestContext.ts
    cors.ts
    rateLimit.ts
  tests/
    unit/
    integration/
```

This keeps the application simple while still preserving separation of concerns.

## 3. Core business rules

### Unique participation rule

A customer can successfully participate only once for the same phone + bill number combination.

Business rule:

- normalize phone
- normalize bill number
- generate a composite key
- prevent duplicate successful claims atomically

### Source of truth

The browser must never be trusted for:

- eligibility
- prize selection
- prize stock
- claim ID
- uniqueness enforcement

The backend enforces and records all of these.

## 4. Prize model

Each prize must support:

```ts
export type Prize = {
  id: string;
  name: string;
  displayName: string;
  weight: number;
  quantity: number;
  active: boolean;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
};
```

### Prize eligibility rules

A prize is eligible only if:

- active === true
- quantity > 0
- weight > 0
- input data is valid

### Automatic normalization

- weights are normalized server-side
- weights do not need to total 100
- inactive prizes are excluded
- zero stock prizes are excluded
- invalid or non-positive weights are excluded

## 5. Draw API contract

### Endpoint

POST /draw

### Request

```json
{
  "name": "Customer Name",
  "phone": "9876543210",
  "billNumber": "DB12345"
}
```

### Validation rules

- name: required, reasonable length
- phone: exactly 10 digits after normalization
- billNumber: required, reasonable length

### Success response

```json
{
  "status": "SUCCESS",
  "prize": "Smart TV",
  "claimId": "DB-CLAIM-2026-000123"
}
```

### Already claimed response

```json
{
  "status": "ALREADY_CLAIMED",
  "prize": "Smart TV",
  "claimId": "DB-CLAIM-2026-000118"
}
```

### Error response shape

```json
{
  "status": "ERROR",
  "code": "VALIDATION_ERROR",
  "message": "Please check the form and try again."
}
```

### Important rule

No client can specify the prize or claim ID. Those values are server-generated and authoritative.

## 6. Backend draw flow

The backend should operate in this sequence:

1. validate input
2. normalize phone
3. normalize bill number
4. create uniqueness key
5. check prior successful claim
6. get eligible prizes
7. normalize weights
8. select prize using weighted randomization on the server
9. atomically create claim
10. atomically decrement prize quantity
11. generate claim ID
12. return final result

## 7. Atomicity and race-condition prevention

This is the most critical backend requirement.

### Mandatory behavior

Two simultaneous requests with the same phone + bill number must never produce two successful claims.

### Recommended enforcement mechanisms

- stable composite key for phone + bill in the claim record
- conditional writes / optimistic locking at the claim repository layer
- transaction pattern for claim creation and prize stock decrement
- a deterministic uniqueness check tied to the normalized composite key

### Example rule

The transaction should fail if a claim record with that normalized identity already exists.

This ensures that concurrent requests do not both pass the uniqueness check and both succeed.

## 8. DynamoDB design

### Table structure

Use dedicated repositories for:

- claims
- prizes

### Claims repository

Key responsibilities:

- check for existing claim by composite key
- insert claim with conditional write
- query claim records for admin views
- support date and prize filtering
- preserve claim history with newest-first ordering

Suggested attributes:

```ts
{
  pk: 'CLAIM#<claimId>',
  sk: 'META',
  claimId: 'DB-CLAIM-2026-000123',
  phoneKey: 'PHONE#9876543210',
  billKey: 'BILL#DB12345',
  participationKey: 'PARTICIPATION#9876543210#DB12345',
  name: 'Customer Name',
  phone: '9876543210',
  billNumber: 'DB12345',
  prizeId: 'prize_01',
  status: 'SUCCESS',
  createdAt: '2026-08-16T12:00:00.000Z'
}
```

### Prizes repository

Key responsibilities:

- fetch all prizes
- fetch active and in-stock prizes
- decrement stock atomically
- update prize configuration
- support admin listing and editing

Suggested attributes:

```ts
{
  pk: 'PRIZE#<id>',
  sk: 'META',
  id: 'prize_01',
  name: 'smart_tv',
  displayName: 'Smart TV',
  weight: 25,
  quantity: 10,
  active: true,
  imageUrl: 'https://example.com/smart-tv.png',
  createdAt: '2026-08-16T12:00:00.000Z',
  updatedAt: '2026-08-16T12:00:00.000Z'
}
```

### Business invariant enforcement in DB

The database should ensure that:

- claim duplicates cannot be inserted for the same participation key
- stock never goes negative
- prize configuration cannot make inactive or zero-stock prizes eligible

Use conditional writes and transactions to enforce this at the persistence layer.

## 9. Weighted prize selection

### Requirements

- weights do not need to sum to 100
- weights must be normalized automatically server-side
- prizes with invalid or non-positive weights are excluded
- prizes with quantity zero or active false are excluded

### Algorithm

1. fetch eligible prizes
2. filter to valid candidates
3. normalize weights
4. compute cumulative distribution
5. choose a random value against the normalized totals
6. return the selected prize

### Implementation guidance

```ts
const eligiblePrizes = prizes.filter((p) => p.active && p.quantity > 0 && p.weight > 0);

const totalWeight = eligiblePrizes.reduce((sum, prize) => sum + prize.weight, 0);
const threshold = Math.random() * totalWeight;
```

The selection is done on the server only.

## 10. Admin APIs

### GET /admin/claims

Support:

- pagination
- date filtering
- prize filtering
- search
- newest-first order
- masked phone numbers by default

### GET /admin/prizes

Return prize list with:

- id
- name
- displayName
- weight
- quantity
- active
- imageUrl
- updatedAt

### PUT /admin/prizes/:id

Allow update of:

- displayName
- weight
- quantity
- active
- imageUrl

### CSV export

CSV generation must be server-side.

The export should be generated from query results and returned as a downloadable CSV response or a generated object store reference depending on deployment configuration.

## 11. Error handling

### Goals

- consistent API format
- no stack traces in responses
- no DynamoDB internals exposed
- no AWS internal details disclosed
- clear, business-friendly error messages

### Standard error categories

- VALIDATION_ERROR
- DUPLICATE_ENTRY
- NO_ELIGIBLE_PRIZE
- PRIZE_UNAVAILABLE
- INTERNAL_ERROR
- NOT_FOUND

### Example responses

```json
{
  "status": "ERROR",
  "code": "VALIDATION_ERROR",
  "message": "Please provide a valid 10-digit phone number."
}
```

```json
{
  "status": "ERROR",
  "code": "DUPLICATE_ENTRY",
  "message": "This bill has already been used for a successful draw."
}
```

## 12. Security requirements

### Required controls

- IAM least privilege for AWS resources
- environment variables for secrets and config
- input validation at the API boundary
- CORS configuration
- request-size limits
- throttling considerations
- safe structured logging
- no AWS credentials in source code

### Logging policy

Log:

- request ID
- operation name
- success/failure result
- claim ID where applicable
- error category

Do not log unnecessary customer PII.

## 13. Observability

Use structured logs with a consistent JSON format:

```json
{
  "requestId": "abc123",
  "operation": "draw.create",
  "status": "success",
  "claimId": "DB-CLAIM-2026-000123",
  "errorCategory": null
}
```

### Minimal logging standard

- request ID
- route or operation identifier
- duration or outcome
- claim ID where relevant
- sanitized error category
- avoid logging full phone numbers or customer names unless strictly necessary and approved

## 14. Validation strategy

Validation must happen on the server regardless of frontend checks.

### Input validation rules

- name required
- name reasonable length
- phone exactly 10 digits
- billNumber required and reasonable length
- normalize before persistence

### Reusable rules

Place validation logic in dedicated validators:

- drawValidator.ts
- adminValidator.ts

Keep validators pure and deterministic for unit testing.

## 15. Testing strategy

The backend must test the real business behavior, not mock-only flows.

### Required tests

- valid draw
- duplicate draw
- concurrent duplicate requests
- invalid input
- prize selection
- zero stock
- deactivation logic
- stock decrement
- no eligible prizes
- API errors
- admin APIs

### Mandatory concurrent duplicate test

This is required because the core requirement is atomic uniqueness enforcement under parallel requests.

### Important principle

Use a test harness that exercises the actual repository and service behavior needed for the invariant, rather than only asserting that a mock was called.

## 16. Local development and environment variables

### Recommended environment variables

- NODE_ENV
- AWS_REGION
- DYNAMODB_TABLE_NAME
- AWS_ACCESS_KEY_ID (if used in local development only)
- AWS_SECRET_ACCESS_KEY (if used in local development only)
- API_BASE_URL
- CORS_ALLOWED_ORIGINS
- LOG_LEVEL

### Local run flow

- install dependencies
- set environment variables
- run local API server
- run unit tests
- run integration tests
- verify AWS config and Lambda packaging

## 17. Deployment and operational considerations

- backend deployed as Lambda
- API exposed through API Gateway
- frontend served as static assets via S3 + CloudFront
- CloudWatch for logs and operational visibility
- keep Lambda memory and timeout aligned to expected API volume
- avoid unnecessary network calls and large payloads
- configure request limits and throttling at the API layer

## 18. Documentation and architecture governance

Document and maintain:

- API contracts
- DynamoDB design decisions
- prize lifecycle and business rules
- error responses
- environment variables
- local development setup
- deployment considerations

### Change control

Do not change the architecture without discussing the impact with the Principal Software Engineer.

## 19. Quality gate

Before a backend feature is considered complete, verify:

- business rule is enforced server-side
- uniqueness is atomic under concurrency
- prize stock cannot go negative
- validation happens on the server
- admin APIs are paginated and filtered
- logs are structured and safe
- error handling is consistent and sanitized
- tests exist for edge cases and race conditions
- architecture remains proportional to the product scope

## 20. Summary

This backend should be a tight, reliable, low-complexity modular monolith that enforces the campaign’s critical business invariants with strong atomicity, safe validation, and clear operational boundaries. The central requirement is that the backend, not the client, is the single source of truth for participation eligibility, prize outcome, stock, and claim identity.
