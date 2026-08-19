# ADR-001: Server-authoritative prize selection and atomic uniqueness enforcement

> **Status:** Legacy ADR requiring reconciliation with `/specs`. The approved specifications are authoritative for current product behaviour.

- Status: Superseded pending reconciliation with approved specifications
- Date: 2026-08-16

## Context

The campaign requires a strict business rule: a customer may participate only once per normalized bill number. The application also requires configurable weighted prize selection (relative weights) and claim generation.

A client-driven approach creates an unacceptable risk: a user could submit multiple attempts or tamper with prize selection rules. The backend must be the only authority for eligibility, prize selection, and claim creation.

## Decision

The backend will enforce these requirements in a single server-side transaction:

1. Normalize and validate the submitted name, phone number, and bill number.
2. Check for an existing successful draw for the normalized bill number.
3. Exclude any prize that is inactive, has non-positive weight, or is otherwise invalid.
4. Normalize weights and select a prize using server-side weighted logic.
5. Atomically create the claim record.
6. Generate a claim ID server-side and return it to the client.

The transaction must be atomic from the perspective of the business rule. Duplicate submissions for the same normalized bill must fail with a conflict response even under concurrent load.

## Options considered

### Option A: Randomize prize selection in the browser

- Rejected because it lets the browser decide eligibility and prize behavior.
- Creates inconsistency between the UI and server state.
- Makes duplicate prevention and validation unreliable.

### Option B: Server-side selection with atomic transaction

- Recommended.
- Ensures a single source of truth for all business rules.
- Keeps the customer experience fast and secure.

## Consequences

### Positive

- Business rules are enforced consistently.
- Duplicate submissions are prevented even during concurrent requests.
- Claim IDs are reliable and auditable.
- The UI remains a visual layer and cannot be exploited.

### Negative

- The backend has to handle more logic and transaction management.
- Validation and transactional errors require explicit handling.
- Testing must cover concurrency edge cases.

## Implementation guidance

- Model the uniqueness check as a key or identifier derived from normalized bill number.
- Use atomic write semantics such as conditional writes or a transaction across claim creation and related aggregate updates.
- Reject ineligible prizes before selection rather than filtering after selection.
- Keep weights normalized on the backend; no client trust is allowed.

## Notes

This decision is foundational to the campaign's integrity. Any future feature must not weaken this rule or move business logic to the frontend.
