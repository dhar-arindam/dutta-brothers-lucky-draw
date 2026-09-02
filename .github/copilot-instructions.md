# Dutta Brothers Festive Lucky Draw

**Engineering Instructions for Spec-Driven Development**

This file is the authoritative engineering instruction for HOW the project is built.

**IMPORTANT: Specifications are the source of truth for product behaviour.**

Do not implement a feature unless an approved specification exists for that feature.

Refer to `/docs/specs` for detailed product requirements.

Refer to this file for engineering standards and practices.

## 1. Spec-Driven Development (SDD)

The project follows a Spec-Driven Development workflow:

```
SPEC → REVIEW → APPROVE → DESIGN → IMPLEMENT → TEST → REVIEW → ACCEPT
```

Rules:

1. Every significant feature must have a specification in `/docs/specs`.
2. The specification must be reviewed by the Principal Software Engineer before implementation.
3. Implementation must follow the approved specification.
4. Tests must trace back to acceptance criteria.
5. If implementation reveals an ambiguity or contradiction in the specification, stop and raise the issue with the Principal Software Engineer.
6. Do not silently reinterpret requirements to make implementation easier.
7. Do not silently change a specification to make implementation easier. If a requirement is unclear or contradictory, raise the issue before implementation.
8. If requirements change, update the specification first, then update implementation and tests.
9. Specifications must be readable by both technical and non-technical stakeholders.
10. Keep specifications and implementation separate: business requirements belong in `/docs/specs`, engineering practices belong in this file.

## 2. Technology stack

Frontend MUST use:

- React
- TypeScript

Backend MUST use:

- Node.js
- TypeScript
- REST API

Infrastructure MUST use:

- AWS CDK
- TypeScript

AWS services:

- Amazon S3
- Amazon CloudFront
- Amazon API Gateway
- AWS Lambda
- Amazon DynamoDB
- Amazon CloudWatch

Testing:

- Vitest
- React Testing Library where appropriate
- backend unit/integration tests
- AWS CDK tests where appropriate

Code quality:

- TypeScript strict mode
- ESLint
- Prettier

AWS CDK is the ONLY approved infrastructure-as-code framework for this project unless the Principal Software Engineer explicitly approves a change.

Do not use:

- AWS SAM
- Terraform
- Serverless Framework
- manually maintained CloudFormation templates

## 3. Architecture

Use a modular monolith architecture.

Do NOT introduce microservices.

Target architecture:

```text
Customer/Admin React application
        |
        | HTTPS
        v
   CloudFront
        |
        v
       S3

React
  |
  | HTTPS REST API
  v
API Gateway
  |
  v
AWS Lambda
  |
  v
DynamoDB
```

CloudWatch is used for backend logging and monitoring.

The frontend is a static React application hosted in S3 and distributed through CloudFront.

The backend is Node.js + TypeScript running in AWS Lambda.

API Gateway exposes the REST API.

DynamoDB stores claims and prize configuration.

Frontend responsibilities:

- UI
- form validation
- animations
- API communication
- client-side state
- responsive behaviour

Backend responsibilities:

- business rules
- eligibility
- prize selection
- claim creation
- claim uniqueness
- validation
- admin operations

Database responsibilities:

- claims
- prize configuration

The backend is always authoritative for business-critical operations.

The frontend must NEVER be trusted for:

- prize selection
- claim ID generation
- eligibility
- duplicate prevention

## 4. Repository structure

Use the following structure:

```text
/frontend
/backend
/shared
/infrastructure
/docs
/.github
```

Frontend:

```text
/frontend
  /src
    /components
    /pages
    /services
    /hooks
    /types
    /utils
    /assets
```

Backend:

```text
/backend
  /src
    /controllers
    /routes
    /services
    /repositories
    /validators
    /models
    /types
    /config
    /utils
```

Infrastructure:

```text
/infrastructure
  /bin
  /lib
  /test
```

Infrastructure must be implemented using AWS CDK and TypeScript.

Shared TypeScript types may be maintained under:

```text
/shared/types
```

Documentation:

```text
/docs
  /architecture
  /api
  /database
  /deployment
  /testing
```

## 5. AWS CDK RESPONSIBILITY

AWS CDK is the infrastructure-as-code source of truth.

Infrastructure should define, where required:

- S3 bucket for frontend assets
- CloudFront distribution
- API Gateway
- Lambda functions
- DynamoDB tables
- IAM roles and policies
- CloudWatch logging/monitoring

Use CDK constructs and stacks appropriately.

Do not create unnecessary AWS resources.

Keep the architecture simple and cost-conscious.

The application is a relatively small seasonal retail application and must not be over-engineered.

Prefer a small number of logical CDK stacks or constructs.

Do not split infrastructure into many stacks without a clear reason.

## 6. AWS SECURITY

Use least-privilege IAM.

Lambda must receive only the minimum AWS permissions required for its responsibilities, scoped by function and resource.

Admin V1 does not use admin token authentication. The admin Lambda/API component must not depend on token-validation secrets for access control in V1. DynamoDB permissions must remain least-privilege and resource-scoped.

Do not use broad permissions such as:

Action: "_"
Resource: "_"

unless there is an explicit and documented technical requirement approved by the Principal Software Engineer.

Never hard-code:

- AWS credentials
- access keys
- secrets
- passwords
- API keys
- tokens
- AWS account IDs where avoidable
- environment-specific secrets

Use appropriate AWS/CDK mechanisms for configuration.

Do not commit .env files containing secrets.

Secret and configuration management:

- Use AWS Secrets Manager for runtime secrets
- Use AWS Systems Manager Parameter Store for environment configuration
- Never store secrets in source code, environment files, or CloudFormation/CDK properties
- All sensitive configuration must be injected at runtime via IAM

API Gateway security:

- Enable throttling to prevent abuse
- Set reasonable request size limits
- Define explicit CORS policy for the React application origin
- Do not allow unrestricted cross-origin access
- Use request/response logging and monitoring

CloudFront and S3 security:

- S3 bucket for frontend assets must be private
- Use Origin Access Identity (OAI) to restrict direct S3 access
- CloudFront must be the only public entry point for the frontend
- No public read access on the S3 bucket
- Use signed URLs or restricted headers for any authenticated S3 operations

## 7. ENVIRONMENTS

The infrastructure should support at least:

- development
- production

Environment-specific configuration must not require modifying application source code.

Do not hard-code production configuration into the CDK application.

Production infrastructure must use safer removal/protection policies for persistent resources such as DynamoDB.

Development resources may use less restrictive removal policies where appropriate.

Do not use destructive removal policies for production data unless explicitly approved.

## 8. CDK DEVELOPMENT RULES

When changing AWS infrastructure:

1. Understand the existing CDK architecture.
2. Reuse existing constructs where possible.
3. Avoid duplicate resources.
4. Follow least-privilege principles.
5. Keep resource naming consistent.
6. Keep environment configuration separate from business logic.
7. Add/update CDK tests where appropriate.
8. Run CDK validation before considering the change complete.

Before deployment, validate with:

- npm test
- npm run build
- cdk synth

Do not automatically deploy infrastructure unless explicitly instructed.

Never assume that a CDK change has been deployed simply because the code compiles.

## 9. INFRASTRUCTURE OWNERSHIP

The Principal Software Engineer owns:

- overall AWS architecture
- CDK architecture
- infrastructure standards
- security architecture
- cross-stack decisions
- environment strategy

The Senior Backend Developer may propose infrastructure changes required by backend functionality.

However, infrastructure changes that affect:

- architecture
- security
- data
- networking
- IAM
- production deployment

should be reviewed by the Principal Software Engineer.

The Senior Frontend Developer should not independently create or modify AWS infrastructure unless explicitly requested.

The UI/UX Designer does not own infrastructure.

## 10. SPECIFICATION BOUNDARY

Product behaviour is defined only by approved specifications in `/docs/specs`.

Implementation must follow the approved specification. Do not copy detailed business rules into application code comments, architecture guidance, or unrelated documentation.

When implementation reveals an ambiguity or contradiction in a specification, stop and raise the issue with the Principal Software Engineer before proceeding.

## 11. DEVELOPMENT WORKFLOW

Work incrementally, one feature at a time.

1. Select a feature with an approved specification in `/docs/specs`.
2. Review the specification and acceptance criteria.
3. Design the implementation.
4. Implement the feature following the specification.
5. Write tests aligned with acceptance criteria.
6. Run lint, tests, and builds.
7. Submit for review.
8. Iterate based on feedback.
9. Merge and move to the next feature.

Do not implement all features at once.

Each feature must be reviewed and tested before proceeding.

Do not start implementation on a feature without an approved specification.

### Git hooks

Git hooks are managed by Husky and are installed automatically by the root `prepare` script when `npm install` runs.

- `pre-commit`: runs `lint-staged` (Prettier and `eslint --fix` on staged files) followed by `npm run typecheck`.
- `commit-msg`: enforces a Conventional Commits header (`type(scope): subject`).
- `pre-push`: runs `npm run lint`, `npm run build`, and `npm test`.

Hooks are a fast local mirror of the CI quality gate. They do not replace CI, and CI remains authoritative.

Do not weaken or remove a hook to make a commit pass. Fix the underlying problem instead.

`--no-verify` is reserved for genuine emergencies and must be disclosed in the pull request.

Keep the `pre-commit` hook fast. Put slower whole-repository checks in `pre-push` or CI.

## 12. DOCUMENTATION

Maintain documentation for:

- architecture (in `/docs/specs/06-architecture`)
- API contracts (in `/docs/specs/04-api`)
- DynamoDB design (in `/docs/specs/05-data`)
- AWS architecture
- CDK infrastructure
- deployment
- testing
- important architectural decisions

Do not include secrets in documentation.

## 13. DEFINITION OF DONE

A feature is not complete simply because it compiles.

For application code:

- tests pass
- TypeScript passes
- lint passes
- build passes
- business rules are enforced
- error handling exists
- accessibility is considered
- mobile behaviour is verified

For infrastructure changes:

- CDK compiles
- CDK tests pass where applicable
- cdk synth succeeds
- cdk diff has been reviewed
- IAM permissions have been reviewed
- environment impact is understood
- production data protection has been considered

Do not claim infrastructure has been deployed unless an actual deployment was performed successfully.

## 14. TESTING REQUIREMENTS

Business-critical logic must have automated tests.

Minimum backend test coverage should include:

- valid draw behaviour from the approved specification
- duplicate participation and concurrent request handling
- backend validation
- weighted selection and no-eligible-prize behaviour
- draw-end enforcement
- admin APIs

Frontend tests should include:

- form validation
- 10-digit phone validation
- loading state
- button disabling
- successful draw
- already claimed
- API failure
- retry
- envelope reveal completion
- reveal/result consistency

The envelope reveal must be tested for backend-result consistency across configured prizes.

Before considering a feature complete:

- tests pass
- lint passes
- TypeScript build passes
- production build passes

## 15. CODE QUALITY

Use TypeScript strict mode.

Prefer:

- small functions
- clear names
- reusable components
- explicit types
- separation of concerns
- dependency injection where useful
- testable business logic

Avoid:

- giant components
- giant services
- duplicated logic
- unnecessary abstractions
- unnecessary dependencies
- premature optimization
- microservices
- business logic inside UI components

Do not modify unrelated code when implementing a feature.

## 16. AGENT RESPONSIBILITIES

Four specialist roles will work on this project.

The agents are specialist roles used by one developer. They do not represent separate teams or independent decision makers.

### 1. Principal Software Engineer

Owns:

- architecture
- technical governance
- cross-cutting concerns
- API contracts
- data model
- security architecture
- engineering standards
- architectural decisions

### 2. Senior UI/UX Designer

Owns:

- user experience
- visual design
- user flows
- responsive behaviour
- design system
- interaction design
- accessibility recommendations

Does NOT own backend or React implementation.

### 3. Senior Frontend Developer

Owns:

- React implementation
- frontend components
- forms
- API integration
- envelope reveal animation
- frontend testing
- responsive implementation

Does NOT own business rules or DynamoDB.

### 4. Senior Backend Developer

Owns:

- Node.js
- REST APIs
- business logic
- weighted prize selection
- DynamoDB
- claim uniqueness
- backend testing
- backend security

Does NOT make frontend UI decisions.

## 17. DECISION AUTHORITY

When agents disagree:

- Architecture/security/data integrity: Principal Software Engineer has final technical authority.
- Visual/user experience: Senior UI/UX Designer owns the recommendation.
- React implementation: Senior Frontend Developer owns implementation.
- Backend implementation: Senior Backend Developer owns implementation.

If a decision crosses multiple areas, document the trade-offs and involve the Principal Software Engineer.

Do not silently override another agent's architectural or design decision.

## 18. FILE ORGANIZATION

Business requirements belong in `/docs/specs`.

Engineering implementation rules belong in `.github/copilot-instructions.md`.

Agent-specific responsibilities belong in `.github/agents/` when agent files are created.

Do not duplicate the same requirement unnecessarily across multiple files.

When a conflict exists:

1. An approved feature specification determines WHAT the application must do.
2. This file determines HOW it should be implemented.
3. The Principal Software Engineer resolves technical conflicts.

## 19. SPEC OWNERSHIP

The Principal Software Engineer owns:

- architecture
- API contracts
- data model
- technical decisions
- specification review
- cross-feature consistency

The Senior UI/UX Designer owns:

- user journeys
- interaction design
- visual design
- responsive behaviour
- accessibility
- UI specifications

The Senior Frontend Developer owns:

- React + TypeScript implementation
- frontend tests
- API integration
- envelope reveal animation
- mobile experience

The Senior Backend Developer owns:

- Node.js + TypeScript
- API implementation
- business rules
- weighted prize selection
- DynamoDB
- backend tests

## 20. FINAL REVIEW

After updating this file and creating specifications:

1. Review the complete .github/copilot-instructions.md.
2. Review every specification in /docs/specs.
3. Ensure business requirements are in /docs/specs, not in this file.
4. Ensure engineering practices are in this file, not in /docs/specs.
5. Check for contradictions between specs and instructions.
6. Check for duplicate requirements across files.
7. Ensure React + TypeScript is clearly the frontend technology.
8. Ensure Node.js + TypeScript is clearly the backend technology.
9. Ensure AWS CDK + TypeScript is clearly the infrastructure technology.
10. Ensure the four agent responsibilities are consistent.
11. Ensure the SDD workflow is clearly documented.
12. Ensure no application code has been created.

Do not create or modify application source code.
