# Conceptual Data Model

Status: APPROVED
Owner: Principal Software Engineer  
Version: 1.8
Last Updated: 2026-09-08
Change: Pending Mega Draw reset preservation, reverse order, click-to-draw, and terminal close review
Reason: Approved Mega Draw reset preservation, reverse order, click-to-draw, and terminal close changes

This document defines the conceptual model only. The Principal Software Engineer must determine the final DynamoDB partition/sort key strategy.

## 1. Campaign / Draw Configuration

Represents the active draw configuration.

Required conceptual information:

- Campaign identifier
- Draw status
- Campaign timezone: `Asia/Kolkata`
- Configured From Date
- Configured To Date
- Created timestamp
- Updated timestamp

The backend uses this configuration to determine whether new draws are accepted. Campaign dates are interpreted in `Asia/Kolkata` using backend-authoritative date boundaries, stored in UTC where appropriate, and exposed through APIs as ISO 8601 UTC timestamps where time values are returned.

## 2. Prize

Represents a configured prize.

Required information:

- Prize ID
- Name
- Relative weight
- Active status
- Created timestamp
- Updated timestamp

Do not include inventory fields such as stock, quantity, remaining inventory, or depletion.

Activation and deactivation are required V1 capabilities. An inactive prize remains configured but is excluded from future selection. A prize's identity and historical meaning cannot be changed after it is referenced by a claim.

## 3. Claim

Represents a successful or already-recorded participation.

Required information includes:

- Claim ID
- Customer name
- Phone number, subject to the approved privacy and retention rules
- Displayed bill number if retained for operational display
- Normalized bill number used for uniqueness enforcement
- Prize ID
- Prize name snapshot
- Server-generated created timestamp
- Archived status and archived timestamp where a post-campaign delete occurs

The claim ID must match `DB26-######`, where `######` is exactly six digits, and must be unique within the campaign.

The displayed bill number is optional audit/display data. The normalized bill number is mandatory for uniqueness enforcement and is produced by trimming surrounding whitespace, uppercasing alphabetic characters, and preserving meaningful separators.

## Uniqueness

Bill number must be uniquely enforced as the participation key. The same normalized bill number cannot produce multiple successful claims, including under concurrent requests or retries.

The uniqueness constraint must be enforced atomically by the persistence layer.

## Logical Access Patterns

The data model must support these logical operations without prescribing the physical DynamoDB key or index structure:

1. Check whether a normalized bill has already participated.
2. Atomically create a claim for a previously unused normalized bill.
3. Retrieve a claim by claim ID.
4. List claims for admin use with bounded pagination.
5. Filter claims by date range.
6. Filter claims by prize where required.
7. Continue claim pagination using a stable page token.
8. Retrieve active prizes.
9. Retrieve all configured prizes.
10. Retrieve campaign configuration.
11. Retrieve the overall successful spin count.
12. Retrieve the successful spin count for a specific `Asia/Kolkata` campaign date.
13. Retrieve prize distribution for the campaign.
14. Retrieve date-based dashboard reporting without scanning all claims into the browser or requiring a full DynamoDB scan.
15. Delete a claim by claim ID and atomically release its normalized bill and decrement claim-derived aggregates.
16. Clear all claims and reset claim-derived aggregates without changing prize or campaign configuration.
17. Archive a post-campaign claim by claim ID, atomically release its normalized bill, decrement active claim-derived aggregates, and omit it from normal reports and CSV export.
18. Archive all active post-campaign claims while preserving archived records and Mega Draw records.
19. Create and retrieve an immutable campaign snapshot and expiry-bound Mega Draw preflight for an execution year.
20. Atomically select or recover one next Mega Draw prize ordinal per action, including its immutable snapshot, idempotency, and execution-state records.
21. Clear only an execution year's active Mega Draw lifecycle, including winners, preflight, locked snapshots, and idempotency/execution records, while preserving editable ordered prize configuration and without changing main lucky-draw records.
22. Terminally close a completed execution-year Mega Draw while retaining viewable results and rejecting further lifecycle operations.

The Principal Software Engineer will determine the final DynamoDB key and index design during implementation design. The physical design must preserve the atomic uniqueness and immutable-claim requirements.

## Historical Integrity

The claim must preserve the prize awarded at the time of the draw. Later prize changes must not alter historical claims.

Claim contents are immutable after creation. Before campaign end, an explicitly confirmed admin deletion may remove a claim and its claim-derived aggregate contributions; after campaign end, it archives the claim and removes its active aggregate contributions. Neither outcome rewrites any remaining claim.

After campaign end, deletion is archival rather than physical removal. Archived claims are not active claims, are excluded from standard reports and CSV export, and do not contribute to active aggregates. Their archived records remain available only for authorized audit and reconciliation.

## 5. Mega Draw

A Mega Draw configuration and active lifecycle represent one resumable year-end Admin draw for an execution year. Before its first successful selection, its 1 to 10 ordered prize slots may be added, removed, renamed, or reordered. That first wheel-initiated selection atomically locks campaign, preflight, candidate, and ordered-prize snapshots and persists exactly the winner row for the last configured prize. Thereafter the configuration is locked until reset.

Candidate snapshots contain active successful source claims for the execution year, identified by normalized bill number and normalized phone number. The record stores selected winner rows in chronological selection order, the next reverse prize ordinal, and `SETUP`, `IN_PROGRESS`, `COMPLETED`, or `CLOSED` status. Each wheel-initiated `draw next` action atomically persists one row for the next reverse ordinal and excludes identities in prior rows. The active lifecycle is readable only through Admin-authorized access paths.

An authorized reset atomically clears the active lifecycle's preflight, winners, campaign/candidate/prize snapshots, and idempotency/execution records while retaining the ordered prize configuration as editable data. Cleared candidate selections must not remain as exclusions, allowing previously selected candidates to participate in the new lifecycle. A completed lifecycle can be terminally closed using exact typed confirmation `CLOSE MEGA DRAW <year>`; `CLOSED` retains results but rejects draw, configuration, preflight, and reset operations. Reset must not remove or modify main lucky-draw claims, prizes, campaign, claim archives, aggregate records, or ordinary claims CSV data. No Mega Draw audit, reset-event, close-event, void, redraw, replacement, history, or retention record is required. Browser-wheel display data is derived from persisted prize rows for presentation only; the wheel click initiates the action but is never selection input.

## 4. Dashboard Summary Aggregates

Dashboard aggregates are lightweight logical records or counters maintained in DynamoDB. They represent successful claims, not requests.

### Overall Summary

- `totalSuccessfulSpins`

### Daily Summary

- campaign date in `Asia/Kolkata`
- `successfulSpins`

### Prize Distribution

- `prizeId`
- `prizeName`
- `givenCount`

`givenCount` is the number of successfully persisted claims associated with each prize and is not an inventory or remaining-quantity field.

Aggregate counters are updated only when a claim is successfully created. Claim creation and counter updates must use atomic or transactional persistence semantics where appropriate.

The following must never increment counters:

- already-claimed requests
- validation failures
- draw-ended requests
- no-eligible-prize results
- internal failures before claim creation
- retries of already-created claims

Transient transaction contention during claim creation may be retried with bounded backoff. Retries must preserve exactly-once claim and aggregate behaviour. Duplicate-bill conflicts must remain distinct from transient contention.

## Scope Boundary

Do not over-engineer the data model. The final physical DynamoDB key design, indexes, conditional writes, and transaction strategy belong in the approved architecture and implementation design.
