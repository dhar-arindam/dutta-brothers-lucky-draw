# API Contract

Status: APPROVED  
Owner: Principal Software Engineer  
Version: 1.4  
Last Updated: 2026-08-19
Change: Admin UX refinement  
Reason: Approved admin requirements update

This document defines the initial API contract conceptually. It is not an implementation specification.

The Principal Software Engineer must review and approve this contract before API implementation.

## Customer API

### POST `/api/draw`

Request:

```json
{
  "name": "Customer Name",
  "phone": "9876543210",
  "billNumber": "DB12345"
}
```

The frontend supplies customer input only. It must not supply a prize or claim ID.

The request may include an optional `Idempotency-Key` header. The header is a retry correlation mechanism only; bill uniqueness remains the ultimate business protection.

Request validation is deterministic:

- `name` is required, trimmed, non-blank, at most 100 characters, rejects control characters, and permits Unicode letters, spaces, apostrophes, hyphens, and periods.
- `phone` is required and must contain exactly 10 digits.
- `billNumber` is required, trimmed, non-blank, at most 50 characters before and after normalization, rejects control characters, and permits letters, numbers, hyphens, slashes, and periods.
- `billNumber` alphabetic characters are normalized to uppercase while meaningful separators are preserved.

Violations return `400 Bad Request` with `VALIDATION_ERROR` and field-specific `fieldErrors` where applicable.

### Timestamp Rules

- All API timestamps are ISO 8601 UTC strings with a `Z` suffix.
- Campaign date interpretation uses `Asia/Kolkata`.
- The frontend must not use the customer's device timezone to determine draw status.

## API Request-Size Policy

Status: APPROVED  
Decision Date: 2026-08-18  
Decision Owner: Principal Software Engineer

Maximum request body size: `32 KB` (`32,768` bytes)

Scope:

- Endpoint-specific for JSON body mutation endpoints only:
  - `POST /api/draw`
  - `POST /api/admin/prizes`
  - `PATCH /api/admin/prizes/{prizeId}`
  - `PATCH /api/admin/campaign`
- Requests without JSON bodies are out of scope for this limit.

Enforcement:

- Primary control: backend/application layer enforces a strict raw request-body byte limit before business logic execution.
- Defense in depth: API Gateway service-level payload limits remain active and may reject very large requests before Lambda.
- If API Gateway rejects a payload at the platform boundary, the request does not reach application code.

Oversized request response:

- HTTP status: `413 Payload Too Large`
- Response body:

```json
{
  "status": "ERROR",
  "code": "REQUEST_TOO_LARGE",
  "message": "Request body exceeds the maximum allowed size. Please reduce request size and try again."
}
```

- Oversized requests must not execute business rules, claim creation, aggregate updates, prize updates, or campaign updates.

Frontend behavior:

- Client-side request-size validation is not required for V1 customer and admin forms because approved field constraints keep normal requests far below the limit.
- If `413 REQUEST_TOO_LARGE` is returned, frontend should display the backend message as an API error state and allow corrected resubmission.
- Automatic retry must not be performed for a `413` response.

Logging and monitoring:

- Each application-layer oversized rejection must emit a structured warning log entry to CloudWatch without request-body content.
- Log fields should include route path, method, observed byte size when available, and request correlation identifier when available.
- Dedicated CloudWatch alarm for oversized requests is not required in this phase.

Testing requirement:

- For each in-scope mutation endpoint family, automated tests must verify at minimum:
  - payload below limit -> accepted for normal validation/processing path
  - payload exactly at limit -> accepted for normal validation/processing path
  - payload above limit -> rejected with `413 REQUEST_TOO_LARGE`
  - malformed/invalid JSON below limit -> existing `VALIDATION_ERROR` behavior preserved
- Integration testing should include at least one boundary test through the deployed API Gateway path where environment support exists.

### `201 Created` — `SUCCESS`

```json
{
  "status": "SUCCESS",
  "claimId": "DB26-123456",
  "claimTimestamp": "2026-08-16T10:30:00.000Z",
  "prize": {
    "id": "prize-001",
    "name": "Electric Kettle",
    "displayName": "Electric Kettle"
  },
  "wheel": {
    "sectorPrizeIds": ["prize-001", "prize-002", "prize-003"]
  }
}
```

`sectorPrizeIds` is the deterministic visualization roster, ordered by immutable prize ID. It is not a client-side prize-selection input.

The `wheel` roster field is retained for API compatibility and historical support only. It is NOT used by the active festive gift box reveal customer experience and MUST NOT influence prize selection or customer reveal behaviour.

Claim IDs must match `DB26-######`, where `######` is exactly six digits.

### `200 OK` — `ALREADY_CLAIMED`

```json
{
  "status": "ALREADY_CLAIMED",
  "claimId": "DB26-123456",
  "claimTimestamp": "2026-08-16T10:30:00.000Z",
  "prize": {
    "id": "prize-001",
    "name": "Electric Kettle",
    "displayName": "Electric Kettle"
  },
  "message": "This bill has already been used for the lucky draw."
}
```

This response is returned for a retry after a successful claim and for a different person, device, or browser attempting the same normalized bill. It must never create another claim.

### `409 Conflict` — `DRAW_ENDED`

```json
{
  "status": "ERROR",
  "code": "DRAW_ENDED",
  "message": "The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter."
}
```

### `409 Conflict` — `NO_ELIGIBLE_PRIZE`

```json
{
  "status": "ERROR",
  "code": "NO_ELIGIBLE_PRIZE",
  "message": "The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter."
}
```

No fallback prize is awarded.

### `400 Bad Request` — `VALIDATION_ERROR`

```json
{
  "status": "ERROR",
  "code": "VALIDATION_ERROR",
  "message": "Please check the form and try again.",
  "fieldErrors": {
    "phone": "Phone number must contain exactly 10 digits."
  }
}
```

### `413 Payload Too Large` — `REQUEST_TOO_LARGE`

```json
{
  "status": "ERROR",
  "code": "REQUEST_TOO_LARGE",
  "message": "Request body exceeds the maximum allowed size. Please reduce request size and try again."
}
```

### `500 Internal Server Error` — `INTERNAL_ERROR`

```json
{
  "status": "ERROR",
  "code": "INTERNAL_ERROR",
  "message": "We could not complete the draw. Please try again."
}
```

Internal responses must not expose stack traces, secrets, database details, or AWS internals.

### Machine-Readable States

The API must support at least:

- `SUCCESS`
- `ALREADY_CLAIMED`
- `DRAW_ENDED`
- `NO_ELIGIBLE_PRIZE`
- `VALIDATION_ERROR`
- `REQUEST_TOO_LARGE`
- `INTERNAL_ERROR`

Error responses must use a consistent machine-readable shape and must not expose stack traces, secrets, database details, or AWS internals.

## Admin APIs

V1 admin APIs do not require authentication for shop-owner operation in this phase.

- V1 has no login, token, token header authentication, cookie authentication, session, Cognito, OIDC, OAuth, SSO, JWT, or authentication bootstrap.
- Customer endpoints remain separate from admin endpoints by route.

### `GET /api/admin/claims`

Query parameters:

- `pageSize`: optional integer from 1 to 150; default 25
- `pageToken`: optional opaque continuation token
- `from`: optional ISO 8601 UTC timestamp
- `to`: optional ISO 8601 UTC timestamp
- `prizeId`: optional prize filter
- `search`: optional approved search text

Frontend interaction note (V1):

- Admin UI uses date-only controls for claims `From Date` and `To Date`.
- The frontend maps these date-only values to UTC day boundaries before sending this API:
  - `from` -> `YYYY-MM-DDT00:00:00.000Z`
  - `to` -> `YYYY-MM-DDT23:59:59.999Z`
- The API contract remains ISO 8601 UTC timestamps for `from` and `to`.

Prize-filter semantics:

- Admin default claims view omits `prizeId` (no prize filter applied).
- Selecting a prize card in admin UI applies `prizeId` automatically.
- Selecting a different prize replaces the current `prizeId` filter.
- Selecting `Clear Filters` removes `prizeId` and returns to all claims.
- If filtered results are empty, admin UI presents: `No claims found for this prize.`

Search behaviour is limited to:

- Claim ID: exact or prefix match.
- Customer name: case-insensitive prefix match after trimming.
- Normalized bill number: exact or prefix match after normalization.
- Prize name: case-insensitive prefix match.

Arbitrary full-text search is not supported.

`200 OK` response:

```json
{
  "status": "SUCCESS",
  "items": [
    {
      "claimId": "DB26-123456",
      "claimTimestamp": "2026-08-16T10:30:00.000Z",
      "customerName": "Customer Name",
      "maskedPhone": "*****3210",
      "billNumber": "DB12345",
      "prize": "Electric Kettle"
    }
  ],
  "nextPageToken": null
}
```

Results are newest first. Page tokens are opaque and must not expose internal database keys.

### `DELETE /api/admin/claims/{claimId}`

Deletes a single claim and decrements its associated aggregates (total successful spins, today's successful spins if applicable, and the claim's prize `Given` count). Releases the claim's bill number so it can be used for a future draw.

`200 OK` response:

```json
{
  "status": "SUCCESS"
}
```

If `claimId` does not exist, returns `400 Bad Request` with `VALIDATION_ERROR` and message `"Claim was not found."`.

### `DELETE /api/admin/claims`

Deletes all claims and resets all claim-derived aggregates (total successful spins, per-date counts, per-prize `Given` counts) to zero. Prize configuration (name, weight, active status) and campaign dates are unaffected.

`200 OK` response:

```json
{
  "status": "SUCCESS",
  "deletedCount": 42
}
```

This is a destructive, irreversible operation. The admin UI must require explicit confirmation before calling this endpoint.

### `GET /api/admin/claims.csv`

Exports all successful claims irrespective of active claims filters and returns only the approved CSV fields: date/time, claim ID, customer name, bill number, prize, and unmasked phone number.

For deterministic formula-injection protection, prefix any exported cell beginning with `=`, `+`, `-`, or `@` with a single apostrophe. Apply normal CSV quoting after this transformation for commas, quotes, and line breaks. Quoting alone is not sufficient protection.

### `GET /api/admin/summary`

`200 OK` response:

```json
{
  "status": "SUCCESS",
  "totalSuccessfulSpins": 1250,
  "today": {
    "date": "2026-10-20",
    "successfulSpins": 42
  },
  "prizeDistribution": [
    {
      "prizeId": "coffee-maker",
      "prizeName": "Coffee Maker",
      "givenCount": 120
    }
  ]
}
```

The `today.date` value is the current `Asia/Kolkata` calendar date. API timestamps remain ISO 8601 UTC. The endpoint reads lightweight aggregate records or counters and must not require loading all claims into the browser or performing a full DynamoDB scan. It must not return internal DynamoDB keys.

Aggregate counters increment exactly once only with successful claim creation. `ALREADY_CLAIMED`, validation failure, `DRAW_ENDED`, `NO_ELIGIBLE_PRIZE`, internal failure before claim creation, and retries of existing claims do not increment counters.

`givenCount` means the number of successfully persisted winning claims associated with the prize. It is not stock, inventory, or remaining quantity.

### `GET /api/admin/prizes`

`200 OK` response:

```json
{
  "status": "SUCCESS",
  "items": [
    {
      "id": "prize-001",
      "name": "Electric Kettle",
      "weight": 40,
      "active": true,
      "givenCount": 120,
      "createdAt": "2026-08-16T09:00:00.000Z",
      "updatedAt": "2026-08-16T09:00:00.000Z"
    }
  ]
}
```

`givenCount` is derived from successful persisted claims associated with the prize.

### `POST /api/admin/prizes`

Request:

```json
{
  "name": "Electric Kettle",
  "weight": 40,
  "active": true
}
```

`name` is required at creation time. Existing prize names are immutable and cannot be modified by update APIs.

`weight` is numeric and relative, not a percentage.

Returns `201 Created` with the created prize, including server-generated ID and timestamps.

### `PATCH /api/admin/prizes/{prizeId}`

Request may contain:

```json
{
  "weight": 25,
  "active": false
}
```

Returns `200 OK` with the updated prize. Prize identity and historical claims cannot be changed.

Prize update operations must not allow prize-name changes.

### `GET /api/admin/campaign`

`200 OK` response:

```json
{
  "status": "SUCCESS",
  "campaign": {
    "id": "festive-2026",
    "status": "ACTIVE",
    "timezone": "Asia/Kolkata",
    "fromDate": "2026-08-18",
    "toDate": "2026-10-31"
  }
}
```

### `PATCH /api/admin/campaign`

Request:

```json
{
  "fromDate": "2026-08-18",
  "toDate": "2026-10-31"
}
```

Campaign validation requirements:

- `fromDate` required and valid calendar date.
- `toDate` required and valid calendar date.
- `fromDate` must not be later than `toDate`.
- Time-of-day fields are not part of admin campaign configuration.

The backend validates campaign dates and interprets campaign boundaries in `Asia/Kolkata`.

Admin validation errors return `400` with `VALIDATION_ERROR`; invalid prize or campaign updates do not partially apply. Unexpected failures return `500` with `INTERNAL_ERROR`.

## API Rules

- Backend validation is mandatory.
- Bill Number is the only participation key.
- The backend enforces campaign period derived from configured From Date and To Date.
- The backend selects the prize.
- The backend generates the claim ID.
- The backend enforces the approved request-body size policy for in-scope mutation endpoints.
- Admin responses must mask phone numbers and avoid unnecessary internal data.
- Admin APIs must not permit claim modification or deletion.
- CORS must allow only approved frontend origins.
- All API timestamps use ISO 8601 UTC; admin display converts them to `Asia/Kolkata`.
- CSV exports must contain only approved fields and must protect against spreadsheet formula injection.
