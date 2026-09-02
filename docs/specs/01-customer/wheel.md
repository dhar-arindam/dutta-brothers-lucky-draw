# Lucky Draw Wheel (Deprecated)

Status: SUPERSEDED  
Change: Wheel visualization -> Historical/Deprecated customer presentation (superseded by Festive Gift Box Reveal)  
Reason: Controlled UX change set now uses Gift Box Reveal as active customer presentation  
Backend impact: None  
API impact: None  
Owner: Principal Software Engineer  
Version: 1.2  
Last Updated: 2026-08-18

## Deprecation Notice

DEPRECATED - NOT PART OF THE ACTIVE CUSTOMER EXPERIENCE.

This file is retained for historical traceability of the previously approved wheel-based reveal model.

Active customer reveal requirements now live in [reveal.md](./reveal.md).

The backend remains authoritative for prize selection and claim creation. The frontend reveal is presentation-only.

## Purpose

The wheel is a visual representation of the prize selected by the backend. It does not determine the prize.

## Deterministic Wheel Model

At draw-result time, the backend provides the ordered wheel roster used for visualization. The roster contains the eligible prize IDs in deterministic ascending lexicographic order by immutable prize ID. The roster is a visualization input only; it does not authorize the frontend to select a prize.

Let:

- `N` be the number of prize IDs in the roster.
- `i` be the zero-based index of the winning prize ID in that roster, where `0 <= i < N`.
- Each sector have equal angular width `W = 360 / N` degrees.
- Angles be measured clockwise from the upward vertical axis.
- The fixed pointer angle be `P = 180` degrees, representing the downward direction.
- The unrotated centre angle of sector `i` be `C_i = (i + 0.5) * W` degrees.
- Positive wheel rotation be clockwise.

The frontend maps the backend-returned winning prize ID to `i`. It must not choose `i` randomly or select a prize.

For a wheel whose current visual rotation is `R_current` degrees, calculate the smallest non-negative clockwise adjustment to place the winning centre under the pointer:

```
delta = normalize(P - (C_i + R_current), 360)
```

where:

```
normalize(x, 360) = ((x % 360) + 360) % 360
```

Choose a fixed integer number of complete rotations `M`, with `M >= 3`, for the animation. The final target rotation is:

```
R_final = R_current + (M * 360) + delta
```

The animation must move clockwise from `R_current` to `R_final`. At the end, the centre of sector `i` is exactly at angle `P` modulo 360 degrees. The implementation must preserve the target rotation without introducing a random final offset.

### Mathematical Example

For six prizes ordered as:

```
i = 0: Prize A
i = 1: Prize B
i = 2: Prize C
i = 3: Prize D
i = 4: Prize E
i = 5: Prize F
```

`N = 6`, so each sector is `W = 60` degrees wide. With `R_current = 0` and `M = 3`:

| Prize | Index | Centre `C_i` | Adjustment `delta` | Final rotation `R_final` |
| ----- | ----: | -----------: | -----------------: | -----------------------: |
| A     |     0 |           30 |                150 |                     1230 |
| B     |     1 |           90 |                 90 |                     1170 |
| C     |     2 |          150 |                 30 |                     1110 |
| D     |     3 |          210 |                330 |                     1410 |
| E     |     4 |          270 |                270 |                     1350 |
| F     |     5 |          330 |                210 |                     1290 |

For example, if the backend returns Prize F, the frontend maps it to index `5`, calculates `C_5 = 330`, `delta = normalize(180 - 330, 360) = 210`, and animates to `R_final = 3 * 360 + 210 = 1290` degrees.

The formula remains valid for any `N >= 1`, any current rotation, and every configured prize in the returned roster.

## Behaviour

- Use a fixed, downward-facing pointer.
- Rotate the wheel underneath the pointer.
- The backend returns the winning prize.
- The frontend maps the winning prize ID to the corresponding roster sector.
- The winning sector must finish beneath the pointer.
- Winning text must match the backend-selected prize.
- Use smooth animation with multiple rotations and an appropriate ease-out curve.

## Visual Restrictions

The wheel must NOT display:

- Prize labels
- Prize names
- Prize icons
- Prize images

The wheel is purely a visual representation of the result. Prize information is displayed separately in the result state.

## Determinism

- The frontend must not randomly select a prize.
- Random visual rotation must not be unrelated to the selected prize.
- Sector mapping and final rotation must be deterministic and testable.
- The same backend result must always map to the corresponding configured sector.

## Responsive Behaviour

At 360px, 390px, and 430px viewport widths:

- The wheel must fit within the available content width.
- The wheel must not create horizontal scrolling or layout overflow.
- The pointer must remain fully visible and clearly visible during animation.
- The wheel must not overlap important controls, form errors, or the result area.
- The Spin button must remain usable.
- The result area must remain visible after the animation.
- Wheel sizing must be responsive rather than a fixed desktop size.

The exact CSS implementation is left to the frontend developer.

## Acceptance Criteria

- Every configured eligible prize can be mapped to exactly one sector in the deterministic roster.
- Each configured prize sector can be tested independently.
- The pointer is fixed and faces downward.
- The wheel rotates underneath the pointer.
- The final sector under the pointer matches the backend-selected prize.
- The displayed winning text matches the backend-selected prize.
- For every prize sector, the backend prize ID, frontend sector index, calculated rotation, final pointer position, and displayed prize must match.
- No prize labels, names, icons, or images appear on the wheel.
- Already claimed, draw ended, no eligible prize, and API failure states do not trigger a misleading spin.
- At 360px, 390px, and 430px, the wheel fits without overflow, the pointer remains visible, and the result area remains usable after animation.
