# ADR-003: Treat the wheel as a visual reflection of the backend result

- Status: SUPERSEDED
- Date: 2026-08-16

Superseded Date: 2026-08-18

Superseded Reason: Festive Gift Box Reveal became the approved active customer presentation.

Replacement References:

- `docs/specs/01-customer/reveal.md`
- `docs/specs/01-customer/lucky-draw.md`
- `docs/specs/07-acceptance/acceptance-criteria.md`

## Context

The customer experience includes a prize wheel. Business requirements are explicit:

- the wheel is a visual representation only,
- the pointer is fixed and points downward,
- the wheel rotates beneath the pointer,
- the winning sector must mathematically align with the pointer,
- the displayed prize must match the sector under the pointer,
- the frontend must never decide the prize randomly.

This creates a need for deterministic wheel behavior tied to the backend-chosen prize.

## Decision

The backend will return the winning prize result, and the frontend will map that prize to a wheel segment index and calculate the rotation needed for the designated sector to land under the fixed pointer.

The wheel animation is not random. It is a deterministic transformation based on the selected prize and on the wheel's known segment geometry.

## Options considered

### Option A: Random rotate the wheel in the frontend

- Rejected because it is disconnected from the actual prize and undermines trust.
- Violates the requirement that backend result governs outcome.

### Option B: Backend returns prize; frontend computes wheel rotation

- Recommended.
- Keeps the wheel honest and consistent with business rules.
- Provides a realistic, visually appealing animation with no security risk.

## Consequences

### Positive

- The wheel outcome and actual prize always match.
- The component remains deterministic and testable.
- Customers can understand the experience without hidden logic.
- No business-critical decision is made in the browser.

### Negative

- The frontend needs a reliable mapping between segment order and prize metadata.
- The wheel must be designed with precise geometry and a consistent pointer model.
- Any prize list reorder must be reflected in the wheel data model.

## Implementation guidance

- Keep the backend response as the source of truth: prize id + display details.
- Ensure the frontend has a canonical sector order that matches the prize configuration used by the backend.
- Compute rotation using segment angle math rather than a random value or arbitrary visual spin.
- Guard against mismatches by showing a loading/error state if the prize metadata cannot be resolved.

## Notes

This is a UX decision that is also a security and business integrity decision. The wheel may be exciting, but it must not create ambiguity about the actual winner.
