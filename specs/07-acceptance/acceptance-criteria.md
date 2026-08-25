# Acceptance Criteria

Status: APPROVED  
Backend impact: None  
API impact: None  
Owner: Principal Software Engineer  
Version: 1.8
Last Updated: 2026-08-21
Change: Claim deletion, contention retry, and deployment provenance
Reason: Align acceptance criteria with implemented runtime and delivery behaviour

These criteria define the Definition of Done for the initial product scope.

## 1. Customer Validation

- [ ] Name is required, trimmed, non-blank, at most 100 characters, and rejects control characters.
- [ ] Name accepts normal Unicode letters, spaces, apostrophes, hyphens, and periods without enforcing a cultural format.
- [ ] Phone contains exactly 10 digits and is rejected otherwise.
- [ ] Bill is required, trimmed, non-blank, at most 50 characters, and rejects control characters and unsupported characters.
- [ ] Frontend validation provides usable inline messages and backend validation independently enforces the same rules.

## 2. Participation

- [ ] A valid customer can complete one draw for an unused bill.
- [ ] Bill Number is the only participation key.
- [ ] The same normalized bill is rejected for a different person, phone number, device, or browser.
- [ ] Equivalent bill inputs such as `" db12345 "`, `"DB12345"`, and `"db12345"` are treated as the same bill.
- [ ] Concurrent requests for the same bill create at most one successful claim.
- [ ] A retry after a lost successful response returns `ALREADY_CLAIMED` with the original claim ID, prize, and timestamp.

## 3. Prize Selection

- [ ] Only active prizes with positive weights are eligible.
- [ ] Relative weights produce the specified probability ratios and are not treated as percentages.
- [ ] One active positive-weight prize is selected successfully.
- [ ] Zero active prizes return `NO_ELIGIBLE_PRIZE`.
- [ ] Zero or negative configured weights are rejected and never selected.
- [ ] Corrupted invalid prize data fails safely without selecting an invalid or fallback prize.
- [ ] A newly added active prize with a positive weight is eligible for future draws.
- [ ] A changed weight affects future selections.
- [ ] Deactivated prizes are excluded from future draws.
- [ ] Reactivated prizes with valid positive weights become eligible for future draws.
- [ ] No inventory, stock, quantity, or depletion management exists.

## 4. Reveal Presentation

- [ ] Customer flow explicitly includes `LANDING -> FORM -> (BACKGROUND PROCESSING, NOT CUSTOMER-VISIBLE) -> ANTICIPATION -> BOX_REVEAL -> RESULT` for successful draws.
- [ ] Landing screen provides a short campaign headline, short promise message, minimal supporting copy, and one dominant CTA.
- [ ] Form screen remains compact, keeps existing approved fields/validation unchanged, and uses one dominant CTA.
- [ ] Full gift box hero is not persistently displayed on the form screen.
- [ ] A small festive gift motif near CTA is optional and must not dominate form usability.
- [ ] `ANTICIPATION` state exists and communicates backend verification without implying client-side prize selection.
- [ ] Reveal experience opens inside an immersive near-full-screen overlay before `ANTICIPATION`.
- [ ] Overlay opens only after authoritative successful response is available.
- [ ] `ANTICIPATION` duration is approximately 0.8-1.2 seconds under normal motion.
- [ ] **AC-UX-ANTICIPATION-TIMING**: Given a successful authoritative draw response, when normal motion is enabled, `ANTICIPATION` transitions to `BOX_REVEAL` within 0.65-1.35 seconds.
- [ ] `ANTICIPATION` timing is visual-only and does not delay backend processing or alter backend authority.
- [ ] Frontend does not select prize data during `ANTICIPATION`; authoritative backend response remains the only result source.
- [ ] Technical API processing stages are not exposed as customer-facing copy.
- [ ] Reduced-motion mode is not forced to wait for full anticipation animation duration before progressing.
- [ ] If automated timing precision is unreliable in browser/test environments, automation validates configured duration and state transition sequence while runtime QA validates observed timing range.
- [ ] The customer reveal mechanism is festive gift box reveal.
- [ ] The reveal is presentation-only and does not determine prize selection.
- [ ] The reveal is a dedicated visual state and not a persistent page ornament.
- [ ] Gift box is the primary visual focus in `BOX_REVEAL`.
- [ ] Customer can activate the gift box through a clear tap/click interaction.
- [ ] Gift box uses supplied assets as independent presentation layers where needed for reveal choreography.
- [ ] Reveal implementation has no CSS sprite-sheet dependency.
- [ ] Reveal implementation has no dependency on the original composite reference image.
- [ ] Box opening animation sequence occurs after customer activation.
- [ ] Gift box opening accepts only one activation per successful response.
- [ ] Double tap/click does not restart opening animation.
- [ ] Opening feedback is immediate on first activation.
- [ ] Celebration effect appears after activation and before/with result transition.
- [ ] Winning text matches the backend-selected prize.
- [ ] Prize is the visual hero in `RESULT`.
- [ ] `RESULT` remains in the same immersive overlay used for anticipation and reveal.
- [ ] Displayed claim ID matches the backend-generated claim ID.
- [ ] Claim ID is prominently visible in `RESULT`.
- [ ] The reveal completes and transitions to the result state for `SUCCESS`.
- [ ] Frontend does not select a prize and does not calculate prize probability during reveal.
- [ ] Result values match the authoritative API response payload.
- [ ] Already-claimed, draw-ended, no-eligible-prize, `API_ERROR`, and `NETWORK_ERROR` states do not trigger a misleading winning reveal.
- [ ] `API_ERROR`, `NETWORK_ERROR`, and `RETRY` states are explicitly represented.
- [ ] `API_ERROR -> RETRY -> CHECKING_ELIGIBILITY` and `NETWORK_ERROR -> RETRY -> CHECKING_ELIGIBILITY` transitions are supported.
- [ ] Reduced-motion mode provides a non-animated or minimal-motion reveal path with full result parity.
- [ ] Reduced-motion mode preserves prize announcement, result visibility, claim ID visibility, and actionable controls.
- [ ] Reveal/result uses semantic announcement (status/live region or equivalent) so assistive technologies receive prize and state updates.
- [ ] Focus is moved intentionally on reveal-to-result transition and is never lost.
- [ ] Result state receives appropriate focus after reveal completion.
- [ ] Focus enters the immersive overlay when reveal opens.
- [ ] Focus returns to Play Now or the originating control after overlay close.
- [ ] Screen readers receive appropriate state announcements for anticipation, reveal readiness, and result availability.
- [ ] Primary actions in result, error, and retry states are keyboard operable.
- [ ] Focus indicators are visible in all interactive states.
- [ ] Status meaning does not rely only on color or animation.
- [ ] Touch targets are at least 44x44 px.
- [ ] Backdrop dismissal is disabled during active reveal progression.

## 5. Claim ID

- [ ] Claim ID is generated server-side.
- [ ] Claim ID consists of `DB26-` followed by exactly six numeric digits.
- [ ] Claim ID is unique within the campaign.
- [ ] Official claim timestamp is server-generated, returned as ISO 8601 UTC, and displayed in `Asia/Kolkata` in admin views.

## 6. Draw Lifecycle

- [ ] Backend enforces campaign participation boundaries from configured From Date and To Date.
- [ ] Campaign and reporting calculations use `Asia/Kolkata`.
- [ ] Admin “today” uses the `Asia/Kolkata` calendar date.
- [ ] Admin selects From Date using a calendar/date-picker control.
- [ ] Admin selects To Date using a calendar/date-picker control.
- [ ] No campaign time-of-day selection is required.
- [ ] From Date and To Date are required and must be valid calendar dates.
- [ ] From Date cannot be after To Date.
- [ ] Campaign status is clearly displayed.
- [ ] `DRAW_ENDED` prevents claim creation and counter updates.
- [ ] `NO_ELIGIBLE_PRIZE` does not award a fallback prize or update counters.

## 7. Admin

- [ ] Admin route opens directly to the operations page with no separate dashboard landing step.
- [ ] Admin data loads automatically on page load.
- [ ] Admin can manually refresh operational data with a dedicated `Refresh` action.
- [ ] Manual refresh reloads summary, campaign, prizes, and claims.
- [ ] Admin page structure order is Campaign Configuration, Prize Summary, Prize Management, then Claims.
- [ ] Admin UX remains operational: simple, fast, clear, compact, functional, responsive, and easy to operate.
- [ ] Admin experience avoids customer-style festive reveal interactions and unnecessary decorative motion.
- [ ] Admin can add a prize using Prize Name, numeric Weight, and Active/Inactive toggle.
- [ ] All configured prizes are displayed in prize management.
- [ ] Active prizes are displayed.
- [ ] Inactive prizes are displayed.
- [ ] Prize Name is required when creating a prize.
- [ ] Existing prize names are immutable and cannot be changed.
- [ ] Admin can configure weight and activate/deactivate prizes.
- [ ] Active/inactive toggle state persists successfully when update succeeds.
- [ ] Failed toggle updates do not falsely update the UI state.
- [ ] Weight is clearly described as relative (not percentage) with a simple ratio example.
- [ ] Invalid/negative weight is rejected.
- [ ] Inactive prizes do not participate in selection.
- [ ] Historical claim contents and awarded prizes cannot be modified.
- [ ] Admin can delete one claim after explicit confirmation.
- [ ] Admin can clear all claims after stronger typed confirmation.
- [ ] Deleting a claim decrements total, daily, and prize `Given` aggregates and releases its normalized bill.
- [ ] Clearing all claims resets claim-derived aggregates while preserving prize and campaign configuration.
- [ ] Admin can view successful claims, bounded pagination, date filtering, prize filtering, and approved search fields.
- [ ] Claims default to all results when no prize card filter is selected.
- [ ] Selecting a prize card applies that prize as active claims filter.
- [ ] Selecting another prize replaces the current prize filter.
- [ ] Selecting `Clear Filters` clears prize filter and returns to all claims.
- [ ] Claims `Prize` dropdown reflects the active prize filter.
- [ ] Selected prize card state is persistent and clearly visible.
- [ ] Prize-card filter interaction is keyboard accessible.
- [ ] Focus state and selected state are visually distinguishable.
- [ ] Active/inactive toggle interaction does not trigger prize-card selection.
- [ ] Filtered claims correspond to selected prize.
- [ ] Empty filtered results show `No claims found for this prize.`
- [ ] Admin can view total successful spins, today’s successful spins, and prize distribution from aggregate counters without loading all claims.
- [ ] Admin can configure Campaign From Date and To Date without time entry.
- [ ] Invalid campaign date ranges are rejected.
- [ ] Campaign status reflects configured date range.
- [ ] Admin can view prize `Given` counts based on successful persisted claims only.
- [ ] Failed attempts, rejected submissions, duplicates, and unsuccessful requests are excluded from `Given` counts.
- [ ] `Given`/`Awarded` count is not inventory, stock, or remaining quantity.
- [ ] Prize cards themselves are the primary shortcut to prize-filtered claims report.
- [ ] Claims filter `From Date` and `To Date` use calendar/date-picker controls with date-only input.
- [ ] Claims date filter UI does not require time-of-day input.
- [ ] Frontend maps claims date-only filter values to UTC day-boundary timestamps for API requests.
- [ ] Search supports claim ID, customer name, normalized bill number, and prize name with the specified matching behaviour.
- [ ] CSV contains only claim ID, date/time, customer name, unmasked phone, bill number, and prize.
- [ ] CSV export includes all successful claims regardless of active claims filters.
- [ ] Admin light and dark themes both preserve professional readability with visible keyboard focus states.
- [ ] Initial admin load failure shows a single actionable error state with retry.
- [ ] Initial admin load does not render partial operational data when required initial datasets fail.
- [ ] In-flight operations display explicit loading state text for campaign, claims, CSV, and prize actions.

## 8. Security

- [ ] Admin route and admin APIs do not require authentication in V1.
- [ ] Admin page opens directly without login or token entry UI.
- [ ] No token header authentication, session, cookie-based auth, Cognito, OIDC, OAuth, SSO, JWT, or authentication bootstrap is introduced for V1 admin access.
- [ ] No customer endpoint behavior or business-critical draw rule depends on client-side trust.
- [ ] Lambda receives only the minimum scoped permissions required for runtime responsibilities.
- [ ] All taggable AWS resources created by CDK include tags `project=lucky-draw` and `organization=dutta-brothers`.
- [ ] CSV values beginning with `=`, `+`, `-`, or `@` are prefixed with a single apostrophe before normal CSV quoting.
- [ ] No internal database identifiers or unnecessary personal information are exported.

## 12. Admin UI Technology

- [ ] Tailwind CSS usage is limited to the Admin screen in V1.
- [ ] Customer-facing layout, CSS, components, visual behaviour, and animations are unchanged by Admin Tailwind adoption.
- [ ] Tailwind preflight/global resets are isolated so they do not alter customer-facing UI.

## 9. Mobile

- [ ] Customer experience works at 360px, 375px, 390px, and 430px widths.
- [ ] Admin prize management works at 360px, 375px, 390px, and 430px widths.
- [ ] Claims report remains usable on mobile without problematic fixed-width horizontal scrolling.
- [ ] Calendar/date-picker controls remain usable on mobile target widths.
- [ ] Prize active/inactive toggles remain easy to operate on mobile target widths.
- [ ] Claims filtering remains usable on mobile target widths.
- [ ] Admin claims search matches case-insensitive partial patterns across claim ID, customer name, normalized bill number, and prize name.
- [ ] Claims do not expose a user-configurable page-size control.
- [ ] Claims load newest-first and automatically append the next bounded cursor page when the list end is reached.
- [ ] Infinite-scroll loading displays a status message with the number of loaded claims out of the total successful claims.
- [ ] Applying or clearing claims filters resets the loaded claims list and cursor.
- [ ] Landing and form screens avoid unnecessary initial scrolling where feasible.
- [ ] The reveal area fits the available content width at all target widths.
- [ ] The reveal does not overlap important controls or create horizontal scrolling.
- [ ] The draw CTA remains usable and the result area remains visible after reveal completion.
- [ ] Primary CTA remains thumb-reachable at target widths.
- [ ] **AC-UX-CTA-MOBILE**: At 360px, 375px, 390px and 430px viewport widths, the primary customer CTA is fully visible and operable without horizontal scrolling or zooming, with a minimum 44x44px touch target.
- [ ] Primary CTA is not obscured by any element and does not overlap another interactive control.
- [ ] Primary CTA is positioned within the primary thumb-reach interaction zone for the mobile layout when presented on screen.
- [ ] Where vertical scrolling is required, CTA may be below initial viewport, but operation must still not require horizontal scrolling or zooming.
- [ ] Keyboard focus reaches the primary CTA, visible focus indication is preserved, and sticky/fixed UI plus safe-area insets do not clip or obscure CTA.
- [ ] Gift box remains centered during BOX_REVEAL at target widths.
- [ ] Prize and claim ID are immediately readable in result state at target widths.
- [ ] Touch targets, text, keyboard behaviour, and error messages are usable on mobile.

## 10. Error Handling

- [ ] API failure and network failure are handled with usable messages and safe retry behaviour.
- [ ] `API_ERROR` and `NETWORK_ERROR` are represented as distinct customer-facing states.
- [ ] `RETRY` is represented explicitly and resubmits the same request safely.
- [ ] Machine-readable API states and the specified HTTP status codes are returned.
- [ ] `ALREADY_CLAIMED` returns the original claim details without creating a duplicate.
- [ ] Validation failures do not create claims or increment counters.
- [ ] Internal errors do not expose implementation, database, AWS, or secret details.
- [ ] Aggregate counters increment exactly once per successful claim and never for failed or duplicate requests.
- [ ] Transient DynamoDB transaction contention is retried with bounded backoff without duplicate claims or double-counting aggregates.
- [ ] Duplicate-bill transaction cancellation returns `ALREADY_CLAIMED`, not `INTERNAL_ERROR`.

## 11. API Request Size (APPROVED)

- [ ] In-scope JSON mutation endpoints enforce a maximum raw request-body size of 32 KB (32,768 bytes).
- [ ] Scope includes `POST /api/draw`, `POST /api/admin/prizes`, `PATCH /api/admin/prizes/{prizeId}`, and `PATCH /api/admin/campaign`.
- [ ] Payloads below the limit are accepted for normal validation/processing.
- [ ] Payloads exactly at the limit are accepted for normal validation/processing.
- [ ] Payloads above the limit are rejected with HTTP `413` and machine-readable code `REQUEST_TOO_LARGE`.
- [ ] Oversized requests do not execute business operations or mutations.
- [ ] Malformed/invalid JSON below limit still returns the approved validation behavior.
- [ ] Frontend does not auto-retry on `413`; it presents a usable API error and allows corrected resubmission.
- [ ] Application-layer oversized rejections emit structured warning logs without request-body content.

## 14. Performance Verification

- [ ] Live performance tests are restricted to `DuttaDrawFoundationStackStaging` and approved HTTPS staging hostnames.
- [ ] Live performance execution requires the exact typed confirmation `RUN_PERFORMANCE_TEST`.
- [ ] Dry-run mode executes without network calls and uses no production resources.
- [ ] The resolved performance target is printed before any scenario request is made.
- [ ] Performance scenarios never deploy, destroy infrastructure, change configuration, or bypass backend business rules.
- [ ] `sequential-20` passes only when all 20 unique sequential draws succeed without unexpected statuses.
- [ ] Same-participant concurrency produces exactly one success, nine `ALREADY_CLAIMED` responses, and one claim ID.
- [ ] Unique-participant concurrency produces 10 successful responses and 10 unique claim IDs.
- [ ] `load-500` uses the staged 50, 100, 250, and 500-user ramp, with no stage exceeding 500 users.
- [ ] `load-500` stops early when a stage reaches at least 30% 5xx responses or at least 20% timeouts.
- [ ] `load-500` fails on 5xx responses or severe circuit-breaker termination and reports non-severe throttling/timeouts as warnings.
- [ ] `randomness-5000` refuses to run unless the campaign is `ACTIVE` and eligible prizes exist.
- [ ] `randomness-5000` uses configured active positive relative weights as expected probabilities.
- [ ] `randomness-5000` reports chi-square goodness-of-fit and distinguishes PASS, INCONCLUSIVE, and FAIL using the approved p-value thresholds.
- [ ] Impossible prize outcomes and statistically significant distribution deviation fail the randomness scenario.
- [ ] Each performance scenario writes machine-readable and human-readable results.
