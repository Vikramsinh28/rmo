# Contributing to Kostra Boilerplate

Thank you for your interest in contributing! This document covers local setup, workflow, and expectations for pull requests.

## Getting Started

### Prerequisites

- Node.js 22 or higher
- pnpm 10 (recommended)
- PostgreSQL (local or Docker)
- Git

### Local Setup

1. Fork and clone the repository:

```bash
git clone git@github.com:advantailabs/kostra-boilerplate.git
cd kostra-boilerplate
```

2. Install dependencies:

```bash
pnpm install
```

3. Configure environment variables:

```bash
cp .env.example .env
```

Edit `.env` with your local credentials. Use sandbox/test keys only — never commit real secrets.

4. Set up the database:

```bash
pnpm migrate
pnpm seed
```

5. Start the development server:

```bash
pnpm dev
```

The app runs at `http://localhost:3000`.

### Running Tests Locally

```bash
pnpm lint
pnpm type-check
pnpm test
```

For integration tests that require a test database:

```bash
pnpm test:local
```

## Branch Naming

Use descriptive branch names with these prefixes:

| Prefix | Use for |
|--------|---------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `chore/` | Maintenance, deps, tooling |
| `refactor/` | Code changes that neither fix bugs nor add features |

Examples: `feat/add-webhook-retry`, `fix/stripe-checkout-redirect`

## Pull Request Process

1. Create a branch from `main`
2. Make focused changes — one logical change per PR when possible
3. Ensure CI passes:
   - `pnpm lint`
   - `pnpm type-check`
   - `pnpm test`
4. Update documentation if your change affects setup, APIs, or behavior
5. Open a PR against `main` and fill out the PR template

### PR Expectations

- Keep PRs reasonably sized and reviewable
- Include a clear description of **what** changed and **why**
- Add tests for new behavior where applicable
- Do not include unrelated formatting or refactors
- Never commit `.env` files or secrets

## Code Style

This project uses:

- **TypeScript** with strict mode
- **ESLint** and **Prettier** for linting and formatting
- **Atomic Design** for components (`atom/`, `molecules/`, `organisms/`)

Guidelines:

- Follow existing patterns in the codebase
- Use 2-space indentation and single quotes
- Keep components small and focused
- Place files according to the [project structure](.cursor/rules/project-structure.mdc)

Run before committing:

```bash
pnpm lint:fix
pnpm format
pnpm check
```

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add credit refund webhook handler
fix: resolve JWT expiry edge case
docs: update Stripe setup instructions
chore: bump prisma to 6.x
```

## Reporting Issues

- **Bugs**: Use the bug report issue template
- **Features**: Use the feature request issue template
- **Security**: See [SECURITY.md](SECURITY.md) — do not open public issues for vulnerabilities

## Questions?

Open a GitHub issue with the `question` label, or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
