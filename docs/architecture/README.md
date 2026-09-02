# Dutta Brothers Festive Lucky Draw Architecture

> **Status:** Legacy planning document. Product behaviour is defined by the approved specifications in `/specs`. This document must not override them; the bill-only participation rule and no-inventory rule in `/specs/00-product/business-rules.md` take precedence.
>
> **Migration note:** Active customer reveal is now the festive gift box reveal. Historical envelope and wheel references in legacy documents are deprecated for active implementation guidance.
>
> **For the implemented system**, see [system-architecture.md](system-architecture.md), which documents the deployed AWS topology, request routing, draw and admin flows, frontend state machines, the DynamoDB single-table design and the delivery pipeline as Mermaid diagrams.

## Problem

The application needs a mobile-first festive draw experience with two distinct surfaces:

- Customer flow: capture name, phone number, and bill number; validate submission; allocate a prize; and display the result through the festive gift box reveal.
- Admin flow: review successful claims, view claim records, apply search/filter/pagination, and adjust prize configuration.

The business rule is strict: a customer can only participate once per normalized bill number. Prize selection must be server-side and authoritative, and the UI must never decide eligibility, prize outcome, or claim IDs.

## Options considered

### Option A: Client-driven prize selection

- Pros: simpler to prototype; faster to build; easier to demo.
- Cons: unsafe; prizes can be manipulated; stock can be bypassed; duplicate entries become easy to forge; UX and backend logic drift apart.
- Result: rejected.

### Option B: Server-authoritative modular monolith on Lambda + API Gateway + DynamoDB

- Pros: single deployment unit; easy to reason about; supports strong validation and atomic transaction logic; aligns with V1 scope and operational simplicity.
- Cons: less horizontally scalable than distributed systems; admin and customer logic share the same runtime.
- Result: recommended for V1.

### Option C: Full microservice split for prizes, claims, and admin

- Pros: independent scaling; clear service boundaries for larger teams.
- Cons: larger operational burden; more network boundaries; unnecessary complexity for a campaign app.
- Result: rejected for V1.

## Recommendation

Use a modular monolithic Node.js backend deployed as Lambda functions behind API Gateway, with frontend static hosting via S3 + CloudFront. Keep the application simple, explicit, and secure:

- The backend owns all eligibility checks, prize normalization, deduplication, and claim generation.
- The frontend is a thin client focused on form validation, request orchestration, and gift box reveal presentation.
- DynamoDB provides the transactional and query-friendly data store required for duplicate prevention and admin reporting.
- React + TypeScript delivers a mobile-first customer experience and a lightweight admin operations page.

## Trade-offs

### Benefits

- Clear separation of responsibilities
- Better security and reduced client-side attack surface
- Easier testing of business logic
- Lower operational complexity for a campaign-sized system
- Fast iteration with a smaller team

### Costs

- More backend logic must be carefully designed and unit-tested
- DynamoDB modeling requires deliberate indexing and transaction patterns
- Admin reporting may need extra aggregate-query optimization
- Admin V1 intentionally has no app-level authentication; backend validation and platform controls remain mandatory

## Impact

This architecture preserves business integrity while keeping implementation proportional to the project scope. It ensures:

- duplicate detection is enforced atomically by the backend,
- weighted prize allocation is consistent and configurable,
- claim IDs are generated only by the server,
- the gift box reveal is purely a presentation layer for a server-issued result,
- the product remains maintainable and testable across the campaign lifecycle.

## Target architecture

### Frontend

- React + TypeScript
- Mobile-first customer experience
- Separate admin operations experience at `/admin`
- Pages / components / hooks / API clients / state / types / utilities
- Shared contract types in /shared when needed

### Backend

- Node.js + TypeScript
- Modular monolith with clear boundaries:
  - controllers/routes
  - services
  - repositories
  - validators
  - models/types
  - configuration
- Exposed through API Gateway
- Lambda-based deployment for low operational overhead

### Data and AWS

- DynamoDB for draw claims, prize configuration, and admin reporting
- S3 for static frontend assets
- CloudFront for distribution and caching
- CloudWatch for monitoring and logs
- API Gateway for REST API exposure
- Lambda for business logic

Operational tagging policy: all taggable AWS resources created via CDK must include `project=lucky-draw` and `organization=dutta-brothers` for consistent governance, operations, and cost visibility.

## Core business rules enforced server-side

- Unique participation rule: normalized bill number can only produce one successful draw claim.
- Prize selection uses weighted probabilities normalized on the backend.
- Inactive and invalid prizes are excluded before selection.
- The backend creates the claim as part of one atomic transaction.
- The frontend never decides prize selection.

## API contract summary

### Customer

#### POST /draw

Request body:

```json
{
  "name": "Ananya Dutta",
  "phoneNumber": "9876543210",
  "billNumber": "BILL-2045"
}
```

Success response:

```json
{
  "success": true,
  "claimId": "DB-CLAIM-2026-000123",
  "prize": {
    "id": "prize_01",
    "name": "smart_tv",
    "displayName": "Smart TV",
    "imageUrl": "https://example.com/smart-tv.png"
  }
}
```

Error responses:

- 400 validation errors
- 409 duplicate participation
- 422 no eligible prize available
- 500 unexpected server failure

### Admin

- GET /api/admin/summary
- GET /api/admin/claims
- GET /api/admin/prizes
- PATCH /api/admin/prizes/{prizeId}
- GET /api/admin/claims.csv

Admin responses must mask phone numbers by default in list views and only reveal complete numbers when a privileged action is explicitly required.

## Quality gate

Before a feature is considered complete, verify:

- requirements are satisfied,
- tests cover the business logic,
- edge cases are included,
- server-side enforcement is used,
- mobile UX remains intact,
- API contracts are consistent,
- complexity stays proportional to project needs,
- security implications are documented,
- documentation reflects the live design.

## Architectural standards

1. Prefer simple, maintainable design over unnecessary abstraction.
2. Keep business logic in services, not React components or controllers.
3. Use strong typing across frontend and backend.
4. Reject client-side trust for eligibility, stock, or prize selection.
5. Prefer explicit validation and deterministic failure handling.
6. Keep AWS access least-privilege and credentials externalized.
7. Minimize dependencies and duplicate logic.

## ADR index

- [ADR-001: Server-authoritative prize selection and atomic uniqueness enforcement](ADR-001-authoritative-prize-selection.md)
- [ADR-002: DynamoDB single-table design](ADR-002-dynamodb-single-table-design.md)
- [ADR-003: Wheel as a visual reflection of backend result (historical)](ADR-003-wheel-visualization.md)
- [ADR-004: Admin V1 operates at /admin with no authentication](ADR-004-private-admin-v1.md)
