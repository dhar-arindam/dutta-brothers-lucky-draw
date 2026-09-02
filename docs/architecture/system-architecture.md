# System Architecture and Flows

Visual reference for the **implemented** system. Every diagram is derived from the source
in `frontend/`, `backend/` and `infrastructure/`.

Product behaviour remains defined by `/docs/specs`. If a diagram here ever contradicts an approved
specification, the specification wins and this document must be corrected.

## Contents

1. [System context](#1-system-context)
2. [Deployed AWS architecture](#2-deployed-aws-architecture)
3. [Backend module structure](#3-backend-module-structure)
4. [Customer draw flow](#4-customer-draw-flow)
5. [Draw decision logic](#5-draw-decision-logic)
6. [Atomic claim persistence and retry](#6-atomic-claim-persistence-and-retry)
7. [Frontend UI state machine](#7-frontend-ui-state-machine)
8. [Envelope reveal state machine](#8-envelope-reveal-state-machine)
9. [Admin flows](#9-admin-flows)
10. [DynamoDB single-table design](#10-dynamodb-single-table-design)
11. [CI and deployment pipeline](#11-ci-and-deployment-pipeline)
12. [Local quality gate](#12-local-quality-gate)

---

## 1. System context

Who uses the system and what it talks to. The backend is authoritative for every
business-critical decision; the browser is never trusted for prize selection, claim IDs,
eligibility or duplicate prevention.

```mermaid
graph LR
    Customer["Customer<br/>mobile browser"]
    Admin["Store admin<br/>desktop browser"]

    subgraph App["Dutta Brothers Festive Lucky Draw"]
        FE["React SPA<br/>S3 + CloudFront"]
        BE["REST API<br/>API Gateway + Lambda"]
        DB[("DynamoDB<br/>DrawsTable")]
    end

    Logs["CloudWatch<br/>logs and metrics"]

    Customer -->|"submit name, phone, bill"| FE
    Admin -->|"manage prizes, claims, campaign"| FE
    FE -->|"HTTPS /api/*"| BE
    BE --> DB
    BE --> Logs
```

---

## 2. Deployed AWS architecture

Defined in `infrastructure/lib/foundation-stack.ts`. One stack per stage:
`DuttaDrawFoundationStackDev`, `...Staging`, `...Prod`.

```mermaid
graph TB
    Browser["Browser"]

    subgraph Stack["DuttaDrawFoundationStack{Dev|Staging|Prod}"]
        CF["FrontendDistribution<br/>CloudFront<br/>redirect-to-https"]
        Fn["SPA rewrite<br/>CloudFront Function"]
        S3[("FrontendBucket<br/>private S3 + OAC")]
        API["HttpApi<br/>API Gateway v2<br/>$default stage"]
        Lambda["ApiFunction<br/>Node.js 22, 512 MB, 10 s"]
        DDB[("DrawsTable<br/>pk / sk + gsi1<br/>PAY_PER_REQUEST")]
        LGApi["API access log group"]
        LGFn["Lambda log group"]
    end

    Browser -->|"GET /"| CF
    Browser -->|"/api/*"| CF
    CF --> Fn
    Fn -->|"extensionless URI to /index.html"| S3
    CF -->|"default behaviour<br/>cache disabled"| S3
    CF -->|"/api/* behaviour<br/>cache disabled, https-only"| API
    API -->|"ANY /api/{proxy+}"| Lambda
    Lambda -->|"grantReadWriteData"| DDB
    API --> LGApi
    Lambda --> LGFn
```

Stage-dependent settings, resolved from CDK context:

| Setting                         | Dev       | Staging   | Production             |
| ------------------------------- | --------- | --------- | ---------------------- |
| `apiThrottleRateLimit`          | 25        | 75        | 150                    |
| `apiThrottleBurstLimit`         | 50        | 150       | 300                    |
| Removal policy                  | `DESTROY` | `DESTROY` | `RETAIN`               |
| DynamoDB point-in-time recovery | off       | off       | on                     |
| `frontendOrigin` context        | required  | required  | required, no localhost |

CORS is restricted to the single configured frontend origin, allowing only
`content-type` and `idempotency-key` headers.

---

## 3. Backend module structure

The same route table and business logic serve both runtimes. `APP_RUNTIME` selects the
store implementation, so local development never touches AWS.

```mermaid
graph TB
    LambdaEntry["lambda.ts<br/>handler<br/>APP_RUNTIME=PRODUCTION"]
    NodeEntry["main.ts / app.ts<br/>createNodeHandler<br/>APP_RUNTIME=LOCAL"]

    Size["request-size-policy.ts<br/>32 KB UTF-8 limit"]
    Router["Route dispatch<br/>method + path"]

    subgraph Domain["Business logic"]
        Draw["draw-service.ts"]
        Valid["validation.ts<br/>normalization.ts"]
        Camp["campaign.ts"]
        Sel["prize-selection.ts"]
        ClaimId["claim-id.ts"]
    end

    subgraph Persistence["Store abstraction"]
        Mem["store.ts<br/>InMemoryDrawStore"]
        Dyn["durable-dynamodb-store.ts<br/>DynamoDbDrawStore"]
        Retry["dynamodb-retry.ts"]
    end

    DDB[("DynamoDB")]

    LambdaEntry --> Size
    NodeEntry --> Size
    Size --> Router
    Router --> Draw
    Router -->|"admin routes"| Persistence
    Draw --> Valid
    Draw --> Camp
    Draw --> Sel
    Draw --> ClaimId
    Draw --> Persistence
    LambdaEntry -.->|"selects"| Dyn
    NodeEntry -.->|"selects"| Mem
    Dyn --> Retry
    Retry --> DDB
```

---

## 4. Customer draw flow

Happy path for `POST /api/draw`, from tap to revealed prize.

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant UI as React SPA
    participant CF as CloudFront
    participant API as API Gateway
    participant L as ApiFunction
    participant S as DrawService
    participant D as DynamoDB

    C->>UI: Enter name, phone, bill number
    UI->>UI: Client-side validation
    Note over UI: Invalid input never reaches the API
    UI->>UI: uiState = CHECKING_ELIGIBILITY
    UI->>CF: POST /api/draw + idempotency-key
    CF->>API: forward /api/* behaviour
    API->>L: ANY /api/{proxy+}
    L->>L: Enforce 32 KB body limit
    L->>L: Parse JSON, check field types
    L->>S: execute(request)
    S->>S: Validate and normalise fields
    S->>D: getCampaign()
    D-->>S: campaign config
    S->>S: isCampaignActive(now)
    S->>D: listEligiblePrizesForDraw()
    D-->>S: active prizes with weight > 0
    S->>S: selectWeightedPrize(random)
    S->>S: claimIdGenerator.next() -> DB26-######
    S->>D: TransactWrite: BILL + CLAIM + 3 aggregates
    D-->>S: CREATED
    S-->>L: 201 SUCCESS + prize + wheel.sectorPrizeIds
    L-->>API: JSON response
    API-->>CF: JSON response
    CF-->>UI: 201 SUCCESS
    UI->>UI: revealModalState = ANTICIPATION
    UI->>C: Play reveal, then show prize and claim ID
```

The API returns the prize the backend already committed. The reveal animation is
presentation only and always renders the response it was given.

---

## 5. Draw decision logic

Every branch and response the draw endpoint can produce, in evaluation order
(`request-size-policy.ts`, `lambda.ts`, `draw-service.ts`).

```mermaid
flowchart TD
    Start(["POST /api/draw"]) --> Size{"Body <= 32 KB?"}
    Size -->|No| E413["413 REQUEST_TOO_LARGE"]
    Size -->|Yes| Shape{"name, phone, billNumber<br/>all strings?"}
    Shape -->|No| E400
    Shape -->|Yes| Valid{"Field rules pass?<br/>name 1-100<br/>phone exactly 10 digits<br/>bill 1-50"}
    Valid -->|No| E400["400 VALIDATION_ERROR<br/>+ fieldErrors"]
    Valid -->|Yes| Camp{"Campaign active<br/>for now in Asia/Kolkata?"}
    Camp -->|No| E409A["409 DRAW_ENDED"]
    Camp -->|Yes| Prize{"Any prize with<br/>active = true and weight > 0?"}
    Prize -->|No| E409B["409 NO_ELIGIBLE_PRIZE"]
    Prize -->|Yes| Select["Weighted random selection<br/>over eligible prizes"]
    Select --> Persist["Atomic write:<br/>BILL uniqueness + CLAIM + aggregates"]
    Persist --> Result{"Write outcome"}
    Result -->|EXISTS| E200["200 ALREADY_CLAIMED<br/>returns the original claim"]
    Result -->|CREATED| E201["201 SUCCESS<br/>claimId, prize, wheel"]
    Result -->|Unrecoverable| E500["500 INTERNAL_ERROR"]
```

Duplicate detection keys on the **normalised bill number** (trimmed and uppercased), so
casing and padding differences cannot produce a second claim for the same bill.

---

## 6. Atomic claim persistence and retry

`DynamoDbDrawStore.createClaimAndUpdateAggregatesAtomic` writes five items in a single
`TransactWriteItems` call. Only the first two carry conditions, which is what makes a
cancellation unambiguously classifiable.

```mermaid
flowchart TD
    Build["Build transaction items"] --> Items

    subgraph Items["TransactWriteItems"]
        I0["0 Put BILL / billNumberNormalized<br/>condition: attribute_not_exists"]
        I1["1 Put CLAIM / claimId<br/>condition: attribute_not_exists"]
        I2["2 Update AGG / TOTAL"]
        I3["3 Update AGG / DATE#yyyy-mm-dd"]
        I4["4 Update AGG / PRIZE#prizeId"]
    end

    Items --> Send["Send transaction"]
    Send --> Ok{"Succeeded?"}
    Ok -->|Yes| Created["Return CREATED"]
    Ok -->|"TransactionCanceledException"| Classify["classifyTransactionCancellation<br/>inspect reasons for items 0 and 1"]

    Classify -->|DUPLICATE| Fetch["Read the existing CLAIM"]
    Fetch --> Exists["Return EXISTS<br/>drives 200 ALREADY_CLAIMED"]

    Classify -->|TRANSIENT| Attempts{"Attempt < 4?"}
    Attempts -->|Yes| Backoff["Full-jitter backoff<br/>random * min 400 ms, 25 ms * 2^n"]
    Backoff --> Send
    Attempts -->|No| Fail["Throw<br/>drives 500 INTERNAL_ERROR"]

    Classify -->|PERMANENT| Fail
```

A conditional-check failure on the BILL or CLAIM item means a genuine duplicate.
A transaction conflict or throttle is transient and is retried. Anything else fails fast.

---

## 7. Frontend UI state machine

`UiState` in `frontend/src/App.tsx`. This governs which screen is shown and whether the
submit button is enabled.

```mermaid
stateDiagram-v2
    [*] --> LANDING
    LANDING --> FORM: start the draw

    FORM --> VALIDATING: submit
    VALIDATING --> FORM: field errors
    VALIDATING --> CHECKING_ELIGIBILITY: input valid

    CHECKING_ELIGIBILITY --> FORM: 201 SUCCESS<br/>hands off to reveal
    CHECKING_ELIGIBILITY --> ALREADY_CLAIMED: 200
    CHECKING_ELIGIBILITY --> DRAW_ENDED: 409
    CHECKING_ELIGIBILITY --> NO_ELIGIBLE_PRIZE: 409
    CHECKING_ELIGIBILITY --> API_ERROR: 4xx or 5xx
    CHECKING_ELIGIBILITY --> NETWORK_ERROR: timeout after 8 s

    API_ERROR --> RETRY: retry
    NETWORK_ERROR --> RETRY: retry
    RETRY --> CHECKING_ELIGIBILITY: resend with the same idempotency-key

    ALREADY_CLAIMED --> [*]
    DRAW_ENDED --> [*]
    NO_ELIGIBLE_PRIZE --> [*]

    note right of DRAW_ENDED
        Submit stays disabled.
        Retrying cannot help.
    end note

    note right of CHECKING_ELIGIBILITY
        Submit disabled while
        CHECKING_ELIGIBILITY or RETRY.
    end note
```

---

## 8. Envelope reveal state machine

`RevealModalState` plus the presentation phases in `frontend/src/App.tsx`. Timings collapse
when the browser reports `prefers-reduced-motion: reduce`.

```mermaid
stateDiagram-v2
    [*] --> HIDDEN
    HIDDEN --> ANTICIPATION: 201 SUCCESS stored as pendingSuccessResponse

    state ANTICIPATION {
        [*] --> Waiting
        Waiting --> [*]: 1000 ms, or 130 ms reduced motion
    }

    ANTICIPATION --> BOX_REVEAL

    state BOX_REVEAL {
        [*] --> BOX_IDLE
        BOX_IDLE --> BOX_OPENING: customer taps the gift box
        BOX_OPENING --> CELEBRATION: 900 ms, or 320 ms reduced motion
        CELEBRATION --> RESULT_ENTERING: 260 ms
        note right of BOX_OPENING
            7-frame sequence
            at 95 ms per frame
        end note
    }

    BOX_REVEAL --> RESULT: 620 ms, or 120 ms reduced motion
    RESULT --> HIDDEN: dismiss
    RESULT --> [*]
```

The reveal never decides the prize. It renders `pendingSuccessResponse`, so the animation
and the persisted claim can never disagree.

---

## 9. Admin flows

Admin V1 has no token authentication; access is controlled by keeping the route private
(see `docs/architecture/ADR-004-private-admin-v1.md`).

### Dashboard load and claims paging

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    participant UI as AdminPrizePage
    participant API as REST API
    participant D as DynamoDB

    A->>UI: Open admin page
    UI->>UI: busyAction = INITIAL
    par Initial load
        UI->>API: GET /api/admin/summary
        API->>D: read AGG TOTAL, DATE#today, PRIZE#*
        D-->>API: counters
        API-->>UI: totals, today, prizeDistribution
    and
        UI->>API: GET /api/admin/prizes
        API-->>UI: prizes with weight, active, givenCount
    and
        UI->>API: GET /api/admin/campaign
        API-->>UI: campaign + ACTIVE or ENDED
    and
        UI->>API: GET /api/admin/claims?pageSize=...
        API->>D: query pk=CLAIM via gsi1, newest first
        API-->>UI: items + nextPageToken
    end
    UI->>UI: busyAction = NONE

    A->>UI: Scroll to the sentinel
    UI->>API: GET /api/admin/claims?pageToken=...
    API-->>UI: next page + nextPageToken
    Note over UI: Phone numbers arrive masked.<br/>CSV export is the only unmasked path.
```

### Prize and campaign administration

```mermaid
flowchart LR
    subgraph Prizes["Prize configuration"]
        P1["GET /api/admin/prizes"]
        P2["POST /api/admin/prizes<br/>name, weight, active"]
        P3["PATCH /api/admin/prizes/{prizeId}<br/>weight and/or active"]
    end

    subgraph Claims["Claims"]
        C1["GET /api/admin/claims<br/>search, prizeId, from, to, paging"]
        C2["GET /api/admin/claims.csv"]
        C3["DELETE /api/admin/claims/{claimId}"]
        C4["DELETE /api/admin/claims<br/>clear all"]
    end

    subgraph Campaign["Campaign window"]
        M1["GET /api/admin/campaign"]
        M2["PATCH /api/admin/campaign<br/>fromDate, toDate as yyyy-mm-dd"]
    end

    P2 --> Effect1["Changes future weighted selection only"]
    P3 --> Effect1
    C3 --> Effect2["Cascades: removes BILL uniqueness<br/>and decrements aggregates"]
    C4 --> Effect2
    M2 --> Effect3["Outside the window every draw<br/>returns 409 DRAW_ENDED"]
```

Prize edits never rewrite history: each claim stores its own snapshot of the prize name.

---

## 10. DynamoDB single-table design

One table, `DrawsTable`, with `pk` / `sk` and a single GSI `gsi1` for
timestamp-ordered claim listing.

```mermaid
graph TB
    Table["DrawsTable<br/>partition key: pk &nbsp; sort key: sk<br/>GSI gsi1: gsi1pk / gsi1sk"]

    Table --> Bill
    Table --> Claim
    Table --> Prize
    Table --> Agg
    Table --> Camp

    Bill["<b>BILL</b> &mdash; uniqueness guard<br/>pk = BILL<br/>sk = billNumberNormalized<br/>claimId, createdAt"]
    Claim["<b>CLAIM</b> &mdash; immutable record<br/>pk = CLAIM<br/>sk = claimId, DB26-######<br/>claimTimestamp, customerName, phone,<br/>billNumberDisplay, billNumberNormalized,<br/>prize snapshot<br/>gsi1pk = CLAIM, gsi1sk = timestamp#claimId"]
    Prize["<b>PRIZE</b> &mdash; configuration<br/>pk = PRIZE<br/>sk = prizeId, prize-###<br/>name, displayName, weight, active"]
    Agg["<b>AGG</b> &mdash; counters<br/>pk = AGG<br/>sk = TOTAL<br/>sk = DATE#yyyy-mm-dd<br/>sk = PRIZE#prizeId"]
    Camp["<b>CAMPAIGN</b> &mdash; single config item<br/>pk = CAMPAIGN<br/>sk = CONFIG<br/>timezone, fromDate, toDate"]

    Bill -. "one bill maps to one claim" .- Claim
    Prize -. "snapshotted into" .- Claim
    Claim -. "increments in the same transaction" .- Agg
    Camp -. "gates claim creation" .- Claim
```

| Access pattern             | Operation                              |
| -------------------------- | -------------------------------------- |
| Has this bill been used?   | `Get pk=BILL, sk=billNumberNormalized` |
| Create a claim atomically  | `TransactWrite` over 5 items           |
| Fetch one claim            | `Get pk=CLAIM, sk=claimId`             |
| List claims, newest first  | `Query gsi1 pk=CLAIM`                  |
| Eligible prizes for a draw | `Query pk=PRIZE`, filter in memory     |
| Dashboard totals           | `Get pk=AGG, sk=TOTAL`                 |
| Today's spins              | `Get pk=AGG, sk=DATE#today`            |
| Prize distribution         | `Query pk=AGG, sk begins_with PRIZE#`  |
| Campaign window            | `Get pk=CAMPAIGN, sk=CONFIG`           |

Counters are maintained transactionally with the claim, so reporting never scans the table.

---

## 11. CI and deployment pipeline

```mermaid
flowchart TD
    PR["Pull request or push to main"] --> DepRev["dependency-review<br/>fails on high severity"]
    PR --> QG

    subgraph QG["quality-gate job"]
        direction TB
        Q1["npm ci"] --> Q2["build frontend"]
        Q2 --> Q3["lint"]
        Q3 --> Q4["format:check"]
        Q4 --> Q5["typecheck"]
        Q5 --> Q6["test"]
        Q6 --> Q7["test:coverage thresholds"]
        Q7 --> Q8["build backend, infra, shared"]
        Q8 --> Q9["cdk synth dev"]
        Q9 --> Q10["upload validated-source artifact"]
    end

    QG --> Merge["Merge to main"]

    Dispatch(["workflow_dispatch"]) --> Deploy

    subgraph Deploy["deploy-staging / deploy-production"]
        direction TB
        D1["Re-run the quality gate"] --> D2["Assume OIDC role<br/>ap-south-1"]
        D2 --> D3["cdk synth for the stage"]
        D3 --> D4["cdk deploy"]
        D4 --> D5["Smoke tests"]
    end

    D5 --> Approve{"Production<br/>environment approval"}
    Approve -->|approved| Prod["Deploy DuttaDrawFoundationStackProd"]
    Prod --> Smoke["Production smoke tests"]
```

Deployment is manual by design. No workflow deploys on merge.

---

## 12. Local quality gate

Husky hooks mirror CI so failures surface before a pull request exists. They do not replace
CI, which remains authoritative.

```mermaid
flowchart LR
    Edit["Edit files"] --> Commit["git commit"]

    subgraph PreCommit["pre-commit"]
        direction TB
        L1["lint-staged<br/>prettier --write"] --> L2["eslint --fix<br/>per workspace config"]
        L2 --> L3["npm run typecheck"]
    end

    Commit --> PreCommit
    PreCommit -->|fails| Fix["Fix and re-commit"]
    PreCommit -->|passes| Msg

    subgraph Msg["commit-msg"]
        M1["Conventional Commits header<br/>type or type scope colon subject"]
    end

    Msg -->|fails| Fix
    Msg -->|passes| Push["git push"]

    subgraph PrePush["pre-push"]
        direction TB
        P1["npm run lint"] --> P2["npm run build"]
        P2 --> P3["npm test"]
    end

    Push --> PrePush
    PrePush -->|fails| Fix
    PrePush -->|passes| CI["GitHub Actions quality gate"]
```
