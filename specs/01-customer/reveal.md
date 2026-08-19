# Festive Gift Box Reveal

Status: APPROVED  
Change: Envelope/Wheel (historical) -> Festive Gift Box Reveal (active)  
Reason: Finalized UX redesign approval  
Backend impact: None  
API impact: None  
Owner: Principal Software Engineer  
Version: 1.2  
Last Updated: 2026-08-18

## Purpose

The festive gift box reveal is the active customer-facing reveal interaction.

It presents the backend-selected result in a festive, premium, and trustworthy way without introducing client-side prize selection logic.

The gift box is not a persistent page ornament. It is a dedicated reward/reveal experience after successful submission and eligibility confirmation.

The reveal experience is immersive and appears inside a near-full-screen overlay layered over the form context.

## Backend Authority

The backend is authoritative for all business-critical outcomes:

- prize selection
- eligibility validation
- claim creation
- claim ID generation
- server timestamp

The frontend reveal is presentation-only and must not:

- select a prize
- calculate weighted probability
- determine or alter the winner
- generate or alter claim IDs

## Reveal Inputs

The reveal consumes only authoritative draw response data.

Required display inputs:

- `status`
- `prize.id`
- `prize.name` / `prize.displayName`
- `claimId`
- `claimTimestamp`

If additional visualization fields exist in the response for backward compatibility, they are optional and must not control prize selection.

## Gift Box Asset Contract

The supplied gift box assets are presentation-layer resources.

Normative requirements:

- Individual supplied assets may be layered and animated independently.
- The implementation must not depend on a CSS sprite sheet.
- The implementation must not depend on the original composite reference image.
- Asset format (PNG/WebP/SVG) is an implementation decision, provided transparency requirements are preserved.
- Visual assets must not contain business logic.

This section is implementation guidance for frontend presentation and is not an API contract.

## Overlay Lifecycle Contract

### Enter

- The overlay opens only after an authoritative successful API response.
- The underlying background is visually de-emphasized.
- Focus moves into the overlay.

### During Reveal

- Backdrop click dismissal is disabled during reveal progression.
- Escape-key dismissal is disabled while opening animation is running.
- Gift box activation is single-use per successful response.

### Result State

- A close control becomes available in result state.
- Done/Continue action closes the overlay.
- Focus returns to the Play Now button or originating control after close.

### Error States

For `ALREADY_CLAIMED`, `DRAW_ENDED`, `NO_ELIGIBLE_PRIZE`, `API_ERROR`, and `NETWORK_ERROR`:

- No winning reveal animation is played.
- The state may be dismissed immediately using the primary CTA.

## Two-Layer State Model

### Business Outcome State (Authoritative)

- `SUCCESS`
- `ALREADY_CLAIMED`
- `DRAW_ENDED`
- `NO_ELIGIBLE_PRIZE`
- `API_ERROR`
- `NETWORK_ERROR`

### Presentation State (Non-Authoritative)

- `ANTICIPATION`
- `BOX_IDLE`
- `BOX_OPENING`
- `CELEBRATION`
- `RESULT`

Normative rule:

- Presentation state must never determine business outcome.
- Business state is always authoritative.

## State Model

Active customer flow states:

1. `LANDING`
2. `FORM`
3. `VALIDATION_ERROR`
4. `CHECKING_ELIGIBILITY`
5. `ANTICIPATION`
6. `BOX_REVEAL`
7. `RESULT`
8. `ALREADY_CLAIMED`
9. `DRAW_ENDED`
10. `NO_ELIGIBLE_PRIZE`
11. `API_ERROR`
12. `NETWORK_ERROR`
13. `RETRY`

## Reveal Sequence

For `SUCCESS` only:

1. Receive authoritative backend response.
2. Open immersive reveal overlay.
3. Enter `ANTICIPATION` for short anticipation.
4. Enter `BOX_REVEAL` and play festive gift box opening animation.
5. Transition to `RESULT` and display authoritative prize and claim ID in the same overlay.

For non-success states (`ALREADY_CLAIMED`, `DRAW_ENDED`, `NO_ELIGIBLE_PRIZE`, validation, failure):

- do not play misleading winning reveal animation
- show the corresponding approved state message and guidance

Failure transitions:

- `API_ERROR -> RETRY -> CHECKING_ELIGIBILITY`
- `NETWORK_ERROR -> RETRY -> CHECKING_ELIGIBILITY`

`RETRY` resubmits the same request safely and remains governed by backend idempotency correlation (if used) and normalized-bill uniqueness enforcement.

Customer-visible copy must not expose technical request lifecycle details such as API validation pipeline, eligibility-check status, or transport-state diagnostics.

## Animation Behaviour

The reveal should feel festive and premium without heavy runtime cost.

Recommended implementation constraints:

- CSS/React animation only
- no heavy video dependencies
- no long blocking animation before result visibility
- keep total reveal sequence concise for in-store usage

Recommended timing budget:

- pre-draw anticipation: about 0.8s to 1.2s
- reveal animation: about 1.2s to 2.0s
- total submit-to-result: usually under 3s on normal network

Anticipation timing QA rule:

- target anticipation duration: 0.8-1.2 seconds
- acceptable implementation variance: plus or minus 150ms
- acceptable observed anticipation duration: 0.65-1.35 seconds under normal motion
- anticipation timing is visual only and must not delay backend processing or alter backend authority
- reduced-motion users must not be forced to wait for full anticipation animation timing

Timing validation note:

- when browser/test timing precision is unreliable, automated tests should verify configured animation duration plus state-transition sequencing, while runtime QA verifies observed timing range

## Screen Composition Rules

### FORM screen

- Form remains compact and dominant.
- Full gift box hero must not appear on the form screen.
- A small festive gift motif near CTA is allowed as a promise cue.

### BOX_REVEAL screen

- Gift box is the primary visual focus.
- Tap-to-open interaction communicates anticipation and reward.
- Prize content remains hidden until backend-authoritative response is known.
- BOX_REVEAL remains within the immersive overlay without page navigation.

Box opening sequence definition:

1. Customer activates the box.
2. Box responds to interaction.
3. Glow increases.
4. Lid opens.
5. Light emerges from inside.
6. Optional festive confetti/sparkles may appear.
7. Prize result is presented.
8. Customer transitions to `RESULT`.

### RESULT screen

- Prize is the visual hero.
- Claim ID is prominent and scannable.
- Redemption instruction is clear and concise.
- RESULT remains in the same immersive overlay until the customer exits.

## Visual Direction

The reveal/result presentation combines festive India with modern electronics retail and restrained gamification.

Preferred palette and tone:

- warm ivory/deep neutral base
- maroon
- antique gold
- saffron
- restrained electric cyan or cool-blue tech accent

Guardrails:

- avoid generic lottery appearance
- avoid children's-game aesthetic
- avoid casino/slot-machine styling
- avoid decorative clutter
- avoid excessive gradients and excessive ornament
- keep festive effects concentrated in reveal/result states

## Result Transition

After reveal completion:

- show a clear congratulatory message
- show backend prize name exactly as returned
- show backend claim ID exactly as returned
- provide next-step instruction for in-store redemption

Result text must match the authoritative API response.

## Reduced Motion

When reduced motion is preferred:

- skip complex reveal motion
- use a short fade/scale transition
- preserve tap-to-open meaning and state change
- still show all result details clearly
- preserve timing and state correctness

Reduced-motion mode must maintain parity of information and business behaviour.

Reduced-motion mode must preserve:

- prize announcement
- result visibility
- claim ID visibility
- actionable controls

## Accessibility Requirements

### Semantic announcement

- Prize and result content must be available to assistive technologies without depending on animation.
- Use an appropriate semantic status/live-region approach for reveal completion and result availability.
- Status meaning must not rely only on color or motion.

### Focus management

- On transition from `BOX_REVEAL` to `RESULT`, focus must move to result content or the primary actionable control.
- Focus must not be lost during animated or reduced-motion transitions.
- Keyboard users must be able to continue interaction without pointer/touch input.

### Primary actions

- Primary actions in result, error, and retry states must be keyboard operable.
- Focus indicators must remain visible and usable.
- Minimum touch target size is 44x44 px.

## Mobile Requirements

Required viewport widths:

- 360px
- 375px
- 390px
- 430px

Requirements:

- no horizontal overflow
- reveal area fits within content width
- overlay reveal container fits within viewport and avoids clipping at all target widths
- gift box remains fully visible
- touch targets remain usable
- reveal does not overlap critical form or result content
- form, submission CTA, and result remain usable throughout the flow
- primary CTA remains thumb-reachable on target widths
- primary CTA remains fully visible and operable with minimum 44x44px touch target
- gift box remains centered during reveal
- no clipped decorative element overlaps controls
- prize and claim ID remain immediately readable in result state

## Acceptance Criteria

- The reveal is presentation-only and never determines the prize.
- Backend-selected prize is displayed exactly as returned.
- Backend-generated claim ID is displayed exactly as returned.
- BOX_REVEAL sequence completes and transitions to result on `SUCCESS`.
- Non-success states do not trigger misleading winning reveal animation.
- `API_ERROR`, `NETWORK_ERROR`, and `RETRY` are explicitly represented and follow approved transitions.
- Optional confetti/sparkles, if used, appear only during successful reveal/result celebration.
- Optional confetti/sparkles, if used, do not obscure prize, claim ID, or actionable controls.
- Reduced-motion path is supported.
- Semantic announcement of prize/result is available without relying on animation alone.
- Focus is managed on BOX_REVEAL-to-result transition and remains usable for keyboard users.
- Primary actions in result/error/retry states are keyboard operable.
- Mobile layouts at 360px, 375px, 390px, and 430px avoid horizontal scrolling.
