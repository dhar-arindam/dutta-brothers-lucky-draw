# Conceptual Data Model

Status: APPROVED  
Owner: Principal Software Engineer  
Version: 1.2  
Last Updated: 2026-08-19
Change: Admin UX refinement  
Reason: Approved admin requirements update

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

The Principal Software Engineer will determine the final DynamoDB key and index design during implementation design. The physical design must preserve the atomic uniqueness and immutable-claim requirements.

## Historical Integrity

The claim must preserve the prize awarded at the time of the draw. Later prize changes must not alter historical claims.

Claims are immutable after creation.

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

## Scope Boundary

Do not over-engineer the data model. The final physical DynamoDB key design, indexes, conditional writes, and transaction strategy belong in the approved architecture and implementation design.
