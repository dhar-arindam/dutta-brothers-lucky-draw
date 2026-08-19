# Business Rules

Status: APPROVED  
Owner: Principal Software Engineer  
Version: 1.3  
Last Updated: 2026-08-19
Change: Final Admin V1 consolidation  
Reason: Approved source-of-truth alignment across specs

These are the confirmed business rules for the Dutta Brothers Festive Lucky Draw.

## BR-001 — One Bill, One Draw

**A BILL NUMBER can participate in the lucky draw only once.**

Bill Number is the authoritative participation key.

The same bill cannot be used by another person.

### Example

Customer A:
- Name: Arindam
- Phone: 9876543210
- Bill: DB12345

Result: SUCCESS

Customer B:
- Name: Rahul
- Phone: 9999999999
- Bill: DB12345

Result: **MUST be rejected as already claimed.**

### Implementation Note

Do NOT use:

```
Name + Phone + Bill
```

as the uniqueness key.

Do NOT use:

```
Phone + Bill
```

as the uniqueness key.

The uniqueness key is:

```
Bill Number (only)
```

### Canonical Bill Number

The displayed bill number is the value entered by the customer and may preserve the customer's original casing and surrounding whitespace for user-facing display.

The normalized bill number is the canonical value used for uniqueness enforcement and persistence:

1. Trim leading and trailing whitespace.
2. Convert alphabetic characters to uppercase.
3. Preserve meaningful characters, numbers, and separators.
4. Do not remove meaningful separators unless a later approved specification defines them as insignificant.

Examples:

```
" db12345 " -> "DB12345"
"DB12345"   -> "DB12345"
"db12345"   -> "DB12345"
```

Two submissions that normalize to the same value are the same bill and must be treated as duplicate participation attempts. The normalized bill number must be stored for database enforcement. Retaining the original displayed value is optional and, if retained, must not be used for uniqueness.

The persistence operation that claims a previously unused normalized bill must be atomic or conditional. The implementation must not use an application-level check-then-create sequence that can permit concurrent duplicate claims.

## BR-002 — Phone Number Format

**Phone number must contain exactly 10 digits.**

The backend must validate this rule.

## BR-002A — Name Validation

Customer name validation is deterministic:

- Required.
- Trim leading and trailing whitespace.
- Must not be blank after trimming.
- Maximum length is 100 characters.
- Reject control characters.
- Allow normal Unicode letters and spaces.
- Allow common name punctuation such as apostrophe, hyphen, and period.
- Do not enforce a particular cultural naming format.

The backend is authoritative for this validation.

## BR-002B — Bill Validation and Normalization

Bill number validation is deterministic:

- Required.
- Trim leading and trailing whitespace.
- Must not be blank after trimming.
- Maximum length is 50 characters before and after normalization.
- Reject control characters.
- Allow letters, numbers, and common separators such as hyphen, slash, and period.
- Normalize alphabetic characters to uppercase.
- Preserve meaningful separators.

Examples:

```
" db12345 " -> "DB12345"
"db-12345" -> "DB-12345"
"DB/12345" -> "DB/12345"
```

The normalized value is used for uniqueness. Frontend and backend must apply the same conceptual normalization, but the backend remains authoritative.

## BR-003 — Prize Selection is Backend-Only

**Prize selection is performed by the backend.**

The frontend must never determine the winning prize.

The browser must never be able to influence or specify the winning prize.

## BR-004 — Relative Weights

**Prize weights are relative weights, not percentages.**

Example:

- Prize A: weight = 40
- Prize B: weight = 20
- Prize C: weight = 10

Probability ratio is:

```
40 : 20 : 10
```

The total does not need to equal 100.

The backend must normalize weights automatically.

## BR-005 — No Inventory Management

**There is NO prize inventory management or stock tracking.**

Do not track:

- Stock
- Quantity
- Remaining inventory
- Inventory depletion
- Maximum claims per prize

Prize weight and active status are the only controls.

## BR-006 — Prize Administration

**Admin capabilities:**

- Add new prizes
- Change the weight of existing prizes
- Activate/deactivate prizes

**Admin cannot:**

- Modify historical claims
- Change a prize awarded to a customer
- Delete claims
- Restore or rollback historical draws

Historical claims are immutable.

## BR-007 — Campaign Period (Date-Only Configuration)

**Admin configures campaign period using date-only fields: From Date and To Date.**

Rules:

- From Date is required.
- To Date is required.
- From Date must not be later than To Date.
- Dates must be valid calendar dates.
- Admin UI must not request or require time-of-day input.
- Admin UI should use calendar/date-picker controls as the primary date-selection interaction.

The backend must authoritatively enforce campaign participation boundaries derived from the configured date range in the approved campaign timezone.

The frontend must not be the only mechanism enforcing this rule.

This is a business-critical constraint and must be enforced server-side.

## BR-008 — No Fallback Prize

**If there are no eligible prizes, the customer must not receive a fallback prize.**

Display an appropriate message such as:

```
"The lucky draw has ended for today. Please visit the Dutta Brothers counter."
```

An "eligible prize" is one that is:

- Active
- Positive weight
- Eligible under the active positive-weight rules; no inventory constraint applies

## BR-009 — Claim ID Generation

**Claim IDs are generated server-side.**

Example format:

```
DB26-123456
```

The frontend must never generate claim IDs.

Claim IDs must be unique.

Claim IDs are returned to the customer as proof of participation.

### Campaign Timezone and Timestamps

- The campaign timezone is `Asia/Kolkata`.
- Campaign From Date and To Date are interpreted in `Asia/Kolkata` using backend-authoritative date boundaries.
- Official claim timestamps are generated by the server, never by the customer's device.
- APIs represent timestamps as ISO 8601 UTC values with a `Z` suffix.
- Admin displays convert official timestamps to `Asia/Kolkata`.

### Claim ID Grammar

The claim ID format is exactly:

```
DB26-######
```

where `######` is exactly six numeric digits. Claim IDs are generated server-side and must be unique within the campaign.

## BR-010 — Dashboard Aggregate Consistency

Dashboard aggregates represent successful claims, not requests.

A successful claim must increment the overall, campaign-date, and prize-distribution counters exactly once.

The following must not increment aggregate counters:

- `ALREADY_CLAIMED`
- validation failure
- `DRAW_ENDED`
- `NO_ELIGIBLE_PRIZE`
- internal failure before claim creation
- a retry of an already-created claim

Claim creation and the corresponding counter updates must use atomic or transactional persistence semantics where appropriate. If claim creation fails because the bill already exists, no aggregate counter may increment.

## BR-011 — Campaign Reporting Timezone

- Campaign timezone is `Asia/Kolkata`.
- Server-generated timestamps are stored and transmitted as UTC ISO 8601 values.
- Admin display and reporting use `Asia/Kolkata`.
- Admin "today" means the current `Asia/Kolkata` calendar date.
- Draw-end calculation is backend-authoritative and must not use the customer's browser timezone.

## BR-012 — Admin Access Model (V1)

V1 admin route and admin APIs do not require authentication.

- No login, token entry, token-header auth, session, cookie-based auth, Cognito, OIDC, OAuth, SSO, JWT, or authentication bootstrap is used in V1.
- The admin page opens directly to operational content.
- Admin API calls are processed without authentication checks.
- Business validation and backend-authoritative draw rules remain mandatory.

## BR-013 — Prize Given Count and Claims Drill-Down

Each configured prize must expose a `Given` count in admin views.

`Given` means the number of successfully persisted lucky-draw claims associated with that prize.

Given count excludes:

- failed attempts
- rejected submissions
- duplicate participation attempts
- concurrent duplicate requests
- API failures
- unsuccessful requests

Given count is not inventory, stock, or remaining quantity.

Selecting a prize card applies a claims report filter for that prize.

`Clear Filters` removes prize-specific filtering and returns to all claims.
