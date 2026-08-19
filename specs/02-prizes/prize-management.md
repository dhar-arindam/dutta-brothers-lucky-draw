# Prize Management

Status: APPROVED  
Owner: Principal Software Engineer  
Version: 1.3  
Last Updated: 2026-08-19
Change: Final Admin V1 consolidation  
Reason: Approved source-of-truth alignment across specs

## Prize Properties

Each prize has:

- ID
- Name
- Relative weight
- Active status
- Created timestamp
- Updated timestamp

Prize properties do not include inventory, quantity, stock, or depletion fields.

## Admin Capabilities

Prize creation UX must remain intentionally simple.

Required prize creation fields:

1. Prize Name
2. Weight
3. Active/Inactive toggle

Weight guidance text must explain that weight is relative (not a percentage), with a simple ratio example.

The admin can:

- Add a new prize
- Set the initial active status of a new prize
- Change the weight of an existing prize
- Activate or deactivate a prize
- View all configured prizes, including inactive prizes
- View `Given` count per prize

Inactive prizes must remain visible in the prize management view and must not be hidden by default.

The admin cannot:

- Modify historical claims
- Delete claims
- Change the prize awarded to a customer
- Rename an existing prize
- Change the identity of a historical prize in a way that changes historical claims
- Manage prize inventory

Prize names are immutable once created. Prize identity is fixed after creation and must be enforced by the backend.

## Historical Claims

A claim must preserve the prize name awarded at the time of the draw. Later prize configuration changes must not rewrite historical claim results.

## Validation

- Relative weight input must accept numeric values only.
- Relative weight must be a positive number.
- Zero weight is invalid for an active prize and is never eligible for selection.
- Negative weight is invalid.
- Active status must be boolean.
- An inactive prize cannot be selected.
- A zero-weight prize cannot be selected and cannot be active as an eligible prize.
- Prize identity must remain stable once referenced by a claim.

Active/inactive toggle behavior:

- Toggle changes must persist through backend validation and storage.
- On successful persistence, UI should clearly reflect the new state.
- If persistence fails, UI must keep or restore the previous state and display a clear error.

The UI must not display or communicate weight as a percentage.

Given/Awarded count definition:

- Count equals successfully persisted lucky-draw claims associated with the prize.
- Excludes failed attempts, rejected submissions, duplicate participation attempts, concurrent duplicate requests, and unsuccessful requests.
- Must not be interpreted as inventory, stock, remaining quantity, or depletion.

Activation and deactivation are required V1 capabilities. Deactivating a prize affects future draws only; historical claims remain unchanged.
