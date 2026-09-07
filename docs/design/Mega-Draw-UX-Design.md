# Mega Draw UX Design

Status: IMPLEMENTATION READY
Owner: UI UX Expert
Product Specification: `/docs/specs/03-admin/mega-draw.md`
Version: 1.3
Last Updated: 2026-09-08

## Purpose

Mega Draw is a high-consequence operational task, not a customer experience. The design must make the operator slow down at irreversible steps, make the current state obvious, and never make randomness appear browser-controlled.

## Route and Entry

- Route: `/admin/mega-draw`.
- Show a `Mega Draw` navigation item in the Admin header only when `AdminAuthGate` reports an active session.
- A direct visit without an active Admin session redirects to `/admin`. Do not request or render Mega Draw data before the session check completes.
- Keep `/admin` readable to signed-out users exactly as today. Mega Draw is the protected exception, not a change to ordinary Admin read access.

## Visual Direction

Use the existing Admin operational visual language: compact Tailwind panels, clear borders, utility typography, light/dark theme support, and restrained status color. Do not use the customer gift-box imagery or celebration overlay. Motion is reserved for execution feedback and result disclosure, never decorative background movement.

- Page header: `Mega Draw` with one compact status badge: `SETUP`, `READY`, `RUNNING`, or `COMPLETED`.
- Page structure: a single-column operational workspace, with no nested cards.
- Destructive controls use the established red/error treatment only at the final confirmation stage.
- Use labels, icons, and text for every state; color is secondary.

## Motion Direction

The Mega Draw should feel like a controlled ceremony: anticipation builds at the instant an irreversible operation is committed, then winners arrive with clear, measured emphasis. Animation starts only after the backend returns an authoritative completed result; it never simulates selection or delays the API request.

### Preflight Ready

- On a successful preflight, the eligibility strip resolves from a brief skeleton shimmer into its final values over 180 to 240ms.
- The `Draw next prize` action receives one restrained emphasis pulse when it becomes available. Do not loop the pulse.
- A stale preflight uses a short horizontal shift of the freshness label only; it must not shake the whole page.

### Draw Next

- Immediately after confirmed submission, lock configuration after the first selection begins and replace the action area with a three-step progress rail: `Validating snapshot`, `Selecting next prize`, `Loading winner`.
- Progress is status-driven by the request lifecycle, not a fake timed percentage. The active step uses a subtle indeterminate line sweep.
- The page header status badge changes to `RUNNING` with a low-amplitude breathing opacity effect. Keep this effect below 1.0Hz and stop it on completion or error.
- A wheel may animate only after the backend returns the authoritative selected row. Its spokes show the remaining ordered prizes returned by the backend; it does not spin to choose a prize, select a winner, or alter persisted state.

### Result Reveal

- Begin the result sequence only after the authoritative selected-row response is available.
- Reveal only the newly persisted row with a 220 to 280ms fade-and-rise motion. Preserve previously selected rows in configured order without replaying them.
- Briefly draw a gold divider for the new row from left to right, then settle it to the normal Admin border treatment.
- Move focus after the new-row sequence completes to the result status heading. Announce the newly selected prize and the remaining-prize count through the live region.
- Do not use confetti, full-page flashes, audio, or autoplaying effects. The result list, not motion, remains the visual focal point.

### Reset

- Reset uses a destructive dialog with a red status accent and a clear in-progress state. On success, the UI removes the completed or partial result display and returns to empty editable prize configuration.

### Reduced Motion and Failure

- Under `prefers-reduced-motion: reduce`, replace all movement with immediate state changes, no stagger, and a visible status transition. Results still appear in configured order.
- On API, network, or stale-preflight error, stop all motion immediately and focus the error summary or the recovery action. Do not replay the execution sequence on retry until a new authoritative result is returned.

## Page States

| State           | Primary content                                                  | Primary action                       |
| --------------- | ---------------------------------------------------------------- | ------------------------------------ |
| Loading         | Section skeletons and a polite live update                       | None                                 |
| Setup           | Prize configuration and campaign status                          | Save configuration                   |
| Ready           | Current preflight summary                                        | Draw next prize                      |
| Preflight stale | Changed-data explanation and refreshed summary action            | Refresh preflight                    |
| Running         | Locked summary and progress status                               | None                                 |
| In progress     | Immutable selected rows and remaining prizes                     | Draw next prize                      |
| Completed       | Winner results and reset control                                 | Reset Mega Draw                      |
| Blocked         | Campaign not ended, missing campaign, or insufficient candidates | Return to setup or refresh           |
| Error           | Scoped operational error with safe recovery                      | Retry the failed read/preflight only |

## Layout

### 1. Header

- Breadcrumb link: `Admin`.
- `Mega Draw` heading and current state badge.
- Right-aligned `Back to Admin` icon button with tooltip on desktop; accessible label on all viewports.
- Do not expose any Mega Draw control before authentication is confirmed.

### 2. Campaign and Eligibility Strip

An unframed, high-contrast status strip immediately under the header. It is the first decision signal.

- Execution year in `Asia/Kolkata`.
- Campaign status and campaign date range.
- Eligible candidate count from the backend preflight.
- Preflight freshness: `Not prepared`, `Ready until <time>`, or `Refresh required`.
- When blocked, state the reason in the strip and do not show an enabled run action.

### 3. Prize Configuration

Editable only before the first successful selection. After that selection, show the locked ordered prize snapshot and a message that configuration changes require reset.

- Ordered list labeled `Mega prizes`.
- Each row contains a fixed ordinal, prize-name input, and icon-only remove button with tooltip and accessible name.
- `Add prize` is a text command button and is disabled at 10 rows.
- Preserve row order; do not add drag-and-drop. Use up/down icon buttons with accessible labels for reordering.
- Validate inline on blur and save. Duplicate or blank prize names produce field-level messages.
- Save configuration is distinct from preflight. A saved change invalidates the prior preflight.

### 4. Preflight Panel

Shown after configuration is saved and whenever preflight data is available.

Display only backend-derived data:

- Execution year and immutable campaign snapshot summary.
- Eligible-candidate count.
- Ordered prize list.
- Required winner count.
- Expiry time.
- Plain-language rule: one candidate identity is removed after it wins.

Actions:

- `Prepare draw` requests a new preflight.
- `Draw next prize` opens the confirmation dialog only when the first-selection preflight is current and candidate count is sufficient, or when a locked lifecycle has a remaining prize.
- Any candidate/configuration/campaign change before the first selection yields `PREFLIGHT_STALE`, returns focus to `Prepare draw`, and requires a new confirmation. After snapshot lock, subsequent selections use the immutable snapshot.

### 5. Draw Results

Use a numbered vertical result list rather than a table. Each result row shows:

- Prize ordinal and immutable prize name.
- Winner customer name.
- Masked phone number.
- Bill number.
- Source claim ID.
- `SOURCE_CLAIM_ARCHIVED` status, when applicable.

Below the list, show remaining prize count and the persistent draw reference. On completion, also show completion time in `Asia/Kolkata`. Do not add export controls.

### 6. Reset Mega Draw

Place `Reset Mega Draw` after the completed-results summary, separated by a plain divider and marked destructive. It is not part of the primary result action area.

- Opening the dialog shows the execution year and the number of selected rows that will be permanently removed.
- The dialog requires an acknowledgement checkbox and exact typed confirmation: `RESET MEGA DRAW <year>`.
- Submitting locks the dialog and announces progress. On success, remove the Mega Draw-only configuration, preflight, results, and lifecycle display, then focus the empty editable configuration heading.
- The dialog explains that reset does not alter main lucky-draw claims, prizes, campaign, claim archives, aggregate records, or ordinary claims CSV.

## Dialog Behavior

### Draw Next Prize

- Use a semantic modal dialog with heading `Draw next Mega prize for <year>?`.
- Display the next prize, already selected rows, remaining ordered prizes, and the preflight expiry when starting the lifecycle.
- Require acknowledgement and typed confirmation: `DRAW NEXT MEGA PRIZE <year>`.
- Disabled submit has visible explanatory text until both requirements are met.
- On open, focus the heading; on validation failure, focus the first invalid control; on close, return focus to the invoking action.

### Reset Mega Draw

- Use the same dialog semantics.
- Require acknowledgement and the exact typed confirmation `RESET MEGA DRAW <year>`.
- Escape and backdrop dismissal are available before submission but disabled during the in-flight operation.

## Frontend State Model

Keep the UI state separate from backend business decisions. Recommended route-level state:

```ts
type MegaDrawUiState =
  | 'LOADING'
  | 'SETUP'
  | 'PREFLIGHT_READY'
  | 'PREFLIGHT_STALE'
  | 'DRAW_NEXT_CONFIRMATION'
  | 'RUNNING'
  | 'COMPLETED'
  | 'RESET_CONFIRMATION'
  | 'RESETTING'
  | 'BLOCKED'
  | 'ERROR';
```

Recommended frontend boundary:

```text
AdminAuthGate
  -> MegaDrawRouteGuard
    -> MegaDrawPage
      -> MegaPrizeConfiguration
      -> MegaDrawPreflight
      -> MegaDrawConfirmationDialog
      -> MegaDrawResults
      -> ResetMegaDrawDialog
```

The route guard performs the redirect before rendering `MegaDrawPage`. API calls use dedicated typed Mega Draw service methods; the browser generates and persists one idempotency key per `draw next` attempt until its terminal backend state is known.

## Accessibility and Responsive Requirements

- All prize rows, reordering controls, dialogs, and actions are keyboard operable with visible focus.
- Use `aria-live="polite"` for loading, preflight freshness, running, completed, stale, and error announcements.
- Respect `prefers-reduced-motion`; no outcome or control availability depends on animation completion.
- Dialogs trap focus, expose descriptive labels and instructions, and restore focus on close.
- Do not rely on color for `COMPLETED`, `BLOCKED`, or `SOURCE_CLAIM_ARCHIVED` state.
- At 360px, 375px, 390px, and 430px, stack result metadata below the prize name and keep all controls at least 44 by 44 pixels.
- At desktop widths, align result metadata into stable columns without requiring a wide table.
- Preserve entered configuration and dialog input after recoverable read/network failure. Never preserve a completed or reset action as editable state.

## Implementation Handoff

- Add route recognition for `/admin/mega-draw` beside the existing `/admin` branch in `main.tsx`.
- Reuse `AdminAuthGate` for route protection, and add a route guard that redirects signed-out direct access to `/admin`.
- Create an isolated Mega Draw page, API client module, types, and tests rather than expanding `AdminPrizePage` into another large state surface. The page derives wheel spokes from backend `remainingPrizes` and never computes a winner.
- Reuse the existing Admin Tailwind stylesheet and theme classes; scope any new styles to the Mega Draw page.
- Cover route protection, setup editing through the first selection, locked configuration, ordered resumable next-prize actions, wheel/result parity, stale-preflight and idempotency recovery, reset confirmation and isolation conditions, keyboard dialogs, and the four required mobile widths.
