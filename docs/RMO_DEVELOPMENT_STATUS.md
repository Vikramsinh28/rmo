# RMO development status

Foundation only. The Railway Monitoring Operations product is not implemented.
Kostra is the web shell. Domain data stays in the existing RMO API.

```
PostgreSQL
    ↑
 Sequelize
    ↑
  RMO API
```

`railway-monitor`, `remote_monitoring_admin_app`, and `remote_monitoring_user_app` were not changed.

## Completed work

- Removed the SaaS application surface: billing, Stripe, credits UI and credit APIs, subscriptions, blogs, categories, packages, campaigns, contact, marketing pages, Google sign-in, and the old `/app` console.
- Kept the authentication foundation, shared UI, file upload to S3, email OTP, Sentry, Zod, Zustand, Tailwind, and Next.js.
- Added an RMO route shell with placeholder pages and sidebar navigation. Pages do not load or mutate operational data.
- Moved the Sentry tunnel from `/monitoring` to `/sentry-tunnel` so the monitoring page is covered by the auth proxy.
- Left `prisma/schema.prisma` and `prisma/migrations` unchanged. No RMO tables were added.

## Application structure

```
src/app/(auth)/login/
src/app/(dashboard)/
  overview/
  divisions/
  lobbies/
  crew/
  monitoring/
  forms/
  devices/
  safety-events/
  settings/
```

`/` redirects to `/login`. Unauthenticated visits to the dashboard routes redirect to `/login`.

Navigation sections:

- Operations: Overview, Monitoring, Safety events (current roles `USER` and `ADMIN`)
- Organization: Divisions, Lobbies, Crew (`ADMIN`)
- Setup: Forms, Devices (`ADMIN`), Settings (`USER` and `ADMIN`)

The six target RMO roles are not enforced.

## Files added

- `docs/RMO_DEVELOPMENT_STATUS.md`
- `src/app/(auth)/layout.tsx`
- `src/app/(auth)/login/page.tsx`
- `src/app/(dashboard)/layout.tsx`
- `src/app/(dashboard)/overview/page.tsx`
- `src/app/(dashboard)/divisions/page.tsx`
- `src/app/(dashboard)/lobbies/page.tsx`
- `src/app/(dashboard)/crew/page.tsx`
- `src/app/(dashboard)/monitoring/page.tsx`
- `src/app/(dashboard)/forms/page.tsx`
- `src/app/(dashboard)/devices/page.tsx`
- `src/app/(dashboard)/safety-events/page.tsx`
- `src/app/(dashboard)/settings/page.tsx`
- `src/components/organisms/shared/ModulePlaceholder.tsx`
- `src/lib/constants/sidebar-navigation.ts`

## Files changed

- `package.json` and `pnpm-lock.yaml` (SaaS packages removed)
- `.env.example` (Stripe, OpenAI, and Google client id removed)
- `.github/workflows/ci.yml` (Stripe, OpenAI, and Google secret env vars removed)
- `next.config.mjs` (Sentry `tunnelRoute` is `/sentry-tunnel`; unused `framer-motion` import optimization removed)
- `src/proxy.ts` (login redirects; matcher excludes `sentry-tunnel` so `/monitoring` is authenticated)
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/siteConfig.ts`, `src/app/sitemap.ts`, `src/app/robots.ts`
- `src/lib/routes/config.ts`
- `src/providers/Providers.tsx`, `src/providers/AuthProvider.tsx`
- `src/store/auth.ts`
- `src/hooks/useEmailSignIn.ts`, `src/hooks/useOTPVerification.ts`, `src/hooks/useResetPassword.ts`
- `src/services/api/auth.ts`
- `src/app/api/files/route.ts`, `src/app/api/file-upload/presigned-url/route.ts` (plan and credit gates removed)
- `src/components/organisms/shared/navigation/Sidebar.tsx`
- `src/components/organisms/shared/navigation/UserProfileDropdown.tsx`
- `src/components/organisms/shared/navigation/DropdownUserProfile.tsx`
- Admin user UI that still typechecks with the admin API: plan, credits, and Stripe fields removed from the edit modal, details list, and table columns

## Files removed

Application routes and APIs:

- `src/app/(branding)/`
- `src/app/app/` (blogs, packages, files console, billing, email, contacts, credit history, admin pages)
- `src/app/onboarding/`
- `src/app/api/billing/`
- `src/app/api/webhooks/stripe/`
- `src/app/api/blogs/`
- `src/app/api/categories/`
- `src/app/api/packages/`
- `src/app/api/contact/`
- `src/app/api/campaigns/`
- `src/app/api/campaign-recipients/`
- `src/app/api/email-templates/`
- `src/app/api/users/credits/`
- `src/app/api/auth/google/`

UI, hooks, and services:

- `src/components/branding/`
- Blog, category, package, credit-history, email-campaign, email-template, contact, and file console organisms
- `src/components/molecules/blogs/`, `editor/`, `files/`
- Credit purchase modal, Google sign-in button, sign-in modal, credit display
- Hooks: `useBlogs`, `useBlogForm`, `useCategories`, `usePackages`, `useCredits`, `useStripe`, `useContacts`, `useEmailCampaigns`, `useEmailTemplates`, `useGoogleSignIn`, `useFiles`
- `src/services/external/stripe/`, `src/services/external/google/`
- Credit, campaign, contact, and campaign-email internal services
- Repositories and API clients for blogs, categories, packages, contacts, credit history, campaigns, and email templates
- Schemas and types for blog, category, package, contact, campaign, and email template
- `src/data/config/plans.ts`
- `src/store/credits.ts`, `src/store/ui/modals.ts`
- `src/providers/SignInModalProvider.tsx`
- Package API tests and contact / email-template validations

## Files preserved

- Next.js App Router, `src/proxy.ts`, Tailwind, shared atoms, molecules, and shadcn UI
- Auth routes: login, signup, verify-signup, forgot-password, reset-password, resend-otp, logout, `GET /api/auth`
- Cookie JWT (`src/lib/auth/jwt.ts`), Zustand auth store, Zod auth schema, email OTP
- Admin user API under `src/app/api/admin/users` (no admin page is routed)
- S3 upload and file APIs, file repository, `useFileUpload`
- Sentry instrumentation
- `prisma/schema.prisma` and existing migrations, including leftover SaaS models (`Package`, `Blog`, `Campaign`, credit and Stripe columns on `User`)
- Auth tests, email service tests, S3 tests, file-utils tests

SaaS columns remain on the temporary Kostra auth user so existing signup and login tests keep working. They are not an RMO billing feature. The shell does not sell credits or subscriptions.

## Dependencies removed

- `stripe`, `svix`
- `openai`
- `@react-oauth/google`
- `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-placeholder`
- `framer-motion`
- `html-entities`, `strnum`

## Dependencies retained

- `next`, `react`, `react-dom`, `typescript`
- `tailwindcss` and Tailwind plugins
- `zod`, `zustand`, `@tanstack/react-query`, `@tanstack/react-table`
- `@sentry/nextjs`
- `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-ses`
- `@prisma/client`, `@prisma/adapter-pg`, `prisma`, `pg` (existing Kostra auth database client only)
- `jose`, `bcryptjs`, `resend`, `axios`, `react-hook-form`, `next-themes`, Radix / shadcn UI, `lucide-react`, `sonner`

## Verification

Run on 24 Sep 2026 against this tree:

| Check | Result |
| --- | --- |
| `eslint .` | Exit 0. One pre-existing warning in `src/components/ui/data-table.tsx` (`useReactTable` / `react-hooks/incompatible-library`). |
| `tsc --noEmit` | Exit 0 |
| `jest --verbose --no-coverage` | 7 suites, 64 tests, all passed |
| `next build` and sitemap check | Exit 0. Sentry still warns that `import-in-the-middle` and `require-in-the-middle` are not installed. The build completes. |

Auth HTTP tests need the app on port 3001 with `TEST_MODE=true` (the email test driver) and Postgres at `127.0.0.1:5433/kostra_test`, which is what `jest.setup.js` uses. The schema was applied with `prisma db push` on an empty database. `prisma db push --force-reset` was not used.

HTTP check of the production server, without a session:

- `/` carries a Next.js redirect to `/login`
- `/login` returns 200
- `/overview`, `/divisions`, `/lobbies`, `/crew`, `/monitoring`, `/forms`, `/devices`, `/safety-events`, and `/settings` return 307 to `/login`

No browser automation tools were available, so click-through of the login form in a real browser was not done. Route protection and the production build were checked over HTTP.

## Remaining work

Do not start these in the foundation:

- WebRTC, camera streaming, face recognition, visual impairment, AI monitor, safety detection, forms, and monitoring sessions
- Wiring Kostra to the Sequelize RMO API
- Six-role access control, zones, home lobby vs operational lobby, two-call limit, presence, devices, and safety events
- Replacing the temporary Prisma auth store
- Admin console pages for the preserved admin user API
- Removing leftover SaaS columns from the Kostra Prisma schema once auth no longer depends on them

## Architecture decisions made

- Kostra is the web shell. It does not own RMO domain tables.
- Sequelize in `railway-monitor` remains the schema owner for PostgreSQL domain data.
- The existing Prisma schema stays as the temporary auth and file store. No migration was added.
- Current route checks use `ADMIN` and `USER` until the six RMO roles are accepted.
- Placeholder pages are the only dashboard UI. They do not call the RMO API.
- S3 remains available for uploads. Free-plan and credit limits no longer gate it.
- The Sentry tunnel path is `/sentry-tunnel` so it does not occupy `/monitoring`.
- The shell title in `siteConfig` is Railway Monitor (`https://railwaymonitor.in`).

## Architecture decisions still pending

These stay open. Written requirements and `docs/RMO_KOSTRA_ARCHITECTURE_DISCOVERY.md` still govern them.

- Section 15 of the product requirements is unaccepted.
- Final role set and how it maps onto the current `ADMIN` / `USER` auth.
- Home lobby vs operational lobby, session state vs lobby presence, and the two-call limit.
- Visual impairment, safety events, and OFF / SHADOW / ACTIVE. They are absent from the written requirements.
- Whether Kostra will call the existing Express API or a later API shape.
- When the Prisma auth database is retired or reduced to a non-domain store.
- Product branding (MonitorSync, RailWatch, Remote Monitoring System, Railway Monitor).
