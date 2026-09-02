# Admin V1 Operations Page

Status: APPROVED  
Owner: Principal Software Engineer  
Version: 1.4
Last Updated: 2026-08-21
Change: Claim deletion and responsive action layout
Reason: Align Admin V1 with destructive operations and responsive controls

## Route and Access

Route: `/admin`

Admin V1 intentionally has no authentication and no identity bootstrap.

The admin page has:

- no login
- no token entry
- no token-based authentication
- no cookie-based authentication
- no session
- no Cognito
- no OIDC
- no SSO
- no JWT
- no authentication bootstrap

Admin UX access requirements:

- The admin page opens directly to operational content.
- The page loads admin data automatically on route load.
- There is no separate dashboard landing step.

- Customer endpoints remain separate from admin endpoints by route.

The Admin page is intended for a single shop owner and should remain simple.

## Admin UI Technology Constraint

Tailwind CSS is approved for the Admin screen only.

Customer-facing Lucky Draw UI must not be migrated to Tailwind in Admin V1.

Customer-facing layout, CSS, components, visual behaviour, and animations remain unchanged unless separately approved.

If Tailwind preflight could affect customer UI, Admin implementation must isolate usage so customer experience remains unaffected.

Implemented V1 isolation approach:

- Tailwind utilities are emitted only for Admin page content.
- Tailwind preflight is disabled.
- Admin utility styles are imported in the Admin route module.
- Customer UI continues to use the existing customer stylesheet and animation system.

## Admin UX Principle

Admin is an operational shop-owner console.

Design priorities:

1. Simple
2. Fast
3. Clear
4. Compact
5. Functional
6. Responsive
7. Easy to operate

The Admin UI should not copy customer festive interaction behaviour.

Avoid unnecessary hero content, decorative motion, complex navigation, and customer-style reveal interactions.

## Admin Page Structure

Admin V1 page structure:

```text
Admin
|
|- Campaign Configuration
|
|- Prize Summary
|
|- Prize Management
|
|- Claims
```

There is no separate dashboard screen in Admin V1.

## Operations Information Hierarchy

Prioritize the admin operations page in this order:

1. Campaign status
2. Campaign period
3. Total successful claims
4. Prize distribution
5. Prize given counts
6. Claims report
7. Prize-based filtering
8. Prize configuration

The admin experience should remain operational and concise while visually compatible with the broader application.

## Operations Information

Display:

- Total successful claims
- Today's successful claims
- Prize distribution
- Prize `Given` count by prize
- Successful claims

Summary metrics must be read from lightweight aggregate records or counters. The browser must not load all claims to calculate them, and the backend must not require a full DynamoDB scan.

The logical summary contains:

- `totalSuccessfulSpins`
- `today.date` and `today.successfulSpins`
- `prizeDistribution[].prizeId`
- `prizeDistribution[].prizeName`
- `prizeDistribution[].givenCount`

Counters are incremented exactly once only when a claim is successfully created. Already-claimed requests, validation failures, draw-ended requests, no-eligible-prize results, internal failures before claim creation, and retries of existing claims must not increment them.

Definition of `Given`:

`Given` equals the number of successfully persisted lucky-draw claims associated with that prize.

`Given` must not include failed attempts, rejected submissions, duplicate participation attempts, concurrent duplicate requests, API failures, or other unsuccessful requests.

`Given` is not inventory, stock, remaining quantity, or depletion.

Claims should include:

- Date/time, displayed in `Asia/Kolkata`
- Customer name
- Masked phone
- Bill number
- Prize
- Claim ID

Phone numbers must be masked by default.

## Admin Functionality

- Search
- Date filtering
- Prize filtering
- Infinite scrolling for claims
- CSV export
- Prize-based claim drill-down from prize rows/counts
- Manual refresh of operational data
- Delete an individual claim
- Clear all claims in one action

Claims must not be loaded without a bounded server-side page size. The page-size value is an internal API concern and is not user-configurable in the Admin UI.

Claims are loaded newest-first. When the user reaches the end of the loaded claims, the next cursor page is fetched automatically and appended. Applying or clearing filters resets the loaded list and cursor. Manual next/previous controls may remain available as an accessible fallback when automatic observation is unavailable.

At large desktop widths, the Claims action controls should remain on one row when space permits. At smaller widths, controls may wrap without overlap or horizontal scrolling.

### Claim Deletion

- The admin can delete an individual claim from the Claims Report.
- The admin can clear all claims in one action ("Clear All Claims").
- Both actions are destructive and irreversible and must require an explicit confirmation step before executing.
- Clearing all claims requires a stronger confirmation than deleting a single claim (for example, typing a confirmation phrase), reflecting its larger blast radius.
- Deleting a claim must decrement the associated prize `Given` count and the summary aggregates (total successful spins, today's successful spins) so dashboard figures remain consistent with the remaining claims.
- Deleting a claim releases its bill number so the same bill can be used for a future draw.
- Deleting claims does not change prize configuration (name, weight, active status) or campaign dates.

### Prize-Based Claims Filter Behaviour

The awarded/given information per prize provides a shortcut into the Claims Report.

- By default, no prize-specific card is selected and claims show all results.
- Selecting a prize card applies that prize as the active claims filter.
- Selecting another prize replaces the current prize filter.
- `Clear Filters` removes the prize filter and returns to all claims.
- Selected prize card state must be persistent and clearly visible.
- Focus state and selected state must be visually distinguishable.
- Prize filtering must be keyboard accessible.
- Active prize filter state remains represented in claims filters (for example through `Prize` dropdown sync).
- Active/Inactive toggle is an independent management control and must not trigger card selection.
- Avoid a separate prominent `View Claims` button in V1.
- Every displayed filtered claim must match the selected prize.
- Filtered claim count should correspond to the displayed prize `Given` count, subject to pagination/reporting presentation.
- When no filtered claims exist, show: `No claims found for this prize.`

### Claims Date Filter Interaction

- Claims filtering uses date-only controls for `From Date` and `To Date`.
- Admin selects dates with calendar/date-picker controls.
- Frontend converts selected date-only values to UTC day boundaries before API calls:
  - `From Date` -> `YYYY-MM-DDT00:00:00.000Z`
  - `To Date` -> `YYYY-MM-DDT23:59:59.999Z`
- Admin is not required to enter time-of-day values for claims filtering.

### Admin Data Loading and Failure Handling

- Admin data loads automatically on route open.
- Admin can manually refresh dashboard data with a dedicated `Refresh` action.
- Manual refresh uses the same load path as initial load and refreshes summary, campaign, prizes, and claims together.
- Initial load requests summary, campaign, prizes, and first claims page together.
- If any initial dependency fails, the page shows a single operational error state with retry.
- While requests are in flight, section-appropriate loading text is displayed.
- Empty-data states are explicit:
  - `No claims yet.`
  - `No claims match your filters.`
  - `No claims found for this prize.`

### Search

Search supports pattern matching only across these fields:

- Claim ID: case-insensitive substring match.
- Customer name: case-insensitive substring match after trimming.
- Normalized bill number: substring match after normalization.
- Prize name: case-insensitive substring match.

Arbitrary full-text search is not required. The implementation must use an efficient DynamoDB-compatible strategy and must not introduce OpenSearch or another search service.

CSV export is an operational reporting export and is intentionally different from on-screen claims masking.

CSV exports must contain only:

- Date/time
- Claim ID
- Customer name
- Bill number
- Prize
- Unmasked phone number

CSV export scope:

- Export is scoped to a single calendar year that the administrator selects before exporting.
- The administrator selects the year from a year control shown next to the export action.
- The year control offers every calendar year covered by the configured campaign From Date and To Date, newest first. It defaults to the current year in `Asia/Kolkata` when that year is within the campaign window, and otherwise to the most recent year offered.
- A claim belongs to the year of its claim timestamp interpreted in `Asia/Kolkata`.
- Within the selected year the export includes all successful claims irrespective of active claims filters.
- Active claims filters affect dashboard viewing only and must not limit CSV export content.
- The export action must be disabled while no valid year is selected.
- The downloaded file is named `claims-<year>.csv` so that exports from different years are not confused with each other.

Exporting one year at a time keeps each export small enough to download reliably and makes the period covered by a file unambiguous for prize fulfilment and reconciliation.

Bill number is visible to the shop owner because it is required for operational verification. Do not export unnecessary personal information or internal database identifiers. CSV values beginning with `=`, `+`, `-`, or `@` must be prefixed with a single apostrophe before normal CSV quoting.

### Admin Theme Behaviour

- Admin page supports a light and dark theme toggle.
- Both themes must maintain professional operational readability with explicit visible focus styling for keyboard users.
- Contrast for body text, placeholder text, selected filter states, and table/card boundaries must remain clearly distinguishable in both themes.

## Prize Management

Prize management must remain intentionally simple.

Prize creation form:

- Prize Name (required)
- Weight (required numeric relative value)
- Active toggle (on/off)
- Add Prize action

Weight helper text must explain relative weighting using an example (for example: weight 10 has twice the draw weight of weight 5).

The admin can:

- Add a new prize
- Set its initial active status
- Change prize weight
- Activate or deactivate a prize
- View all configured prizes (active and inactive)
- View prize `Given` counts

All configured prizes must remain discoverable in prize management. Inactive prizes must not be hidden by default.

Configuration changes affect future draws only. Historical claims and their awarded prize snapshots remain unchanged.

The admin cannot:

- Change historical prizes
- Rename an existing prize
- Manage prize inventory

Prize name immutability:

- Prize Name is entered only at creation time.
- Existing prize names are immutable.
- UI must communicate that prize definition is fixed.
- Backend enforcement remains authoritative.

Active/inactive semantics:

- Active: prize participates in draw selection.
- Inactive: prize does not participate in draw selection.
- Toggle controls must be accessible and clearly communicate current state.
- On successful toggle persistence, UI must show clear immediate confirmation of the updated state.
- If toggle update fails, UI must retain or revert to the previous persisted state and show a clear error.
- UI must not appear updated when backend persistence fails.

## Campaign Configuration

The admin can:

- Configure campaign period using `From Date` and `To Date`
- View current campaign status

Campaign period input requirements:

- From Date is mandatory.
- To Date is mandatory.
- From Date must not be later than To Date.
- Dates must be valid calendar dates.
- Admin UI must not request hours, minutes, or seconds.
- From Date and To Date use calendar/date-picker controls as the primary interaction.
- Manual typing may be supported secondarily, but calendar selection is the default interaction.
- Date controls should prevent invalid dates where practical and support accessible keyboard interaction where supported.

Campaign status is derived from the configured date range.

The backend remains authoritative for campaign-period enforcement.

Campaign date interpretation uses the agreed timezone (`Asia/Kolkata`). Official claim timestamps remain server-generated and displayed in `Asia/Kolkata`.

Status presentation example:

Campaign

18 Aug 2026 -> 31 Oct 2026

ACTIVE or ENDED

## Mobile Admin UX

The admin operations page and prize management experience must be usable at:

- 360px
- 375px
- 390px
- 430px

Claims reporting must not depend on a wide fixed-width table that creates poor mobile usability.

Responsive cards or list presentation may be used where needed.

Touch targets should be approximately 44px or greater where practical.

## Acceptance Criteria

- The admin sees successful claim data with masked phone numbers.
- Claims support search, date filtering, prize filtering, pagination, and CSV export.
- CSV export requires the admin to select a calendar year, and exports only that year.
- The exported file is named `claims-<year>.csv`.
- Claims default to all results when no prize card filter is selected.
- Selecting a prize card applies prize-filtered claims reporting.
- `Clear Filters` clears prize filtering and restores all claims.
- Selected prize card state is persistent and clearly visible.
- Prize filter interaction is keyboard accessible.
- Focus state and selected state are visually distinguishable.
- Active/Inactive toggle interaction does not trigger prize-card selection.
- Prize management remains simple and includes Prize Name, Weight, Active toggle, and Add Prize.
- Prize management displays all configured prizes, including inactive prizes.
- Existing prize names are immutable and cannot be renamed.
- Weight is documented and displayed as a relative value, not a percentage.
- Weight helper guidance remains visibly adjacent to weight input.
- Active/inactive toggle updates provide success feedback and failure-safe rollback behavior.
- The admin can set and change campaign From Date/To Date without time input.
- Campaign dates are selected with calendar/date-picker controls.
- Campaign status reflects configured date range.
- The admin can view prize `Given` counts (successful claims only).
- Admin summary and claims report remain usable at 360px, 375px, 390px, and 430px.
- No inventory management is present.
- Admin UI opens directly with no authentication step in V1.
