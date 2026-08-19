# Dutta Brothers Festive Lucky Draw — UX & Design System Guide

> Historical guidance - Non-authoritative. Active business rules are defined in business-rules.md and reveal.md.

> **Status:** Legacy planning guide. Use the approved specifications in `/specs` as the source of truth. This guide contains superseded phone-plus-bill and inventory assumptions and must be reconciled before implementation.
>
> **Migration note:** Active customer reveal is now the festive gift box reveal (`BOX_REVEAL`). Envelope reveal guidance in older planning drafts is historical/deprecated for active implementation.

## 1. UX flow

### Customer flow

1. Customer lands on the Lucky Draw page.
2. Landing screen introduces the festive campaign with short copy and one dominant CTA.
3. Customer fills in:
   - Name
   - Mobile Number
   - Bill Number
4. Customer taps the single primary draw CTA.
5. Interface validates local form fields.
6. If valid, the page enters a checking-eligibility state.
7. Backend verifies the normalized bill participation key and returns either:
   - success: prize result
   - already claimed: prior prize + claim ID
   - validation error
   - unavailable prize / API issue
8. A short anticipation transition runs, then festive gift box reveal runs from the returned backend result.
9. Success state displays:
   - Congratulations
   - prize name
   - claim ID
   - guidance to show result at the Dutta Brothers counter
10. Customer may retry only in valid failure states; no repeated prize generation is allowed.

Canonical staged journey:

`LANDING -> FORM -> ANTICIPATION -> BOX_REVEAL -> RESULT`

### Admin flow

1. Admin opens `/admin` directly.
2. Operational data auto-loads on page open.
3. Admin configures campaign date range and confirms status.
4. Admin reviews prize summary totals.
5. Admin manages prize weight and active/inactive state.
6. Admin filters/searches claims and views paginated results.
7. Admin exports claims CSV with approved masked fields.

Admin V1 has no login, token entry, session, or identity bootstrap.

## 2. Page hierarchy

### Customer page

- Landing section
  - Short campaign headline
  - Short reward promise message
  - Dominant CTA
  - Minimal supporting copy
- Form section/card
  - Name field
  - Mobile Number field
  - Bill Number field
  - Primary CTA: Check & Reveal (or approved equivalent)
  - Optional small festive gift motif near CTA
- Anticipation state
  - Short verification transition copy
- Reveal panel (dedicated state)
  - festive gift box hero
  - tap-to-open animation surface
  - no prize content before authoritative backend response
- Result panel (dedicated state)
  - winner state
  - prize visual hero
  - claim ID
  - instruction text

### Admin operations page

- Campaign Configuration
- Prize Summary
- Prize Management
- Claims

No separate dashboard landing screen is used in V1.

## 3. Component hierarchy

### Customer experience

- AppShell
  - BrandHeader
  - CampaignIntro
  - LandingSection
  - FormSection
    - TextInput (Name)
    - PhoneInput (Mobile Number)
    - TextInput (Bill Number)
    - PrimaryButton (Check & Reveal or approved equivalent)
  - AnticipationState
  - RevealSection
    - GiftBoxReveal
    - ResultOverlay
  - ResultCard
    - SuccessState
    - AlreadyClaimedState
    - ErrorState
    - RetryAction
  - StatusMessage

### Admin operations page

- AdminPageShell
  - CampaignConfigSection
  - PrizeSummarySection
  - PrizeManagementSection
    - PrizeListItem
    - PrizeStatusBadge
    - WeightEditor
    - ToggleActive
  - ClaimsSection
    - SearchFilterBar
    - ClaimsTableOrCards
    - PaginationControls

## 4. Visual design direction

### Design intention

The design should feel premium, celebratory, and trustworthy, grounded in a festive Indian retail campaign. It must not look like a gaming app or casino landing page.

### Mood and tone

- premium and elegant
- festive but controlled
- warm and welcoming
- celebratory without being loud
- modern electronics retail branding
- subtle cultural influences without overt religious imagery

### Visual references

Use these as guiding motifs rather than heavy illustration:
- alpana-inspired pattern accents
- lotus geometry in small decorative elements
- diya-inspired warm glow accents
- ornamental border details in gold
- subtle maroon and saffron layering

### Overall aesthetic

- Deep crimson, maroon, ivory, antique gold, saffron accents
- Restrained cool-blue technology accent for modern electronics feel
- Carefully controlled negative space
- Balanced, tidy layout with premium margins
- Focus on readability and trustworthiness
- Gentle festive glow rather than bright neon or gaming color fields
- Festive effects concentrated in reveal and result states

### Visual guardrails

- Avoid generic lottery appearance
- Avoid children's-game aesthetic
- Avoid decorative clutter
- Avoid excessive gradients
- Keep ornament restrained and purposeful

## 5. Responsive rules

### Mobile-first approach

Target sizes:
- 360px
- 375px
- 390px
- 430px

### Layout principles

- Single-column layout for all core flows
- No horizontal scrolling at any viewport size
- Maintain comfortable tap targets with a minimum touch size of 44x44 px
- Keep the reveal area within a safe visual frame to avoid clipping on small screens
- Use progressive disclosure where information density is high
- Prioritize form and result content before secondary info

### Spacing rules

- Base spacing unit: 4px
- Use 8, 12, 16, 20, 24, 32, 40 spacing rhythm
- Increase spacing between major sections on larger mobile widths only
- Keep vertical scroll compact but not cramped

### Text rules

- Body text minimum 16px
- Input text minimum 16px to avoid mobile zoom
- Headings should read clearly without excessive line length
- Max content width for forms should stay readable and contained

### Reveal rules

- The gift box reveal must remain legible at small mobile sizes
- Prize/result text must be readable without depending on animation detail
- Keep the reveal surface clear and uncluttered
- Avoid decorative elements that dominate the result content

## 6. Interaction states

### 1. Initial

- Landing-first: short campaign headline and short reward promise
- One dominant CTA to continue into form
- Minimal copy and clear visual hierarchy

### 2. Form

- Compact form fields with minimal helper text
- Full gift box hero is not shown on form screen
- Optional small festive gift motif near primary CTA
- CTA remains thumb-reachable on target mobile widths

### 3. Validation error

- Inline validation under each field
- Clear, immediate messages
- Keep the form stable; do not move layout unexpectedly
- Highlight only the invalid field and the CTA area if needed
- Ensure color contrast meets accessibility requirements

### 4. Checking eligibility

- Disable the CTA while request is in flight
- Keep the reveal area idle and calm; no random motion
- Maintain user trust with a clear explanation

### 5. Anticipation

- Provide a short transition (~0.8-1.2s under normal motion)
- Communicate backend verification clearly
- Do not imply client-side prize selection

### 6. Reveal

- Trigger the gift box reveal only after backend confirmation of prize selection
- Use a smooth sequence: pre-draw anticipation, tap response, glow increase, lid open, light, celebration, prize reveal
- Do not use arbitrary or random sequences unrelated to the winning result

### 7. Successful win

- Reveal a premium celebratory result card
- Show:
  - Congratulations
  - prize name
  - claim ID
  - instruction to show the result at the Dutta Brothers counter
- Use subtle festive accents only; no heavy confetti overload

### 8. Already claimed

- Clearly state that the bill has already been used
- Show the original prize and original claim ID
- Keep the tone informative and reassuring, not punitive
- Do not imply a second prize or additional win

### 9. API / network error

- Use an error alert with a calm, trustworthy tone
- Provide a simple recovery action
- Avoid vague or alarming language
- Keep the user in the same flow with clear next steps

### 10. Retry

- Offer a single, obvious retry action after a recoverable error
- Keep recovery minimal and context-aware
- Maintain state clarity so the user understands what happened

### 11. Prize unavailable

- Show a non-judgmental message explaining that no prize is currently available for this cycle or eligibility slot
- Offer a clear next action if applicable
- Avoid making the user feel that the campaign is broken

## 7. Accessibility requirements

### Core requirements

- Minimum color contrast ratio meets WCAG AA for text and controls
- Keyboard navigation supported for all interactive elements
- Visible focus state for links, buttons, inputs, filters, and toggles
- Semantic form labels for every field
- Error states announced accessibly by screen readers
- No reliance on color alone to communicate status
- Reveal result must still be understandable using screen-reader-friendly text alternatives
- Semantic announcements for state transitions and reveal-result completion
- Focus management when entering result state

### Form accessibility

- Labels associated with each field
- Clear input help text for phone and bill number
- Error text placed near the relevant field
- Input types should match intent where possible
- Auto-fill support should be considered for mobile devices

### Motion and cognitive load

- Respect reduced motion preferences
- Keep animation duration elegant and not overly stimulating
- Avoid flashing or distracting motion patterns
- Ensure the reveal animation does not become a visual distraction from the actual result

### Admin accessibility

- Table headings must be clear and labeled
- Search and filter controls must be keyboard accessible
- Pagination controls must support keyboard navigation
- Status badges must have adequate contrast and descriptive text

## 8. Design-system tokens

### Color palette

- Crimson 900: #5B0B1A
- Maroon 700: #7A1F2D
- Saffron 500: #D98A2B
- Antique Gold 400: #C8A15A
- Warm Ivory: #F8F2E8
- Cream 200: #F3E8D8
- Deep Plum: #4C2B4C
- Rosewood Accent: #8B3A4B
- Charcoal Text: #1E1A1A
- Soft Muted Gray: #6A5A5A
- Success Green: #2E7D5D
- Warning Amber: #C77A1F
- Error Red: #A63A3A

### Typography

- Display Heading: premium serif or high-contrast elegant display family
- UI / Body: modern sans-serif, highly legible and clean
- Use a minimal font pair only

Suggested hierarchy:
- H1: 32–40px, weight 700, tight tracking for campaign title
- H2: 24–28px, weight 600
- H3: 20–22px, weight 600
- Body: 16px, weight 400
- Small label: 12–14px, weight 500

### Spacing scale

- 4, 8, 12, 16, 20, 24, 32, 40, 48, 64

### Border radius

- Input radius: 12–16px
- Cards: 18–24px
- Buttons: 12–18px
- Badges: 999px for pill-style status indicators

### Shadows

- Soft elevation: subtle, warm, low-contrast shadow
- Card shadow: 0 10px 24px rgba(91, 11, 26, 0.08)
- Input focus ring: crisp gold or maroon emphasis

### Buttons

Primary button
- Fill: deep maroon or crimson
- Text: ivory
- Large tappable height: 52–56px
- Strong emphasis with subtle shadow
- Hover/focus/pressed states clearly distinguished

Secondary button
- Minimal fill or outlined style
- For less critical actions

### Inputs

- Cream or ivory background
- Maroon border on focus
- Clear label and placeholder styling
- Validation states clearly visible with error color and border treatment

### Cards

- White or warm ivory surfaces
- Soft rounded corners
- Subtle inner border or shadow
- Premium but clean framing

### Alerts

- Error: warm red/rosewood tones with clear messaging
- Success: deep green or supportive warm green with celebratory but restrained style
- Info: muted gold/ivory treatment

### Tables

- Clean rows with minimal division lines
- Strong column labels
- Masked phone numbers by default
- Highlight rows only when necessary
- Ensure mobile tables degrade gracefully or collapse into card-based rows if needed

### Badges

- Use for prize, status, and winner states
- Minimal size, strong contrast, muted sophistication
- Example states: Active, Inactive, Won, Claimed, Pending

### Loading states

- Subtle spinner or skeleton treatment
- Calm, premium motion
- Avoid aggressive gaming-style loading animations

## 9. Design principles for implementation

- Keep the customer page focused and premium.
- Use the gift box reveal as a celebratory presentation, not as a game mechanic.
- Make the CTA singular and obvious.
- Maintain trust by separating visual celebration from backend truth.
- Keep admin practical and data-first.
- Preserve meaning and clarity over decorative complexity.
- Favor elegance and accessibility over noise and novelty.

## 10. Summary

This design direction supports a festive, premium campaign experience for Dutta Brothers while staying true to the business and technical constraints. The customer experience should feel celebratory and modern, but the system must remain trustworthy, readable, and securely governed by backend logic. The admin experience should be efficient and operational rather than ornamental.
