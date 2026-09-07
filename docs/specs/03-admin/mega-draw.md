# Mega Draw

Status: APPROVED
Owner: Principal Backend Engineer
Reviewed By: Principal Backend Engineer and Experience Business Analyst
Version: 1.3
Last Updated: 2026-09-08
Change: Approved epoch-based Mega Draw reset policy
Reason: Record confirmed immediate isolation and separate cleanup of prior Mega Draw epochs

## 1. Business Analysis

### Goal

Allow an authenticated administrator to conduct one year-end Mega Draw that awards a configurable set of separately configured Mega prizes to distinct participants from that year's main lucky draw.

### Users and Problem

The shop owner needs a controlled way to select final promotional winners without manually exporting, deduplicating, or drawing from customer records, and to restart the Mega Draw when needed. Customers do not interact with the Mega Draw and do not receive a customer-facing Mega Draw experience under this scope.

### Expected Outcome

The administrator can configure Mega prizes, review a backend-derived eligible-participant count, confirm a controlled draw, and view the same recorded winners on every subsequent visit. No candidate identity can receive more than one Mega prize in a Mega Draw.

## 2. Scope and Boundaries

### In Scope

- One Mega Draw for a single `Asia/Kolkata` calendar year.
- A configurable number of ordered, separately configured Mega prizes; four prizes are an example, not a fixed product limit.
- Server-side random selection of one distinct candidate per configured Mega prize.
- Authenticated Admin-scope configuration, execution, and result access.
- Admin-authorized Mega Draw reset that atomically advances to an empty editable Mega Draw epoch and isolates prior Mega Draw-only state for separate cleanup.

### Out of Scope

- Customer-facing Mega Draw entry, reveal, notification, or public winner announcement.
- Reuse of main lucky-draw prize configuration, weighting, inventory, or prize `Given` counts.
- Adding additional Mega Draws, prize fulfilment, or winner-contact workflows.
- Altering main lucky-draw participation, claim, campaign, or prize-selection behavior.

## 3. Functional Requirements

### MD-001 - Admin-Only Access

- Mega Draw configuration, eligibility information, execution, and results require a valid Cognito access token with the existing Admin scope.
- Unauthenticated users and users without the Admin scope must not view Mega Draw configuration, candidate counts, or winner information.
- The authenticated Admin landing page provides the only navigation entry to the Mega Draw route, proposed as `/admin/mega-draw`.
- A user who directly accesses the Mega Draw route without a valid Admin session is redirected to `/admin` and is not shown Mega Draw data.
- Customer draw APIs and customer UI remain unchanged.

### MD-002 - Mega Prize Configuration

- The Mega Draw has a configurable, ordered set of 1 to 10 prize slots. Four prizes are a suggested configuration only.
- Each slot has a required prize name. Prize names must be non-blank after trimming and at most 100 characters.
- Prize names must be unique within a Mega Draw configuration.
- Mega prizes are separate from main lucky-draw prizes. They have no relative weight, active status, stock, inventory, or `Given` count.
- At least one and no more than 10 prize slots must be configured before the Mega Draw can be executed.
- Before the first successful `draw next` selection, an administrator may add, remove, rename, or reorder the 1 to 10 prize slots.
- The first successful selection locks an immutable ordered prize snapshot and candidate snapshot. From that point, Mega prize configuration and order are immutable for that draw.
- A change required after the first successful selection requires the controlled reset in MD-008. Reset atomically advances to a fresh empty editable epoch; it does not preserve access to historical Mega Draw results.

### MD-003 - Eligibility Year and Candidate Population

- The execution year is the current `Asia/Kolkata` calendar year determined by the backend when the administrator requests the preflight or execution operation.
- An eligible source entry is a successfully persisted main lucky-draw claim whose server-generated claim timestamp belongs to that execution year in `Asia/Kolkata`.
- A source claim deleted before the Mega Draw executes is not eligible.
- The Mega Draw can execute only after the campaign for the execution year has ended according to backend-authoritative `Asia/Kolkata` campaign status.
- The active lifecycle preserves a locked campaign snapshot containing campaign ID, configured dates, timezone, and backend-derived ended status. Later campaign configuration changes do not alter that active lifecycle's eligibility or results.
- If no campaign configuration exists for the execution year, the Mega Draw cannot execute and returns a machine-readable configuration error.
- Main-draw prize status, weight, and later prize configuration changes do not affect Mega Draw eligibility.

### MD-004 - Person Identity and Deduplication

- For Mega Draw eligibility, a candidate identity is the combination of normalized bill number and normalized 10-digit phone number recorded on a successful main-draw claim.
- A successful main-draw claim contributes one candidate entry. Claims with the same normalized bill number and normalized phone number contribute one candidate entry only.
- Claims with the same normalized phone number and different normalized bill numbers are separate candidate identities and may each win a Mega prize.
- The candidate's source claim is the successful main-draw claim from which the candidate identity is derived.
- One selected candidate identity must be removed from the remaining candidate pool before the next Mega prize is selected.
- A selected candidate identity can receive at most one Mega prize.

### MD-005 - Resumable Sequential Selection

- The backend alone performs winner selection using a cryptographically secure random source.
- Selection is uniform across eligible candidate identities and occurs without replacement.
- The first successful `draw next` selection requires at least as many eligible candidate identities as configured Mega prizes. When fewer exist, no snapshot or winner is persisted and the backend returns `INSUFFICIENT_ELIGIBLE_PARTICIPANTS`.
- The first successful selection atomically locks the immutable candidate snapshot, campaign snapshot, and ordered prize snapshot, then selects and persists exactly one distinct winner for prize 1.
- Each later `draw next` action atomically selects and persists exactly one distinct winner for the next unselected configured prize. It excludes every candidate identity already selected in that draw.
- A partially completed draw is valid, immutable for its selected rows, and resumable after refresh. Prizes must be selected strictly in configured order; a later prize cannot be selected before its predecessor.
- Only the current Mega Draw epoch may be read or operated for an execution year. It has at most one lifecycle: `SETUP` before selection, `IN_PROGRESS` after one or more but fewer than all prize selections, and `COMPLETED` after the last configured prize. An Admin may reset any of these states only through MD-008.
- The backend maintains one conditional draw-state record per execution year to serialize each next-prize action and recover a stale in-progress operation without selecting a second winner for the same prize ordinal.
- The Admin UI creates and retains one opaque idempotency key for each `draw next` action. The backend binds the key to the authenticated Admin subject, execution year, draw reference, next prize ordinal, and request fingerprint.
- A retry with the same idempotency key returns the original selected row or its current operation status. Reusing a key with different request details is rejected.
- A concurrent request with a different idempotency key returns `MEGA_DRAW_IN_PROGRESS` while a next-prize action is active, or the current persisted lifecycle state once it is available.
- The browser wheel, including its spokes and animation, is presentation-only. It displays the remaining ordered prize names supplied by the backend and must never select, rank, remove, or determine a winner.

### MD-006 - Preflight, Confirmation, and Operational Flow

- The Admin UI presents a preflight summary with execution year, backend-derived eligible-candidate count, ordered prize names, distinct-winner rule, and irreversible-result notice.
- A backend preflight snapshot includes a unique reference, candidate count, configured prizes, campaign snapshot, and expiry. The first `draw next` action validates that it remains current and locks its candidate population when it succeeds.
- If the candidate population, prize configuration, campaign status, or execution year changes, or the preflight expires before the first selection, the backend returns `PREFLIGHT_STALE`; the Admin UI refreshes the preflight summary and requires a new confirmation. Preflight freshness no longer applies after the immutable snapshot is locked.
- Every `draw next` action requires an acknowledgement control and typed confirmation exactly matching `DRAW NEXT MEGA PRIZE <year>`.
- While a next-prize action is in progress, repeat submission is disabled and the UI shows an explicit running state. After success, it shows the persisted winner for that ordinal and the remaining prize count.
- After the last selection, the UI displays all ordered prize-to-winner result rows, completed timestamp in `Asia/Kolkata`, and a persistent Mega Draw reference.
- The Mega Draw may use a wheel as an operational presentation. Its spokes must reflect only the remaining configured prizes, and its completed animation may start only after the backend returns the authoritative selected row. It must not reuse customer festive reveal interactions.

### MD-007 - Results

- An active draw lifecycle preserves the execution year, current epoch, locked campaign/candidate/prize snapshots, ordered selected rows, current next prize ordinal, status, and completed UTC timestamp when complete. Each row preserves its selected candidate identity, source claim ID, source claim timestamp, and candidate-pool count until reset.
- Admin result views mask phone numbers by default, consistent with existing claims reporting.
- Mega Draw winners, snapshots, and results have no separate export. The existing year-based claims CSV remains the only export and retains its approved scope and format.
- No Mega Draw audit trace, reset event, historical void/redraw history, or Mega Draw-specific retention requirement exists. Reset immediately makes prior Mega Draw-only results and state inaccessible by advancing the current epoch; separate cleanup later deletes those prior-epoch records.
- In-progress and completed results remain viewable to authenticated administrators after main-draw prize configuration changes.

### MD-008 - Reset Mega Draw

- Once a campaign has ended, an administrator's delete action archives every claim from that campaign rather than physically removing it. Archived claims are excluded from normal claims views and the existing claims CSV by default.
- An archived claim is not eligible for a Mega Draw or later redraw. Its archived record remains available only for authorized audit and reconciliation use.
- An in-progress or completed Mega Draw preserves its immutable winner and source-claim snapshots if a referenced source claim is archived. When this occurs, the applicable selected row is marked `SOURCE_CLAIM_ARCHIVED`.
- Archiving has the same active-record effects as the existing physical delete operation: it decrements the associated prize `Given` count, total successful claims, and applicable daily count, and it releases the normalized bill for future participation.
- Clear-all archives all claims after campaign end, applies the same aggregate and bill-release effects to each active claim, and does not alter any active Mega Draw state.
- Deleting a winner's source claim does not automatically select a replacement winner.
- An administrator may reset a `SETUP`, `IN_PROGRESS`, or `COMPLETED` Mega Draw only with a valid Admin-scoped Cognito session, acknowledgement, and typed confirmation exactly matching `RESET MEGA DRAW <year>`.
- Reset atomically advances the execution year's current Mega Draw epoch to a fresh epoch with no configuration, preflight, lifecycle state, selected winners, snapshots, idempotency/execution-state records, or result data. All Mega Draw reads and operations are scoped to the current epoch, so records in every prior epoch are inaccessible immediately.
- On success, reset returns the execution year to the new empty editable Mega Draw setup. The administrator may configure new Mega prizes, request a new preflight, and start selection again using the then-current eligible population. A separate cleanup process deletes prior-epoch Mega Draw-only records; cleanup neither changes the current epoch nor restores prior records.
- Reset must not alter main lucky-draw claims, main prizes, campaign configuration, claim archives, aggregate records, or the ordinary claims CSV and must not restore or change archived claims.
- Reset creates and retains no Mega Draw audit trace, reset event, void record, replacement relationship, historical result, or redraw history.

## 4. API and Data Implications

The API and data-model changes required by this specification are defined in the approved core specifications. The contract surface includes:

- Authenticated Mega Draw configuration read and update operations.
- Authenticated preflight operation returning backend-derived execution year, eligibility count, configuration state, and completion state.
- One idempotent authenticated `draw next` operation requiring the preflight reference only for prize 1 and an idempotency key for every action.
- Authenticated lifecycle read operation returning selected rows, next prize, remaining prizes, and completion state.
- Machine-readable errors: `MEGA_DRAW_NOT_CONFIGURED`, `INSUFFICIENT_ELIGIBLE_PARTICIPANTS`, `MEGA_DRAW_IN_PROGRESS`, `MEGA_DRAW_ALREADY_COMPLETED`, `PREFLIGHT_STALE`, `CAMPAIGN_NOT_FOUND`, `MEGA_DRAW_CONFIGURATION_LOCKED`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, and `INTERNAL_ERROR`.
- An execution-year current-epoch record plus epoch-scoped Mega Draw configuration, expiry-bound preflight, active lifecycle, locked campaign/candidate/prize snapshots, ordered winner rows, source-claim references, and per-action execution-state and idempotency records. Reset atomically advances the current-epoch record; separate cleanup deletes records scoped to prior epochs.

The persistence design must enforce one selection per prize ordinal, configured-order progression, distinct winners, and atomic per-action result creation under concurrent requests. Retrying after a lost response must retrieve or return the original selected row and must never draw again.

## 5. Acceptance Criteria

- [ ] Only an authenticated Admin-scope user can view, configure, run, or view results for the Mega Draw.
- [ ] Mega Draw navigation is available only after login from `/admin`; an unauthenticated direct visit to `/admin/mega-draw` redirects to `/admin` without exposing Mega Draw data.
- [ ] The Mega Draw supports 1 to 10 ordered, non-blank, uniquely named Mega prizes; four prizes are supported as an example configuration and are not a fixed limit.
- [ ] Mega prizes are separate from main-draw prize configuration and do not have weights, inventory, active status, or `Given` counts.
- [ ] The backend derives the execution year from the current `Asia/Kolkata` calendar year.
- [ ] Only successful, non-deleted main lucky-draw claims in the execution year are eligible source claims, and execution is blocked until that year's campaign has ended.
- [ ] Mega Draw preflight and finalized records preserve the campaign ID, dates, timezone, and ended status used for eligibility; later campaign changes do not alter the records.
- [ ] Missing campaign configuration for the execution year prevents execution with the approved configuration error.
- [ ] Multiple eligible claims with the same normalized bill number and normalized phone number produce one Mega Draw candidate.
- [ ] Eligible claims with the same normalized phone number and different normalized bill numbers are separate candidates and may each win a Mega prize.
- [ ] Each selected Mega Draw candidate retains its eligible source claim for audit display.
- [ ] Before the first successful selection, an administrator can add, remove, rename, or reorder the 1 to 10 configured Mega prizes; after it, configuration and order are locked until reset.
- [ ] The first successful `draw next` action locks immutable candidate, campaign, and ordered-prize snapshots and selects only prize 1.
- [ ] Every `draw next` action selects exactly one distinct candidate identity for the next configured prize, uniformly at random and without replacement.
- [ ] A first draw cannot start with fewer eligible candidate identities than configured prizes and returns the approved insufficient-candidate outcome without recording a snapshot or winner.
- [ ] Each next-prize action atomically records one configured prize-to-winner row or records none; partial completed rows are valid and resumable after refresh.
- [ ] A later configured prize cannot be selected before its predecessor, and all prizes complete in configured order.
- [ ] Concurrent next-prize requests select at most one winner for an ordinal and return the identical recorded row or current lifecycle state.
- [ ] A retry after a lost next-prize response retrieves the original recorded row and never runs that prize selection again.
- [ ] After a lost next-prize response, the Admin UI checks the Admin-scoped idempotency-status lookup before retrying. The lookup returns only the authenticated operator's `NOT_FOUND`, `IN_PROGRESS`, or current lifecycle state.
- [ ] The Admin UI supplies one idempotency key per next-prize attempt; reuse with a changed request is rejected, and concurrent different-key attempts return the documented in-progress or current lifecycle outcome.
- [ ] The first selection validates an unexpired backend preflight snapshot. A changed candidate population, prize configuration, campaign state, execution year, or expired preflight returns `PREFLIGHT_STALE` without selecting a winner and requires reconfirmation; subsequent selections use the locked snapshot.
- [ ] A recoverable stale next-prize execution-state record does not permit a second winner for the same prize ordinal.
- [ ] The Admin UI requires acknowledgement and exact typed confirmation `DRAW NEXT MEGA PRIZE <year>` before enabling each selection.
- [ ] During each next-prize action, the Admin UI prevents duplicate submission and announces the running state accessibly.
- [ ] A presentation-only wheel shows the backend-provided remaining ordered prizes as spokes and never determines, changes, or implies client-side winner selection.
- [ ] After each selection, the Admin UI shows the persisted row and remaining configured prizes; completed results show all ordered prize-to-winner rows, masked winner contact information, completion time in `Asia/Kolkata`, and a persistent draw reference.
- [ ] An in-progress or completed Mega Draw remains unchanged after a main prize changes or a referenced source claim is archived; archival marks the applicable row `SOURCE_CLAIM_ARCHIVED` and does not select a replacement winner.
- [ ] Archiving a claim decrements the associated active aggregates and releases its normalized bill for future participation; clear-all archives all claims and applies the same effects while preserving Mega Draw records.
- [ ] Reset atomically advances the execution year's current Mega Draw epoch to a fresh empty editable setup; no read or operation can access a prior epoch after success.
- [ ] Prior-epoch Mega Draw-only records are deleted by separate cleanup that cannot alter the current epoch or make a prior epoch accessible.
- [ ] No Mega Draw audit trace, reset event, historical void/redraw relationship, or Mega Draw-specific retention history is created or retained.
- [ ] No Mega Draw winner export is available. The existing claims CSV remains the only export and retains its approved scope and format.
- [ ] Mega Draw configuration and results are usable with keyboard navigation, visible focus, screen-reader status announcements, and at 360px, 375px, 390px, and 430px widths.

## 6. Approved Decisions

Confirmed decisions: a candidate identity is the combined normalized bill number and normalized phone number; the same phone number with different bills may win more than once; the Mega Draw can run only after the campaign ends; the Admin page is the only logged-in navigation entry and unauthenticated direct access redirects to `/admin`; before the first successful selection administrators may add, remove, rename, and reorder 1 to 10 Mega prizes, after which configuration/order are locked until reset; the first selection locks the candidate snapshot for the active lifecycle; every atomic `draw next` action selects one distinct winner for the next configured prize; incomplete draws resume after refresh; the browser wheel is presentation-only and shows only remaining backend-provided prizes; reset requires Admin scope, acknowledgement, and exact typed confirmation `RESET MEGA DRAW <year>`; reset atomically advances the current Mega Draw epoch to a fresh empty editable setup, immediately makes every prior epoch inaccessible, and uses separate cleanup to delete prior-epoch Mega Draw-only records; reset creates no audit or reset event and does not affect main lucky-draw claims, prizes, campaign, claim archives, aggregates, or ordinary claims CSV; execution recovery uses a required per-action idempotency key; and Mega Draw has no separate export. Four prizes are an example configuration, not a fixed requirement.
