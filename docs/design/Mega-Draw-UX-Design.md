# Mega Draw UX Design

Status: PENDING Principal Backend Engineer review
Owner: UI UX Expert
Product Specification: `/docs/specs/03-admin/mega-draw.md`
Version: 1.4
Last Updated: 2026-09-08

## Purpose

Mega Draw is a high-consequence operational task, not a customer experience. The design must make the operator slow down at irreversible steps, make the current state obvious, and never make randomness appear browser-controlled.

## Route and Entry

- Route: `/admin/mega-draw`.
- Show a `Mega Draw` navigation item in the Admin header only when `AdminAuthGate` reports an active session.
- A direct visit without an active Admin session redirects to `/admin`. Do not request or render Mega Draw data before the session check completes.
- Keep `/admin` readable to signed-out users exactly as today. Mega Draw is the protected exception, not a change to ordinary Admin read access.

## Visual Direction

Use the existing Admin operational visual language for the page: compact Tailwind panels, clear borders, utility typography, light/dark theme support, and restrained status color. `Prepare draw` is the explicit exception: its modal uses the customer page's festive theme, with a flashing colorful rainbow-spoked wheel and surrounding glowing bulbs. This themed presentation is limited to the modal and must not alter the customer page.

- Page header: `Mega Draw` with one compact status badge: `SETUP`, `READY`, `RUNNING`, `COMPLETED`, or `CLOSED`.
- Page structure: a single-column operational workspace, with no nested cards.
- Destructive controls use the established red/error treatment only at the final confirmation stage.
- Use labels, icons, and text for every state; color is secondary.

## Motion Direction

The Mega Draw should feel like a controlled ceremony: anticipation builds when the administrator clicks the wheel, then winners arrive with clear, measured emphasis. The wheel begins its presentation rotation only after the backend returns an authoritative persisted result; it never simulates selection or delays the API request.

### Preflight Ready

- On a successful preflight, the eligibility strip resolves from a brief skeleton shimmer into its final values over 180 to 240ms.
- The `Prepare draw` action receives one restrained emphasis pulse when it becomes available. Do not loop the pulse.
- A stale preflight uses a short horizontal shift of the freshness label only; it must not shake the whole page.

### Draw Next

- An explicit wheel click initiates the request directly. Do not show a checkbox, typed confirmation field, secondary submit button, or transient validation/progress copy in the modal for RUN.
- Progress is status-driven by the request lifecycle and may be announced outside the ceremonial modal; the modal itself remains visually stable during the request.
- The page header status badge changes to `RUNNING` with a low-amplitude breathing opacity effect. Keep this effect below 1.0Hz and stop it on completion or error.
- The modal wheel may rotate only after the backend returns the authoritative selected row. Its spokes show backend-provided prize names split into readable lines; the just-drawn prize remains visible until its winner label is shown. The wheel rotates no more than seven full turns and does not choose a prize, select a winner, or alter persisted state.

### Result Reveal

- Begin the result sequence only after the authoritative selected-row response is available.
- Reveal the newly persisted row in a winner label over the wheel, with the prize name as the highlighted reveal, the winner name, and the full phone number on its own line for the authenticated operator.
- Preserve previously selected rows in chronological selection order without replaying them.
- Do not move focus to the results heading while the RUN modal is open; this prevents modal jump during the reveal sequence. Announce the newly selected prize and the remaining-prize count through the page live region.
- Do not use confetti, full-page flashes, audio, or autoplaying effects. The result list, not motion, remains the visual focal point.

### Reset

- Reset uses a destructive dialog with a red status accent and a clear in-progress state. On success, the UI removes the completed or partial result display and returns to editable prize configuration with the preserved ordered prizes.
- Reset uses a normal destructive confirmation dialog. It does not require a checkbox or typed phrase.

### Final Winners

- After the last draw's winner reveal completes, hide the wheel in the modal and show all winner labels in a responsive grid.
- The final winners modal is a celebratory summary; the page result list remains the durable operational record with masked contact information by default.
- The fullscreen toggle is available only on desktop-sized screens and expands the modal/winner grid without changing mobile layout.

### Reduced Motion and Failure

- Under `prefers-reduced-motion: reduce`, replace all movement with immediate state changes, no stagger, and a visible status transition. Results still appear in chronological selection order.
- On API, network, or stale-preflight error, stop all motion immediately and focus the error summary or the recovery action. Do not replay the execution sequence on retry until a new authoritative result is returned.

## Page States

| State           | Primary content                                                  | Primary action                       |
| --------------- | ---------------------------------------------------------------- | ------------------------------------ |
| Loading         | Section skeletons and a polite live update                       | None                                 |
| Setup           | Prize configuration and campaign status                          | Save configuration                   |
| Ready           | Current preflight summary                                        | Prepare draw                         |
| Preflight stale | Changed-data explanation and refreshed summary action            | Refresh preflight                    |
| Running         | Locked summary and progress status                               | None                                 |
| In progress     | Immutable selected rows and remaining prizes                     | Prepare draw                         |
| Completed       | Winner results, reset control, and close control                 | Close Mega Draw                      |
| Closed          | Read-only winner results                                         | None                                 |
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
- Save configuration is distinct from preflight. A saved change invalidates the prior preflight and shows an explicit success notification.

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
- `Prepare draw` opens the festive preparation modal only when the first-selection preflight is current and candidate count is sufficient, or when a locked lifecycle has a remaining prize.
- Any candidate/configuration/campaign change before the first selection yields `PREFLIGHT_STALE`, returns focus to `Prepare draw`, and requires a new confirmation. After snapshot lock, subsequent selections use the immutable snapshot.

### 5. Draw Results

Use a numbered vertical result list rather than a table, ordered chronologically by selection. Each result row shows:

- Prize ordinal and immutable prize name.
- Winner customer name.
- Masked phone number.
- Bill number.
- Source claim ID.
- `SOURCE_CLAIM_ARCHIVED` status, when applicable.

Below the list, show remaining prize count and the persistent draw reference. On completion, also show completion time in `Asia/Kolkata`. Do not add export controls.

### 6. Reset Mega Draw

Place `Reset Mega Draw` after the completed-results summary, separated by a plain divider and marked destructive. It is unavailable after terminal close.

- Opening the dialog shows the execution year and the number of selected rows that will be removed from the active lifecycle.
- The dialog uses a normal destructive confirmation action. It does not require an acknowledgement checkbox or typed phrase.
- Submitting locks the dialog and announces progress. On success, remove active preflight, results, and lifecycle display, retain the ordered prizes as editable configuration, then focus the editable configuration heading.
- The dialog explains that reset does not alter main lucky-draw claims, prizes, campaign, claim archives, aggregate records, or ordinary claims CSV.

### 7. Close Mega Draw

Place `Close Mega Draw` after a completed-results summary and before reset. It is destructive and requires a stronger confirmation than routine actions.

- The dialog requires acknowledgement and the recommended exact typed confirmation `CLOSE MEGA DRAW <year>`, pending Principal Backend Engineer confirmation.
- On success, display a terminal `CLOSED` status. Keep results viewable in chronological selection order and remove or disable every draw, configuration, preflight, and reset control for the execution year.
- Explain that closing keeps no Mega Draw history or audit beyond the visible terminal lifecycle results.

## Dialog Behavior

### Prepare Draw

- Use a semantic modal dialog with heading `Prepare next Mega prize for <year>?` and the customer page's festive theme.
- Display the next prize in reverse configured order, already selected rows, remaining ordered prizes, and the preflight expiry when starting the lifecycle.
- Display the flashing colorful rainbow-spoked wheel with surrounding glowing bulbs. The wheel is the explicit action control and has an accessible name that identifies the next prize.
- Do not require acknowledgement or typed confirmation for RUN. Clicking the enabled wheel initiates the backend request; only after the authoritative result returns may it rotate as presentation.
- On desktop screens, provide a fullscreen toggle for the festive modal. Do not show this control on mobile screens.
- On open, focus the heading; on validation failure, focus the first invalid control; on close, return focus to the invoking action.

### Reset Mega Draw

- Use the same dialog semantics.
- Use a normal destructive confirmation dialog without checkbox or typed phrase.
- Escape and backdrop dismissal are available before submission but disabled during the in-flight operation.

### Close Mega Draw

- Use the same dialog semantics and require acknowledgement plus the recommended exact typed confirmation `CLOSE MEGA DRAW <year>`.
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
  | 'CLOSE_CONFIRMATION'
  | 'CLOSING'
  | 'CLOSED'
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
      -> MegaDrawPreparationModal
      -> MegaDrawResults
      -> ResetMegaDrawDialog
      -> CloseMegaDrawDialog
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
- Preserve entered configuration and dialog input after recoverable read/network failure. Never preserve a completed, reset, or close action as editable state.

## Implementation Handoff

- Add route recognition for `/admin/mega-draw` beside the existing `/admin` branch in `main.tsx`.
- Reuse `AdminAuthGate` for route protection, and add a route guard that redirects signed-out direct access to `/admin`.
- Create an isolated Mega Draw page, API client module, types, and tests rather than expanding `AdminPrizePage` into another large state surface. The page derives wheel spokes from backend `remainingPrizes`, sends the draw request only on explicit wheel click, and never computes a winner.
- Reuse the existing Admin Tailwind stylesheet and theme classes; scope any new styles to the Mega Draw page.
- Cover route protection, save-success feedback, setup editing through the first selection, locked configuration, reverse-ordered resumable next-prize actions, festive wheel/result parity, stale-preflight and idempotency recovery, reset preservation and renewed eligibility, terminal-close confirmation, keyboard dialogs, and the four required mobile widths.
