# Dutta Brothers Festive Lucky Draw

A mobile-first festive lucky draw application for Dutta Brothers Electronics.

Active customer presentation reveal is the festive gift box reveal, as defined in the approved customer specifications.

Product behaviour is defined by the approved specifications in [`/specs`](specs). Engineering standards are defined in [`.github/copilot-instructions.md`](.github/copilot-instructions.md). The implementation plan is documented in [`docs/implementation-plan.md`](docs/implementation-plan.md).

AWS deployment context and promotion requirements are documented in [`docs/deployment/aws-phase1-environment-contract.md`](docs/deployment/aws-phase1-environment-contract.md).

## Repository Structure

```text
/frontend        React + TypeScript application
/backend         Node.js + TypeScript backend
/shared          Shared TypeScript boundary
/infrastructure  AWS CDK + TypeScript foundation
/tests           Repository-level tests
/specs           Approved product specifications
/docs            Architecture and implementation documentation
/.github         Copilot instructions
```

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- AWS CDK CLI for infrastructure validation
- AWS credentials only when working with an AWS environment

Do not commit credentials, tokens, or `.env` files containing secrets.

## Install

```bash
npm install
```

`npm install` also installs the Git hooks described in [Git Hooks](#git-hooks).

## Run Frontend Locally

```bash
npm run dev:frontend
```

The frontend dev server proxies all `/api/*` requests to `http://localhost:3001`.

## Run Backend Locally

```bash
npm run dev:backend
```

Local backend mode is AWS-independent by design.

Optional local environment variables:

- `APP_RUNTIME=LOCAL` (default when unset)
- `LOCAL_BACKEND_PORT=3001`

Do not use production secrets for local development.

## Tests

```bash
npm test
```

## Type-check and Build

```bash
npm run typecheck
npm run build
```

## Lint and Formatting

```bash
npm run lint
npm run format:check
```

## CDK Commands

```bash
npm run cdk:synth
```

CDK synth validates the generated CloudFormation template and does not deploy resources.

## Git Hooks

Hooks are managed by Husky and installed automatically by the `prepare` script on `npm install`.

| Hook         | Runs                                                                           | Purpose                                                                    |
| ------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `pre-commit` | `lint-staged` (Prettier + ESLint `--fix` on staged files), `npm run typecheck` | Keeps formatting and lint clean, and blocks commits that break TypeScript. |
| `commit-msg` | Conventional Commits header check                                              | Keeps history machine-readable and consistent with Dependabot commits.     |
| `pre-push`   | `npm run lint`, `npm run build`, `npm test`                                    | Catches CI failures before they reach a pull request.                      |

Hooks mirror the CI quality gate; they do not replace it. Run `npm run quality:gate` for the full gate including coverage.

To bypass hooks in an emergency, use `git commit --no-verify` or `git push --no-verify` and explain why in the pull request.

## Development Workflow

1. Read the approved specification and acceptance criteria.
2. Confirm the feature is authorized for the current implementation phase.
3. Implement the smallest vertical slice.
4. Add tests mapped to acceptance criteria.
5. Run type-checking, lint, tests, build, and relevant CDK validation.
6. Review security, mobile behaviour, and data integrity.
7. Proceed only after the phase exit criteria pass.
