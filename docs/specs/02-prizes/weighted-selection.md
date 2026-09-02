# Weighted Prize Selection

Status: APPROVED  
Owner: Principal Software Engineer  
Version: 1.2  
Last Updated: 2026-08-19
Change: Final Admin V1 consolidation  
Reason: Approved source-of-truth alignment across specs

## Purpose

The backend selects one eligible prize using relative weights.

## Algorithm Concept

Given:

- Prize A = 40
- Prize B = 20
- Prize C = 10

Total weight = 70.

The probability of selecting a prize is:

```
Prize weight / total active weight
```

The ratio is 40:20:10. Weights are not percentages and do not need to total 100.

Admin-facing weight entry should include explanatory text that weight is a relative value. Example: weight 10 has twice the relative draw weight of weight 5.

## Eligibility

Only prizes that are both active and have a positive weight are eligible.

For V1, a prize configuration must satisfy:

- `weight` accepts numeric values only.
- `weight` is a positive number.
- Negative weight is invalid.
- Zero weight is invalid for an active prize and is never eligible for selection.
- Invalid configuration must be rejected when a prize is created or updated.

If invalid data exists because of corruption or an unavailable configuration update, the draw must fail safely with `INTERNAL_ERROR`. It must never silently select an invalid prize and must never invent a fallback prize. `NO_ELIGIBLE_PRIZE` is reserved for a valid configuration with no active, positive-weight prizes.

The frontend must never calculate or determine the winner.

## Edge Cases

- **Zero active prizes:** return NO_ELIGIBLE_PRIZE.
- **All active weights zero:** reject the configuration; if such data exists at draw time, return INTERNAL_ERROR.
- **Negative weights:** reject invalid prize configuration; do not select a prize.
- **Inactive prizes:** exclude from selection.
- **One active prize with positive weight:** select that prize.

No fallback prize is permitted when there are no eligible prizes.

## Requirements

- Selection is performed by the backend.
- Selection uses the configured relative weights.
- Selection is based only on the eligible prize set at draw time.
- The selected prize is persisted with the claim.
- The implementation must be testable without prescribing a specific random-number implementation in this specification.

## Configuration Behaviour

- Given a newly added active prize with a positive weight, future draws include it in the eligible set.
- Given an existing active prize whose weight changes, future selections use the new weight.
- Historical claims are not changed by a later weight change.
- Given a deactivated prize, future draws exclude it.
- Given a reactivated prize with a valid positive weight, future draws include it.
- Given an administrator attempts to configure zero or negative weight, the configuration update is rejected.
