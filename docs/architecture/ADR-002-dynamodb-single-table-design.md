# ADR-002: Use DynamoDB single-table design for claims, prizes, and reporting

> **Status:** Legacy ADR requiring reconciliation with `/specs`. The final DynamoDB key and access-pattern design is intentionally not approved by the current conceptual data model.

- Status: Superseded pending reconciliation with approved specifications
- Date: 2026-08-16

## Context

The system needs to handle:

- campaign prize records with configurable relative weights and active state,
- successful customer claims and their associated prize,
- unique customer participation checks using normalized bill number,
- reporting queries for totals, daily volumes, distribution, and listing/search views.

A relational database would work, but the project architecture explicitly prefers low operational complexity and AWS-native hosting. DynamoDB is therefore the chosen persistence layer.

## Decision

Use a DynamoDB single-table design with a simple, consistent key strategy and supporting secondary indexes for admin query patterns.

### Core pattern

- Primary key: PK / SK
- Entity type field: type
- Additional keys for query patterns:
  - prize lookup by id
  - claim lookup by claim id
  - participation lookup by normalized bill
  - daily aggregation by date
  - prize distribution queries by prize id

### Example entity patterns

- Prize: `PRIZE#<prizeId>`
- Claim: `CLAIM#<claimId>`
- Participation: `PARTICIPATION#<normalizedPhone>#<normalizedBill>`
- Daily metric: `METRIC#<date>`

### Supporting indexes

- GSI for filtering claims by date and prize
- GSI for search/filtering by prize, customer, and status
- Optional inverted index for masked phone search patterns if needed later

## Options considered

### Option A: Separate tables for prizes, claims, and metrics

- Easier to reason about in isolation.
- More data duplication and cross-table coordination.
- Harder to maintain atomicity and report queries.

### Option B: Single-table design with purposeful indexes

- Recommended.
- Better for V1 performance and operational simplicity.
- Supports reporting, deduplication, and claim history in one store.

## Consequences

### Positive

- Strong support for the unique participation rule.
- Efficient lookup patterns for mobile draw submission and admin data pulls.
- Minimal cross-service coordination.

### Negative

- Requires careful modeling of key and index design.
- Some reporting logic is more complex than in a relational DB.
- Query flexibility is constrained by the table design.

## Implementation guidance

- Store normalized bill number in canonical form for uniqueness checks and store phone as claim/customer data per privacy rules.
- Use a deterministic normalized-bill identifier for uniqueness checks.
- Treat prize configuration, claim records, and aggregate records as separate yet related objects in the same table.
- Keep query patterns explicit to avoid a “catch-all” schema that becomes hard to maintain.
- Use TTL or archival strategies only if needed later; do not add complexity in V1 unless required.

## Notes

This design is intentionally conservative. It prioritizes predictable performance, transactional integrity, and maintainability over a more elaborate multi-table or event-driven architecture that is not justified at this phase.
