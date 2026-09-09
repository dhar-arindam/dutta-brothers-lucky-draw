# Mega Draw

Status: APPROVED
Owner: Principal Backend Engineer
Reviewed By: Experience Business Analyst
Version: 1.5
Last Updated: 2026-09-08
Change: Confirmed direct wheel-click draw, normal reset confirmation, fullscreen modal option, and final winners presentation
Reason: Approved Mega Draw ceremony and reset UX alignment

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
- Admin-authorized reset that creates a new Mega Draw lifecycle while retaining its editable ordered prize configuration.
- Admin-authorized terminal close of a completed Mega Draw for its execution year.

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
- A change required after the first successful selection requires the controlled reset in MD-008. Reset preserves the configured ordered prize slots but clears active lifecycle state and does not preserve access to historical Mega Draw results.
- A successful configuration save provides an explicit success notification.

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
- The first successful selection atomically locks the immutable candidate snapshot, campaign snapshot, and ordered prize snapshot, then selects and persists exactly one distinct winner for the last configured prize ordinal.
- Each later `draw next` action atomically selects and persists exactly one distinct winner for the next unselected configured prize in reverse order. It excludes every candidate identity already selected in that draw.
- A partially completed draw is valid, immutable for its selected rows, and resumable after refresh. Prizes must be selected strictly in reverse configured order: the last configured prize first through prize 1 last.
- The Admin explicitly clicks the presented wheel to initiate each `draw next` request. The backend selects and persists a winner only after that click. After receiving the authoritative persisted result, any wheel rotation is presentation-only and cannot select, rank, remove, or determine a winner.
- Only the current Mega Draw lifecycle may be read or operated for an execution year. It has at most one lifecycle: `SETUP` before selection, `IN_PROGRESS` after one or more but fewer than all prize selections, `COMPLETED` after the last configured prize, and terminal `CLOSED` after MD-009. An Admin may reset `SETUP`, `IN_PROGRESS`, or `COMPLETED` only through MD-008.
- The backend maintains one conditional draw-state record per execution year to serialize each next-prize action and recover a stale in-progress operation without selecting a second winner for the same prize ordinal.
- The Admin UI creates and retains one opaque idempotency key for each `draw next` action. The backend binds the key to the authenticated Admin subject, execution year, draw reference, next prize ordinal, and request fingerprint.
- A retry with the same idempotency key returns the original selected row or its current operation status. Reusing a key with different request details is rejected.
- A concurrent request with a different idempotency key returns `MEGA_DRAW_IN_PROGRESS` while a next-prize action is active, or the current persisted lifecycle state once it is available.
- The browser wheel displays the remaining ordered prize names supplied by the backend in the required festive preparation modal. The prize names may be split across lines for readability. It is the explicit initiation control, but it does not provide selection input or determine the winner.

### MD-006 - Preflight, Confirmation, and Operational Flow

- The Admin UI presents a preflight summary with execution year, backend-derived eligible-candidate count, ordered prize names, distinct-winner rule, and irreversible-result notice.
- A backend preflight snapshot includes a unique reference, candidate count, configured prizes, campaign snapshot, and expiry. The first `draw next` action validates that it remains current and locks its candidate population when it succeeds.
- If the candidate population, prize configuration, campaign status, or execution year changes, or the preflight expires before the first selection, the backend returns `PREFLIGHT_STALE`; the Admin UI refreshes the preflight summary and requires a fresh preflight before the first wheel click. Preflight freshness no longer applies after the immutable snapshot is locked.
- `Prepare draw` opens a modal using the customer page's festive theme. The modal displays a flashing, colorful rainbow-spoked wheel with surrounding glowing bulbs and the next prize in reverse configured order. On desktop, the modal provides a fullscreen toggle; mobile screens use the normal responsive modal only.
- Every `draw next` action is initiated directly by an explicit Admin wheel click. No acknowledgement checkbox, typed confirmation, or separate submit button is required for RUN.
- While a next-prize action is in progress, repeat submission is disabled without showing transient validation text in the modal. After success, the wheel performs a presentation-only rotation of at most seven full turns, then reveals the persisted winner for that ordinal.
- During the winner reveal, the just-drawn prize remains visible on the wheel until the winner label is shown. The winner label highlights the prize as the primary reveal, shows the winner name, and shows the winner phone number on a separate line in the authenticated Admin-only modal.
- After the last selection, the modal hides the wheel after the final reveal delay and shows a responsive grid of all winner labels. The page results continue to display all winners in chronological selection order, the completed timestamp in `Asia/Kolkata`, and a persistent Mega Draw reference.
- Wheel rotation begins only after the backend returns the authoritative selected row and is presentation-only. The festive preparation modal may use the customer page's theme; it does not change customer draw behaviour.

### MD-007 - Results

- An active draw lifecycle preserves the execution year, current epoch, locked campaign/candidate/prize snapshots, ordered selected rows, current next prize ordinal, status, and completed UTC timestamp when complete. Each row preserves its selected candidate identity, source claim ID, source claim timestamp, and candidate-pool count until reset.
- Admin result views mask phone numbers by default, consistent with existing claims reporting. The authenticated festive winner reveal modal may show the selected candidate's full normalized phone number for operator confirmation.
- Mega Draw winners, snapshots, and results have no separate export. The existing year-based claims CSV remains the only export and retains its approved scope and format.
- No Mega Draw audit trace, reset event, close event, historical void/redraw history, or Mega Draw-specific retention requirement exists. Reset immediately removes the active lifecycle results and state; no Mega history is retained.
- In-progress and completed results remain viewable to authenticated administrators after main-draw prize configuration changes.

### MD-008 - Reset Mega Draw

- Once a campaign has ended, an administrator's delete action archives every claim from that campaign rather than physically removing it. Archived claims are excluded from normal claims views and the existing claims CSV by default.
- An archived claim is not eligible for a Mega Draw or later redraw. Its archived record remains available only for authorized audit and reconciliation use.
- An in-progress or completed Mega Draw preserves its immutable winner and source-claim snapshots if a referenced source claim is archived. When this occurs, the applicable selected row is marked `SOURCE_CLAIM_ARCHIVED`.
- Archiving has the same active-record effects as the existing physical delete operation: it decrements the associated prize `Given` count, total successful claims, and applicable daily count, and it releases the normalized bill for future participation.
- Clear-all archives all claims after campaign end, applies the same aggregate and bill-release effects to each active claim, and does not alter any active Mega Draw state.
- Deleting a winner's source claim does not automatically select a replacement winner.
- An administrator may reset a `SETUP`, `IN_PROGRESS`, or `COMPLETED` Mega Draw only with a valid Admin-scoped Cognito session and a normal destructive confirmation dialog. The UI must not require a checkbox or typed phrase for reset.
- Reset clears only the active Mega Draw winner rows, lifecycle, preflight, locked candidate/campaign/prize snapshots, and idempotency/execution-state records. It preserves the configured ordered Mega prizes and restores them as editable configuration.
- On success, reset returns the execution year to an editable setup with the preserved ordered prizes. The administrator may edit those prizes, request a new preflight, and start selection again using the then-current eligible population. Because selected candidates are recorded only in the cleared lifecycle state, all previously selected candidates are eligible again for the new lifecycle.
- Reset must not alter main lucky-draw claims, main prizes, campaign configuration, claim archives, aggregate records, or the ordinary claims CSV and must not restore or change archived claims.
- Reset creates and retains no Mega Draw audit trace, reset event, void record, replacement relationship, historical result, or redraw history.

### MD-009 - Close Mega Draw

- Only an authenticated Admin-scope user may close a `COMPLETED` Mega Draw.
- Close requires a strong confirmation consisting of acknowledgement and exact typed confirmation `CLOSE MEGA DRAW <year>`.
- A successful close changes the execution year's lifecycle to terminal `CLOSED`. Results remain viewable in chronological selection order, but no new draw, configuration update, preflight, or reset is allowed for that execution year.
- Closing creates and retains no Mega Draw audit, close event, or historical record. No Mega history is retained.

## 4. API and Data Implications

The API and data-model changes required by this specification are defined in the approved core specifications. The contract surface includes:

- Authenticated Mega Draw configuration read and update operations.
- Authenticated preflight operation returning backend-derived execution year, eligibility count, configuration state, and completion state.
- One idempotent authenticated `draw next` operation requiring the preflight reference only for the first selection and an idempotency key for every action.
- Authenticated lifecycle read operation returning selected rows, next prize, remaining prizes, and completion state.
- Machine-readable errors: `MEGA_DRAW_NOT_CONFIGURED`, `INSUFFICIENT_ELIGIBLE_PARTICIPANTS`, `MEGA_DRAW_IN_PROGRESS`, `MEGA_DRAW_ALREADY_COMPLETED`, `PREFLIGHT_STALE`, `CAMPAIGN_NOT_FOUND`, `MEGA_DRAW_CONFIGURATION_LOCKED`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, and `INTERNAL_ERROR`.
- An execution-year Mega Draw configuration plus active lifecycle, expiry-bound preflight, locked campaign/candidate/prize snapshots, chronologically ordered winner rows, source-claim references, and per-action execution-state and idempotency records. Reset clears active lifecycle data while retaining editable ordered prizes; terminal close preserves viewable results while rejecting further lifecycle mutations.

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
- [ ] Saving valid Mega prize configuration provides an explicit success notification.
- [ ] The first successful wheel-initiated `draw next` action locks immutable candidate, campaign, and ordered-prize snapshots and selects only the last configured prize.
- [ ] Every wheel-initiated `draw next` action selects exactly one distinct candidate identity for the next configured prize in reverse order, uniformly at random and without replacement.
- [ ] A first draw cannot start with fewer eligible candidate identities than configured prizes and returns the approved insufficient-candidate outcome without recording a snapshot or winner.
- [ ] Each next-prize action atomically records one configured prize-to-winner row or records none; partial completed rows are valid and resumable after refresh.
- [ ] A higher configured prize ordinal cannot be selected before its successor, and all prizes complete from the last configured prize through prize 1.
- [ ] Concurrent next-prize requests select at most one winner for an ordinal and return the identical recorded row or current lifecycle state.
- [ ] A retry after a lost next-prize response retrieves the original recorded row and never runs that prize selection again.
- [ ] After a lost next-prize response, the Admin UI checks the Admin-scoped idempotency-status lookup before retrying. The lookup returns only the authenticated operator's `NOT_FOUND`, `IN_PROGRESS`, or current lifecycle state.
- [ ] The Admin UI supplies one idempotency key per next-prize attempt; reuse with a changed request is rejected, and concurrent different-key attempts return the documented in-progress or current lifecycle outcome.
- [ ] The first selection validates an unexpired backend preflight snapshot. A changed candidate population, prize configuration, campaign state, execution year, or expired preflight returns `PREFLIGHT_STALE` without selecting a winner and requires reconfirmation; subsequent selections use the locked snapshot.
- [ ] A recoverable stale next-prize execution-state record does not permit a second winner for the same prize ordinal.
- [ ] `Prepare draw` opens a customer-page-themed festive modal with a flashing colorful rainbow-spoked wheel and surrounding glowing bulbs.
- [ ] The Admin UI initiates RUN directly from the wheel click without an acknowledgement checkbox, typed confirmation, or separate submit button.
- [ ] During each next-prize action, the Admin UI prevents duplicate submission without showing transient validation/progress text in the modal.
- [ ] The wheel click initiates the backend action; selection and persistence occur only after that click, and wheel rotation starts only after the authoritative result returns without determining, changing, or implying client-side winner selection.
- [ ] After each selection, the Admin UI keeps the just-drawn prize on the wheel until the winner label is shown, rotates the wheel no more than seven full turns, and highlights the selected prize in the winner label.
- [ ] After the last selection, the modal hides the wheel after the reveal delay and shows a responsive grid of all winner labels.
- [ ] Results show all winners in chronological selection order, masked winner contact information by default, completion time in `Asia/Kolkata`, and a persistent draw reference.
- [ ] An in-progress or completed Mega Draw remains unchanged after a main prize changes or a referenced source claim is archived; archival marks the applicable row `SOURCE_CLAIM_ARCHIVED` and does not select a replacement winner.
- [ ] Archiving a claim decrements the associated active aggregates and releases its normalized bill for future participation; clear-all archives all claims and applies the same effects while preserving Mega Draw records.
- [ ] Reset clears only active winner, lifecycle, preflight, locked-snapshot, and idempotency/execution state, preserves the editable ordered Mega prizes, and makes every previously selected candidate eligible for the new lifecycle.
- [ ] Reset uses a normal destructive confirmation dialog without checkbox or typed phrase.
- [ ] A completed Mega Draw requires acknowledgement and exact typed confirmation `CLOSE MEGA DRAW <year>` to enter terminal `CLOSED`; results remain viewable, but draw, configuration update, preflight, and reset are unavailable for that execution year.
- [ ] No Mega Draw audit trace, reset event, close event, historical void/redraw relationship, or Mega-specific retention history is created or retained.
- [ ] No Mega Draw winner export is available. The existing claims CSV remains the only export and retains its approved scope and format.
- [ ] Mega Draw configuration and results are usable with keyboard navigation, visible focus, screen-reader status announcements, and at 360px, 375px, 390px, and 430px widths.

## 6. Approved Decisions

Approved changes: reset preserves the editable ordered Mega prizes while clearing only the active winner/lifecycle/preflight/idempotency state; previously selected candidates become eligible again after reset; saving configuration provides explicit success notification; `Prepare draw` opens a customer-page-themed festive modal with a flashing colorful rainbow-spoked wheel and surrounding glowing bulbs; an explicit wheel click initiates each backend selection, with rotation only after the authoritative persisted result; prizes select in reverse configured order; results are displayed in chronological selection order; and a completed lifecycle may be terminally closed with acknowledgement and exact phrase `CLOSE MEGA DRAW <year>`. `CLOSED` retains viewable results but prohibits draw, configuration changes, preflight, and reset for that execution year. No Mega history or audit is retained. Main draw behaviour remains unchanged.
