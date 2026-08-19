# Dutta Brothers Festive Lucky Draw — Frontend Architecture & Implementation Guide

> Historical guidance - Non-authoritative. Active business rules are defined in business-rules.md and reveal.md.

> **Status:** Legacy planning guide. Use the approved specifications in `/specs` as the source of truth. This guide contains superseded inventory assumptions and must be reconciled before frontend implementation.
>
> **Migration note:** Active customer flow is `LANDING -> FORM -> ANTICIPATION -> BOX_REVEAL -> RESULT`. Gift box reveal is the active presentation mechanism; envelope and wheel reveal guidance is historical/deprecated.

> **Admin V1 supersession note:** Any legacy references in this guide to private/token-based admin access are superseded by the approved no-auth Admin V1 model. Tailwind CSS constraints for Admin-only scope are defined by current `/specs` and must not alter customer UI.

## 1. Scope and responsibilities

This frontend owns the React + TypeScript experience for the Dutta Brothers festive draw.

It is responsible for:

- React application structure and component architecture
- TypeScript typing and shared interfaces
- form validation and UX states
- REST API communication
- festive gift box reveal animation and visual prize result flow
- responsive mobile-first layout
- accessibility and performance
- frontend test strategy

It does not own:

- backend business logic
- prize selection
- claim ID generation
- eligibility checks
- any DynamoDB access
- direct trust of client-side prize results

The backend is authoritative for all business decisions.

## 2. Product routes

- Customer route: /draw
- Admin route: /admin

## 3. Frontend architecture

### Recommended folder structure

```text
src/
  app/
    routes/
      draw/
      admin/
  components/
    common/
    draw/
    admin/
    reveal/
    forms/
  hooks/
    useDrawForm.ts
    useRevealAnimation.ts
    useAdminFilters.ts
  api/
    client.ts
    drawApi.ts
    adminApi.ts
  state/
    drawStore.ts
    adminStore.ts
  types/
    api.ts
    prize.ts
    claim.ts
    ui.ts
  utils/
    validation.ts
    formatters.ts
    reveal.ts
    accessibility.ts
  styles/
    tokens.css
    globals.css
    utilities.css
  test/
    setup.ts
    helpers/
```

### Architectural principles

- keep business logic out of App.tsx
- keep route-level orchestration thin and explicit
- place reusable logic in hooks and utilities
- use typed API contracts for backend responses
- isolate reveal timing/state utilities in pure utilities for testing
- keep UI components presentation-focused
- maintain a clear separation between state, API, and rendering

## 4. Customer experience architecture

### Page flow

- Landing page introduces brand and festive campaign
- Form collects:
  - Name
  - Mobile Number
  - Bill Number
- single primary draw action
- page moves to loading state while eligibility is checked
- backend returns success or claimed/error response
- gift box reveal runs only after success result is returned
- result state is shown with claim ID and counter instruction

### State model

The customer form should be modeled as a clear, explicit state machine.

```ts
type DrawFlowState =
  | 'idle'
  | 'editing'
  | 'submitting'
  | 'eligibility-check'
  | 'pre-draw'
  | 'box-reveal'
  | 'success'
  | 'already-claimed'
  | 'api-error'
  | 'network-error'
  | 'retry'
  | 'prize-unavailable';
```

This avoids duplicated logic and makes UX transitions predictable.

## 5. Form validation rules

### Required validation

- name: required
- phone: exactly 10 digits
- bill number: required

### UX rules

- inline validation only
- no browser alert()
- validate on field blur and on submit
- disable submit while request is in progress
- keep messages concise and clear
- do not show generic errors before the user interacts

### Field behavior

- Name: text input, trimmed before validation
- Phone: numeric keypad friendly; use inputMode="numeric" and pattern matching where supported
- Bill Number: text input, trimmed, required

### Validation helper design

Create a pure utility module:

- validateName(value: string)
- validatePhone(value: string)
- validateBillNumber(value: string)
- validateDrawForm(data: DrawFormValues)

These utilities should be deterministic and testable.

## 6. API integration design

### API layer

Use a typed HTTP client with a dedicated service layer.

Example responsibilities:

- base URL composition
- request serialization
- error normalization
- typed response parsing
- retry policy for transient errors

### Contracts

#### POST /draw

Request:

```ts
type DrawRequest = {
  name: string;
  phoneNumber: string;
  billNumber: string;
};
```

Success response:

```ts
type DrawSuccessResponse = {
  success: true;
  claimId: string;
  prize: {
    id: string;
    name: string;
    displayName: string;
    imageUrl?: string;
  };
};
```

Already claimed response:

```ts
type DrawAlreadyClaimedResponse = {
  success: false;
  code: 'ALREADY_CLAIMED';
  message: string;
  existingClaim: {
    prize: {
      id: string;
      displayName: string;
    };
    claimId: string;
  };
};
```

Error response:

```ts
type DrawErrorResponse = {
  success: false;
  code: 'VALIDATION_ERROR' | 'PRIZE_UNAVAILABLE' | 'API_ERROR';
  message: string;
};
```

### API state handling rules

- do not allow multiple simultaneous submissions
- disable submit while a request is in flight
- separate loading state from result state
- treat already-claimed as a distinct, non-reveal result
- map API errors to friendly retry UX

## 7. Reveal architecture

### Rules

- backend decides the winning prize
- frontend reveal presents only the backend-selected prize
- reveal sequence is deterministic and state-driven
- labels and result content stay readable on small screens
- no random prize selection in the browser

### Reveal utilities

Create pure utility functions with deterministic behavior:

- getRevealStateTimeline(config)
- shouldUseReducedMotion(preference)
- buildResultAnnouncement(response)
- normalizeRevealTiming(config)

These should be exported and tested separately from component rendering.

### Deterministic mapping requirement

The winning prize returned from the backend is the source of truth. The reveal must not guess or pick a winner.

### Animation design

- use controlled state transitions, not random reveal behaviour
- include pre-draw anticipation and reveal phases
- ease-in/out timing for premium feel
- reveal completion transitions to result card with no prize mutation

## 8. State management

### Recommended approach

Use local component state for small, route-scoped forms and simple flow toggles. For more complex or shared state, use a minimal state pattern with a reducer or lightweight store.

### Preferred pattern

- useForm hook for form state and validation
- useDrawSubmission hook for submit lifecycle and API orchestration
- useRevealAnimation hook to manage reveal state and easing
- route-level reducer for clear transitions between states

### Avoid

- putting business decisions in React components
- constructing prize logic in UI code
- storing hidden or derived client-side source-of-truth prize data

## 9. Component hierarchy

### Customer page

- DrawPage
  - BrandHeader
  - CampaignIntro
  - DrawForm
    - NameInput
    - PhoneInput
    - BillNumberInput
    - SubmitButton
  - DrawRevealPanel
    - GiftBoxReveal
    - RevealLayer
    - ResultOverlay
  - ResultStateCard
    - SuccessState
    - AlreadyClaimedState
    - ErrorState
    - RetryState

### Admin page

- AdminPage
  - DashboardHeader
  - SummaryCards
  - SearchAndFilterBar
  - PrizeDistributionPanel
  - ClaimsTable
  - PaginationControls
  - PrizeConfigurationPanel

## 10. Responsive rules

Test thoroughly for:
- 360px
- 375px
- 390px
- 430px
- large mobile/tablet widths

### Rules

- single-column mobile layout by default
- no horizontal scrolling
- minimum 44x44 px touch targets
- content should remain comfortably spaced
- form fields should be easily tappable
- reveal area should stay within safe viewport bounds
- avoid squeezing result/prize text
- maintain proper stacking for result content

### Responsive behavior

- on small screens, the reveal area should be the main hero element
- maintain collapse order: form, then reveal area, then result state
- on larger screens, allow a two-column composition if space is available, but keep a clear hierarchy

## 11. Accessibility requirements

### HTML and semantics

- semantic form structure with labels
- buttons for primary actions
- appropriate field types and helper text
- aria-invalid on invalid fields
- aria-describedby linking validation text
- visually hidden live region for result and error updates where appropriate

### Interaction

- keyboard accessible controls
- visible focus rings
- strong contrast for text and controls
- avoid color-only validation messaging
- reveal result should also be available as readable text in a status region

### Motion preferences

- respect reduced-motion settings
- keep animations smooth and subtle
- avoid excessive flashing and clutter

## 12. Testing strategy

### Unit tests

- validation helpers
- reveal timeline/state helpers
- formatters and normalization helpers

### Component tests

- form validation message rendering
- button disabled state while submitting
- error handling and retry flow
- already-claimed result rendering
- success result rendering
- reveal receiving backend prize data and transitioning to result

### Integration tests

- successful draw flow end-to-end in component-level testing
- duplicate response handling
- API error handling and retry state
- responsive-critical layout checks where practical

### Required coverage areas

- form validation
- API states
- duplicate response
- successful draw
- button disabling
- error handling
- responsive-critical behavior

### Example test list

- empty name shows validation
- invalid 10-digit phone fails validation
- required bill number fails validation
- submit button disabled during request
- success response triggers gift box reveal and result card
- duplicate claim response shows already-claimed state without reveal animation
- API error shows retry state
- reveal preserves backend prize/result parity for every success response

## 13. Performance objectives

- keep bundle lean and dependency count minimal
- lazy-load non-critical admin panels if needed
- optimize font loading and avoid excessive font families
- keep animations GPU-friendly and within a reasonable duration
- avoid unnecessary re-renders with memoization where justified
- ensure reveal components are deterministic and not unnecessarily rebuilt
- serve compressed assets and keep images optimized

## 14. Styling and design system alignment

The frontend must follow the design system created by the UI/UX designer:

- deep crimson, maroon, antique gold, saffron, ivory
- premium but restrained festive palette
- warm ivory background and rich accent surfaces
- elegant headings, readable body typography
- subtle festive patterns and ornaments, not heavy religious imagery
- no casino styling, neon, or childish visual language

### Styling approach

- CSS variables or design tokens
- component-scoped styling with clear reuse
- maintain strong spacing consistency
- preserved focus and contrast states
- compact styling for mobile layout with scaling to larger screens

## 15. Frontend quality gate

Before a frontend feature is considered complete, verify:

- form validation works correctly
- inline errors are clear and accessible
- submit button disables immediately on request
- backend result is the sole source for prize outcome
- gift box reveal displays the returned prize without mutation
- success and duplicate states are distinct
- mobile responsiveness is tested at 360/375/390/430px
- lint passes
- tests pass
- build passes
- accessibility checks are reviewed
- no unnecessary component complexity was introduced

## 16. Implementation standards

- React + TypeScript required
- no direct DynamoDB access or backend logic in the frontend
- typed props and reusable components
- hooks for shared logic
- clear naming and separation of concerns
- keep App.tsx thin and route-focused
- minimal dependencies
- avoid large amounts of logic inside UI components

## 17. Summary

The frontend should be a clean, user-trusted, mobile-first experience that acts as a reliable presentation layer for a backend-authoritative draw. The critical architectural rule is simple: the browser may validate input and animate the gift box reveal, but it may never decide eligibility or prize outcome.

This keeps the implementation safe, testable, and aligned with the product requirements while preserving the premium festive tone desired by the Dutta Brothers campaign.
