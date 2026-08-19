# Frontend Specification Reconciliation - 2026-08-19

Status: Draft for Principal Engineer review
Scope: Frontend/Admin V1 specification reconciliation before coverage and CI hardening

## Discrepancy Matrix

| Area | Existing Spec | Current Implementation | Status | Recommended Action |
|---|---|---|---|---|
| Admin route access | Direct `/admin` no auth | Direct `/admin` no auth/token/session/login | MATCH | No change |
| Admin page structure | Campaign -> Summary -> Prize Management -> Claims | Same order implemented | MATCH | No change |
| Tailwind isolation | Admin-only, customer unaffected | Admin imports Tailwind utility layer; preflight disabled; customer uses existing stylesheet | MATCH | Keep constraint and document implementation isolation details |
| Campaign configuration | Date-only, no time fields, Asia/Kolkata semantics | Date-only controls (`type="date"`), validation, status card, timezone text shown | MATCH | No change |
| Prize management controls | Add prize, weight, active toggle, immutable name | Implemented as specified with helper text and validation | MATCH | No change |
| Prize filtering interaction | Prize shortcut to claims filtering; all-prizes default supported | Current implementation uses `View Claims` action + claims `Prize` dropdown + clear filters | IMPLEMENTATION CHANGED | Product decision approved: prize card itself must be clickable filter in V1 docs/tests; implementation update required in separate code task |
| Selected prize visual state | Persistent selected-state card styling required | Current implementation has no persistent selected-card visual state | IMPLEMENTATION CHANGED | Product decision approved: selected-card visual state is mandatory in V1 docs/tests; implementation update required in separate code task |
| Claims date filters | Date filtering supported | Date-only controls for claims filters; frontend maps to UTC day boundaries for API `from`/`to` | IMPLEMENTATION CHANGED | Update API/Admin specs to explicitly describe date-only UI + timestamp mapping |
| Loading and partial failure | Auto-load expected | Initial load is all-or-error (single retryable error state), action-specific loading labels | NEW BEHAVIOUR | Document all-or-error initial load and operation-specific loading states |
| Empty states | Empty states expected | Distinct empty messages for no claims, filtered empty, prize-filter empty | MATCH | Keep and explicitly enumerate messages |
| Claims responsive rendering | Mobile usability required | Desktop table + mobile claim cards (`sm:hidden`), pagination controls preserved | MATCH | No change |
| Accessibility baseline | Labels/keyboard/announcements required | Labeled controls, `aria-live` status, `role=alert`, keyboard-operable buttons/toggles | MATCH | Keep; consider adding explicit acceptance checks for async announcements |
| Customer UI isolation | Customer UI must remain non-Tailwind and unchanged | Customer route still renders `App` + existing `styles.css`; admin styles scoped by route component | MATCH | No change |

## Notes

- Repository does not currently provide meaningful git diff history in this workspace state; reconciliation was performed by direct implementation inspection.
- Product decision approved (2026-08-19): prize card itself is the primary claims filter interaction; separate prominent `View Claims` action is de-emphasized/replaced in V1 requirements.
