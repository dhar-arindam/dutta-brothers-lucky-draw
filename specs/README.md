# Specifications

Status: APPROVED  
Last Updated: 2026-08-21

Specifications are the source of truth for product behaviour.

Active customer reveal: Festive Gift Box Reveal.

Active Admin V1 model: direct `/admin` operational page with no authentication and no token/session bootstrap.

Admin V1 supports explicitly confirmed deletion of individual claims and clearing all claims. These operations are destructive and update claim-derived aggregates consistently.

The active delivery model builds a validated source artifact from an exact Git SHA and deploys staging from that artifact. Staging deployment provenance must be verifiable before production promotion.

Admin UI technology constraint: Tailwind CSS is approved for Admin only and must remain isolated from customer-facing UI styling.

Historical/deprecated customer reveal references (Envelope and Wheel) are retained only for traceability and are not active implementation targets.

Every significant feature must have an approved specification before implementation begins.

## Categories

- `00-product` — product overview and business rules
- `01-customer` — customer journey and reveal behaviour (with wheel retained as deprecated historical reference)
- `02-prizes` — prize configuration and weighted selection
- `03-admin` — admin operations-page behaviour
- `04-api` — API contracts
- `05-data` — conceptual data model
- `06-architecture` — target system architecture
- `07-acceptance` — acceptance criteria and Definition of Done

Business requirements belong in these specifications. Engineering implementation rules belong in `.github/copilot-instructions.md`.
