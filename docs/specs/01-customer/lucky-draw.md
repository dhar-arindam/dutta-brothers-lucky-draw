# Customer Lucky Draw

Status: APPROVED  
Change: Envelope/Wheel (historical) -> Festive Gift Box Reveal (active)  
Reason: Finalized UX redesign approval  
Backend impact: None  
API impact: None  
Owner: Principal Software Engineer  
Version: 1.3  
Last Updated: 2026-08-18

## Overview

The customer lucky draw is the primary user experience. It allows customers to participate in the Durga Puja + Diwali festive draw by providing their information and viewing a festive gift box reveal.

Envelope reveal and wheel reveal are historical/deprecated customer presentations retained only for traceability.

## User Journey

### Journey Stages

`LANDING -> FORM -> (BACKGROUND PROCESSING, NOT CUSTOMER-VISIBLE) -> ANTICIPATION -> BOX_REVEAL -> RESULT`

`BOX_REVEAL` is presentation-only. It displays the backend-authoritative result and must not participate in prize selection logic.

1. Customer opens the lucky draw page and sees a short festive campaign headline, short promise message, and one dominant CTA.
2. Customer continues to a compact form view.
3. Customer enters their name.
4. Customer enters their phone number.
5. Customer enters their bill number.
6. Customer presses the primary CTA (for example, "Check & Reveal").
7. Frontend validates input.
8. Backend validates the request.
9. Backend verifies the draw is active.
10. Backend verifies the bill has not already participated.
11. Backend selects the prize.
12. Backend creates the claim.
13. Backend returns the result.
14. Frontend receives authoritative response and opens an immersive reveal overlay.
15. Frontend enters a short anticipation transition and then runs the festive gift box reveal.
16. Customer sees the result with prize and claim ID inside the same overlay.

The backend creates the claim and returns `SUCCESS` before the frontend starts the result animation. If the response is lost after claim creation, a retry must not create another claim.

## Input Fields

### Name

- Required
- Trim leading and trailing whitespace.
- Must not be blank after trimming.
- Maximum length: 100 characters.
- Reject control characters.
- Allow normal Unicode letters, spaces, apostrophes, hyphens, and periods.
- Do not enforce a specific cultural naming format.
- Display in success screen and admin view

### Phone Number

- Required
- Exactly 10 digits
- Backend must validate per BR-002
- Use a numeric input that invokes the mobile numeric keyboard.
- Do not add unnecessary display formatting.
- Displayed masked in admin views (e.g., *****3210)

### Bill Number

- Required
- Trim leading and trailing whitespace.
- Must not be blank after trimming.
- Maximum length: 50 characters before and after normalization.
- Reject control characters.
- Allow letters, numbers, hyphens, slashes, and periods.
- Normalize alphabetic characters to uppercase while preserving meaningful separators.
- Must be unique per BR-001
- Backend validates uniqueness
- Use a standard text input with an appropriate mobile keyboard.
- Disable autocorrect.
- Automatic capitalization may be enabled because bill normalization is case-insensitive.

### Customer Name

- Use a standard text input.
- Do not apply autocorrect behaviour that damages the entered name.

## Major UI States

1. **LANDING** — Campaign-first festive entry state
2. **FORM** — Compact form state for name, phone, and bill input
3. **VALIDATION_ERROR** — Form input is invalid (for example, phone not 10 digits)
4. **CHECKING_ELIGIBILITY** — Internal backend request in progress (not exposed as technical customer copy)
5. **ANTICIPATION** — Short transition state communicating backend verification
6. **BOX_REVEAL** — Dedicated festive gift box reveal state
7. **RESULT** — Prize and claim ID presentation from backend response
8. **ALREADY_CLAIMED** — Bill already used
9. **DRAW_ENDED** — Draw closed per configured campaign period
10. **NO_ELIGIBLE_PRIZE** — No eligible prizes available
11. **API_ERROR** — Backend returned an error response or non-success terminal error
12. **NETWORK_ERROR** — Network timeout, connectivity loss, or transport failure
13. **RETRY** — Customer-initiated safe retry state before resubmission

## State Transitions

- `LANDING -> FORM` on primary CTA.
- `FORM -> CHECKING_ELIGIBILITY` on valid submit.
- `CHECKING_ELIGIBILITY -> ANTICIPATION -> BOX_REVEAL -> RESULT` for `SUCCESS` responses.
- `CHECKING_ELIGIBILITY -> ALREADY_CLAIMED` for duplicate bill participation.
- `CHECKING_ELIGIBILITY -> DRAW_ENDED` when campaign is closed.
- `CHECKING_ELIGIBILITY -> NO_ELIGIBLE_PRIZE` when no eligible prize exists.
- `CHECKING_ELIGIBILITY -> VALIDATION_ERROR` for invalid input response.
- `CHECKING_ELIGIBILITY -> API_ERROR` for backend non-success error.
- `CHECKING_ELIGIBILITY -> NETWORK_ERROR` for timeout or transport failure.
- `API_ERROR -> RETRY` when customer chooses retry.
- `NETWORK_ERROR -> RETRY` when customer chooses retry.
- `RETRY -> CHECKING_ELIGIBILITY` by resubmitting the same request safely.

Retry behaviour remains governed by backend idempotency correlation (if provided) and mandatory normalized-bill uniqueness.

## Customer Screen Requirements

### LANDING

- Use a short campaign headline.
- Use a short reward/promise message.
- Use one dominant CTA.
- Keep supporting copy minimal.
- Use a modern festive electronics-retail tone.

### FORM

- Keep the form compact and mobile-first.
- Keep existing approved fields and validation rules unchanged.
- Keep helper text minimal.
- Use one dominant CTA.
- CTA wording may be "Play Now" or equivalent approved UX copy.
- Do not display a full gift box hero on this screen.
- A small festive gift motif may appear near CTA as a visual promise.

### BACKGROUND PROCESSING (NON-CUSTOMER-VISIBLE)

- After valid submit, backend processing continues in background.
- Customer must not see technical processing terms such as validation, eligibility checks, API status, or server processing.
- The API call itself is not a customer-facing journey stage.

### ANTICIPATION

- Open a near-full-screen immersive reveal overlay before anticipation is displayed.
- Display a short transition state around 0.8-1.2 seconds under normal motion.
- QA timing target is 0.8-1.2 seconds with acceptable implementation variance of plus or minus 150ms.
- Acceptable observed anticipation duration is 0.65-1.35 seconds under normal motion.
- Communicate verification/processing clearly.
- Do not imply client-side prize selection.
- Anticipation timing applies only to visual presentation and must not delay backend processing.
- Reduced-motion users must not be forced to wait for the full anticipation animation duration.
- If browser or test-environment timing precision is unreliable, automated tests should verify configured duration and correct state transition while runtime QA verifies observed timing.

### BOX_REVEAL

- Use a dedicated reveal state where the premium gift box is the primary visual focus.
- Use a tap-to-open interaction with lightweight opening animation.
- Recommended sequence: tap, interaction response, glow increase, lid opening, light emergence, festive confetti/sparkles, prize result transition.
- Do not reveal prize content before authoritative backend response is available.
- Preserve reduced-motion equivalent behaviour.
- Keep reveal interaction inside the immersive overlay without navigating away from the underlying page.

### RESULT

- Present prize as the visual hero.
- Make claim ID prominent.
- Keep redemption instruction clear and brief.
- Use restrained festive celebration in a premium retail presentation.
- Ensure any confetti/sparkles remain lightweight and do not obscure prize, claim ID, or controls.
- Keep result inside the same immersive overlay.

## Copy and Messaging

- Prefer short headlines and microcopy.
- Prefer one dominant CTA per screen.
- Keep state messages brief and clear.
- Avoid long explanatory paragraphs and excessive helper text.
- Do not change approved business or legal wording without explicit approval.

## Mobile-First Design

### Target Widths

- 360px
- 375px
- 390px
- 430px

### Requirements

- No horizontal scrolling
- Comfortable vertical spacing
- Large touch targets
- Primary controls must be comfortably touchable.
- Primary CTA should remain thumb-reachable on target mobile widths.
- Primary CTA must remain fully visible within the viewport when in view and must not require horizontal scrolling, zooming, or layout manipulation to operate.
- Primary CTA must not be obscured by another element and must not overlap another interactive control.
- Sticky/fixed UI and browser safe-area insets must not clip or obscure the primary CTA.
- No important action may depend on hover.
- Readable typography
- Accessible contrast ratios
- Mobile keyboard behaviour considered
- One-handed operation where possible
- Avoid unnecessary scrolling
- Minimize decorative elements that consume screen space

### Responsive Reveal Area

At 360px, 375px, 390px, and 430px viewport widths:

- The reveal area must fit within the available content width.
- The reveal area must not cause horizontal scrolling or layout overflow.
- The reveal must not overlap the form, CTA, error messages, or result content.
- The draw CTA must remain usable before and during the draw flow.
- The draw CTA must be in the primary thumb-reach interaction zone for the mobile layout when presented on screen.
- The result area must remain visible after the reveal completes.
- The reveal must use responsive sizing rather than a fixed desktop dimension.
- Prize and claim ID must be immediately readable when result appears.

Where vertical scrolling is required, CTA may appear below the initial viewport; however, operation must never require horizontal scrolling or zooming.

Keyboard and focus QA requirements for CTA:

- Keyboard focus must reach the primary CTA correctly.
- Focus indicator must remain visible when CTA is focused.

The exact CSS implementation is left to the frontend developer.

### Priority

The customer experience must feel polished on mobile devices before optimizing for desktop.

## Form Validation

### Frontend Validation

- Name: required, max length
- Phone: required, exactly 10 digits
- Bill: required, reasonable max length

### Messaging

- Use inline validation messages
- Do NOT use browser alert() for normal form validation
- Prevent submission when validation fails
- Clear error messages guide the customer to fix issues

### Backend Validation

- Revalidate all inputs server-side
- Do not trust frontend validation alone
- Return structured error codes

## Success Experience

### Display

```
Congratulations!

You Won:

[Prize Name]

Claim ID:

[Claim ID]

Show this at the Dutta Brothers counter.
```

### Presentation

- Festive, celebratory tone
- Subtle animation and optional confetti effects during successful box reveal/result only
- Avoid excessive casino-style effects
- Clear CTA for next steps

## Already Claimed Experience

If the backend returns ALREADY_CLAIMED:

- Do NOT play a winning reveal animation
- Clearly explain that the bill has already been used
- Show the original prize
- Show the original claim ID
- Do NOT imply that the customer has won another prize

## Draw Ended Experience

If the backend returns DRAW_ENDED:

- Display an appropriate message
- Example: "The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter."
- Do NOT play a winning reveal animation
- Provide next steps if applicable

## No Eligible Prize Experience

If the backend returns NO_ELIGIBLE_PRIZE:

- Display an appropriate message
- Example: "The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter."
- Do NOT play a winning reveal animation
- Do NOT show a fallback prize

## Error Handling

### API Failure

- Display friendly error message
- Offer retry option where safe
- Do NOT submit duplicate requests
- Do NOT consume another draw due to frontend retries
- Do not expose technical API terminology to customers.

This state maps to `API_ERROR`.

### Network Error

- Detect timeouts
- Offer retry option
- Do NOT create duplicate claims on retry
- Do not expose technical networking terminology to customers.

This state maps to `NETWORK_ERROR`.

### Retry

- Expose a clear retry action from `API_ERROR` and `NETWORK_ERROR`.
- Enter `RETRY` before resubmitting.
- Resubmit the same customer request safely.
- Preserve existing backend duplicate-protection semantics.

## Retry and Duplicate Scenarios

The business rule is ONE BILL = ONE CLAIM.

### Retry after a successful draw

1. Customer presses the primary draw CTA.
2. Backend creates the claim successfully.
3. The network response is lost.
4. Frontend retries the same request.

The retry must return `ALREADY_CLAIMED` with the original claim ID, awarded prize, and original server-generated claim timestamp. It must not create a second claim. An optional `Idempotency-Key` may correlate retries, but bill uniqueness remains the ultimate protection.

### Different person using the same bill

A different name, phone number, device, or browser using the same normalized bill also receives `ALREADY_CLAIMED` with the original claim details. It must not create a second claim.

### First successful draw

The first valid request for an unused normalized bill returns `SUCCESS`, creates exactly one claim, and supplies the server-generated claim timestamp and claim ID.

## Acceptance Criteria

- ✓ Valid customer can successfully submit and receive a prize
- ✓ Invalid phone (not 10 digits) is rejected with clear error
- ✓ Duplicate participation (same bill) is prevented
- ✓ Same bill cannot be used by a different person
- ✓ Concurrent duplicate requests are prevented
- ✓ Backend selects the correct prize per weighted rules
- ✓ Festive gift box reveal completes on success
- ✓ Winning text matches the backend-selected prize
- ✓ Claim ID is generated server-side and returned
- ✓ Already claimed state displays appropriate message
- ✓ API failure is handled gracefully
- ✓ Mobile UI is fully responsive at 360px, 375px, 390px, 430px
- ✓ No horizontal scrolling
- ✓ Form works with mobile keyboard
- ✓ Draw CTA is disabled during submission
- ✓ Double submission is prevented
- ✓ A retry after a lost successful response returns the original claim without creating a duplicate
- ✓ A different person, device, or browser cannot reuse a claimed bill
- ✓ Phone input invokes a numeric mobile keyboard
- ✓ Bill input disables autocorrect and supports appropriate capitalization
