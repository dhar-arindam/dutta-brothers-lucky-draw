# Specifications

Status: APPROVED  
Last Updated: 2026-09-08
Change: Pending Mega Draw reset preservation, reverse order, click-to-draw, and terminal close review
Reason: Approved Mega Draw reset preservation, reverse order, click-to-draw, and terminal close changes

Specifications are the source of truth for product behaviour.

Active customer reveal: Festive Gift Box Reveal.

Active Admin V1 model: `/admin` operational page with public read-only access and Cognito-managed local users for edits and exports, using OAuth2 Authorization Code + PKCE and no MFA. Mega Draw is an Admin-scope-only exception: its route, configuration, execution, and results require login.

The Mega Draw changes are approved. Reset clears only active Mega Draw winner/lifecycle/preflight/idempotency state after a normal destructive confirmation while preserving editable ordered prize configuration and restoring selected candidates' eligibility. Draws proceed in reverse configured order after explicit wheel click with no RUN checkbox or typed phrase; the themed wheel rotation follows the authoritative result and is capped at seven full turns. After the final reveal, the modal replaces the wheel with all winner labels. Completed draws may be terminally closed with exact phrase `CLOSE MEGA DRAW <year>`; no Mega history or audit is retained, and main draw behaviour remains unchanged.

Admin V1 supports explicitly confirmed deletion of individual claims and clearing all claims. Before campaign end these operations remove records; after campaign end they archive records while updating active claim-derived aggregates consistently.

The active delivery model builds a validated source artifact from an exact Git SHA and deploys staging from that artifact. Staging deployment provenance must be verifiable before production promotion.

The performance test suite is a staging-only verification tool. It must never target production and must use the explicit `RUN_PERFORMANCE_TEST` confirmation gate or offline dry-run mode.

Admin UI technology constraint: Tailwind CSS is approved for Admin only and must remain isolated from customer-facing UI styling.

Historical/deprecated customer reveal references (Envelope and Wheel) are retained only for traceability and are not active implementation targets.

Every significant feature must have an approved specification before implementation begins.

## Categories

- `00-product` — product overview and business rules
- `01-customer` — customer journey and reveal behaviour (with wheel retained as deprecated historical reference)
- `02-prizes` — prize configuration and weighted selection
- `03-admin` — admin operations-page behaviour
- `03-admin/mega-draw.md` — year-end Mega Draw behaviour
- `04-api` — API contracts
- `05-data` — conceptual data model
- `06-architecture` — target system architecture
- `07-acceptance` — acceptance criteria and Definition of Done

Business requirements belong in these specifications. Engineering implementation rules belong in `.github/copilot-instructions.md`.
