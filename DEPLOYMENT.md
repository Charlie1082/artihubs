# Artihubs Deployment Guide

Domain: `artihubs.com`

## Target Stack

- GitHub: source repository
- Vercel: static site and serverless intake API
- Cloudflare: DNS for `artihubs.com`
- Supabase: early intake database
- Anthropic Claude: natural-language maker search

## Supabase Setup

1. Open the Supabase project SQL Editor.
2. Run `deployment/supabase-intake-schema.sql`.
   - This keeps the current prototype intake path working.
   - Platform v1 migration drafts are managed outside the deployable site root at `../docs/deployment/migrations/`.
   - Do not run those platform v1 drafts in production until Engineering separately reviews and approves the final migration.
3. Keep Data API enabled.
4. Copy the project URL from Supabase project settings or Data API.
   - Use the base project URL in Vercel: `https://PROJECT_REF.supabase.co`
   - Do not include `/rest/v1/` in `SUPABASE_URL`.
5. Copy the server-side service role key or secret key from Supabase API settings.
   - Put it only in Vercel environment variables.
   - Never paste it into public code, GitHub issues, docs, or chat.
6. Copy the public anon key or publishable key for server-side bearer token validation.
   - This value is public by design, but still keep all Supabase keys managed through environment variables.

## Vercel Environment Variables

Set these in Vercel Project Settings -> Environment Variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `INTAKE_TABLE=public_intake`
- `RATE_LIMIT_MODE=memory`
- `ALLOWED_ORIGINS=https://artihubs.com,https://www.artihubs.com`
- `ADMIN_ALLOWED_ORIGINS=` unless Admin Console is hosted on a separate trusted origin
- `AUTH_PUBLIC_AUTH_ENABLED=false` until non-production Auth, SMTP, RLS, and `/api/v1/me` validation pass
- `SEARCH_FALLBACK_MODE=degraded`
- `TURNSTILE_SECRET_KEY` after the Cloudflare public site key is configured on form pages
- `TURNSTILE_REQUIRED=false` until the deployed form submits a verified Turnstile client token
- `AUDIT_IP_HASH_SECRET` later, before operational admin activity logging. Use at least 32 random characters.

If the Supabase dashboard exposes newer key labels, set `SUPABASE_PUBLISHABLE_KEY` instead of `SUPABASE_ANON_KEY`, or `SUPABASE_SECRET_KEY` instead of `SUPABASE_SERVICE_ROLE_KEY`. The deployed API accepts either public key name and either server key name.

Before copying values into Vercel, validate the local env shape:

```bash
node scripts/check-env.mjs
```

For a real deployment env file, run strict validation:

```bash
node scripts/check-env.mjs .env.production --strict
```

The strict mode rejects placeholder Supabase, Claude, and server-key values.

Auth account context:

- `GET /api/v1/me` returns `501 AUTH_NOT_CONFIGURED` until `SUPABASE_URL`, a Supabase public key, and a Supabase server key are configured.
- When configured, it requires `Authorization: Bearer <supabase-user-access-token>`.
- It validates the bearer token through Supabase Auth, then loads `profiles`, `admin_roles`, and active `organization_memberships` using the server key.
- It fails closed with `PROFILE_NOT_FOUND` if Supabase Auth succeeds but the matching `profiles` row is missing.
- It returns only normalized user/profile/role context and derived permissions; it does not expose Supabase keys or raw provider payloads.

Public signup/login preview:

- `/account/` provides the signup/login demo surface.
- `POST /api/v1/auth/signup` and `POST /api/v1/auth/login` remain disabled with `501 AUTH_NOT_CONFIGURED` until `AUTH_PUBLIC_AUTH_ENABLED=true` and Supabase Auth config are present.
- Keep `AUTH_PUBLIC_AUTH_ENABLED=false` for production until non-production Supabase Auth, custom SMTP, profile bootstrap, RLS, `/api/v1/me`, and rollback behavior are validated.
- The local browser demo mode on `/account/` does not store passwords and does not publish Maker profiles.

Admin intake inbox:

- `GET` and `PATCH /api/v1/admin/intake-submissions` require the same Supabase Auth configuration as `/api/v1/me`.
- It requires a server-read role of `reviewer`, `admin`, or `super_admin`.
- It reads the allowlisted `INTAKE_TABLE` only: `public_intake` or `intake_submissions`.
- Optional query filters: `status`, `type`, `limit`.
- `PATCH` accepts only `{ "id": "<uuid>", "status": "<allowed-status>" }`.
- It does not return raw `metadata`.
- Status updates write a best-effort `audit_events` row when that v1 table exists.
- `AUDIT_IP_HASH_SECRET` enables HMAC hashing of request IP metadata only when it is at least 32 characters and not a placeholder; without a usable value, `ip_hash` is stored as `null` and raw IP is not stored.

Admin audit events:

- `GET /api/v1/admin/audit-events` requires the same Supabase Auth configuration as `/api/v1/me`.
- It requires a server-read role of `admin` or `super_admin`.
- Optional query filters: `entityTable`, `entityId`, `eventType`, `limit`.
- It returns sanitized `afterData`, `ipHashPresent`, and core event fields.
- It does not return raw `ip_hash`, `user_agent`, request bodies, or unrestricted `before_data`/`after_data`.

Admin role management:

- `GET` and `PATCH /api/v1/admin/roles` require the same Supabase Auth configuration as `/api/v1/me`.
- They require a server-read role of `super_admin`.
- `PATCH` accepts only `{ "profileId": "<uuid>", "role": "reviewer|admin|super_admin" }`.
- Self-role changes are rejected to reduce lockout risk.
- The first `super_admin` still must be bootstrapped by reviewed database operation, not by code.
- To generate review-only bootstrap SQL after the target `profiles.id` is verified:
  `node scripts/generate-super-admin-bootstrap-sql.mjs <profile_uuid> [--granted-by <profile_uuid>]`
- Role updates write a best-effort `audit_events` row when that v1 table exists.

Admin maintenance:

- `POST /api/v1/admin/maintenance` requires the same Supabase Auth configuration as `/api/v1/me`.
- It requires a server-read role of `admin` or `super_admin`.
- Supported action is `cleanup_expired_rate_limit_buckets`.
- The route calls only the reviewed RPC helper from migration `010_maintenance_cleanup_helpers.sql`.
- Future cleanup cutoff timestamps are rejected before RPC.
- Production use remains blocked until migration 010 and the RPC call path are validated in non-production Supabase.

Admin privacy redactions:

- `POST /api/v1/admin/privacy-redactions` requires the same Supabase Auth configuration as `/api/v1/me`.
- It requires a server-read role of `admin` or `super_admin`.
- Supported actions are `redact_intake_submission` and `redact_search_query_logs`.
- The route calls only the reviewed RPC helpers from migration `009_retention_redaction_helpers.sql`.
- Production use remains blocked until migration 009 and the RPC call path are validated in non-production Supabase.

Intake table source:

- Default: `INTAKE_TABLE=public_intake`
- After the v1 migration is reviewed and applied: `INTAKE_TABLE=intake_submissions`
- Any other table name is rejected before a Supabase request is made.

Rate limit source:

- Default: `RATE_LIMIT_MODE=memory`
- After migration `008_rate_limit_buckets.sql` is reviewed and applied: `RATE_LIMIT_MODE=supabase`
- `RATE_LIMIT_MODE=supabase` also requires a configured Supabase URL and server key.
- If the Supabase durable limiter is unavailable, the API falls back to memory limiting instead of failing open.

Browser origin guard:

- Same-host browser requests are allowed automatically.
- Use `ALLOWED_ORIGINS` only for additional trusted origins.
- Use `ADMIN_ALLOWED_ORIGINS` only for additional trusted Admin Console origins.
- Public `ALLOWED_ORIGINS` does not authorize Admin routes or Admin preflight.
- Do not use wildcard origins.
- Hostile browser origins receive `403 ORIGIN_NOT_ALLOWED` before the API reads the request body.
- Public API allowlisted browser origins receive CORS headers and `OPTIONS` preflight returns `204`.
- Admin routes reject hostile browser origins before authentication or database/RPC calls and use `ADMIN_ALLOWED_ORIGINS`, not public `ALLOWED_ORIGINS`.
- Admin allowlisted browser origins receive CORS headers for `Authorization, Content-Type`; `OPTIONS` preflight returns `204`.

For natural-language Explore Hubs search, set the Claude key as `ANTHROPIC_API_KEY`. The deployed search API also accepts `CLAUDE_API_KEY`, but `ANTHROPIC_API_KEY` is preferred. The model is fixed in code to `claude-sonnet-4-6`.

Search fallback mode:

- Production default: `SEARCH_FALLBACK_MODE=degraded`.
- `degraded`: if the Claude key is absent or AI ranking fails, Explore Hubs returns local prototype ranking with `rankSource: "fallback"` and `degraded: true`.
- `strict`: if the Claude key is absent or AI ranking fails, Explore Hubs returns `503 SEARCH_UNAVAILABLE` with no local fallback matches. Use this only for Claude-only dry tests.
- Do not change Vercel environment values directly from Engineering automation; propose the value and wait for charlie님 approval for account-level settings.
- User-facing strings must refer to "Artihubs" or "AI search", not model/vendor names.

Search profile source:

- Default: `SEARCH_PROFILE_SOURCE=local`
- After v1 DB migration and approved public profiles are ready: `SEARCH_PROFILE_SOURCE=database`
- The database source reads only `public_maker_profiles where is_active = true`; if unavailable, the server falls back to local prototype profiles with `profileSource: "local_fallback"`.

Search query logging:

- Default: `SEARCH_QUERY_LOGGING_ENABLED=false`
- Enable only after migration `005_requests_search_and_audit.sql` is reviewed and applied.
- `SEARCH_QUERY_LOGGING_ENABLED=true` requires a configured Supabase URL/server key and `SEARCH_QUERY_HASH_SECRET` with at least 32 random characters.
- The API stores a redacted `query_preview`, HMAC `query_hash`, result public profile ids, rank source, model, latency, and status. It does not store the raw full query.

Model selection note: Claude Sonnet 4.6 is the current Artihubs replacement for prior Sonnet-class natural-language search, analysis, and ranking work.

## GitHub To Vercel

1. Import `Charlie1082/artihubs` into Vercel.
2. Framework preset: `Other`.
3. Build command: leave empty.
4. Output directory: leave empty.
5. Root directory: leave empty, because this repository is already the deployable site root.

## Security Headers

`vercel.json` sets global response headers for:

- MIME sniffing protection,
- strict referrer policy,
- camera/microphone/geolocation denial,
- frame denial,
- cross-domain policy denial,
- HTTPS Strict Transport Security.

`node scripts/config-smoke-test.mjs` verifies those headers remain present.

## Cloudflare DNS

After adding `artihubs.com` to the Vercel project, Vercel will show the required DNS records.

Typical external DNS setup:

- Apex `artihubs.com`: A record to Vercel's assigned IP, commonly `76.76.21.21`.
- `www.artihubs.com`: CNAME to `cname.vercel-dns.com`.

Use Vercel's exact domain instructions as the final source of truth because project-specific domain status can differ.

Start with Cloudflare proxy set to DNS-only if Vercel domain verification does not complete.

## Local Verification

Run:

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Then open:

- `http://0.0.0.0:4173/`
- `http://0.0.0.0:4173/living-globe-v2/`
- `http://0.0.0.0:4173/for-makers/`
- `http://0.0.0.0:4173/for-seekers/`
- `http://0.0.0.0:4173/explore/`

Local form submissions fall back to browser localStorage only on localhost-style hosts. Production submissions do not store private intake data in localStorage.

Compatibility paths:

- `/api/intake` rewrites to `/api/v1/intake`.
- `/api/search` rewrites to `/api/v1/search`.

Natural-language Explore Hubs search calls `/api/v1/search` in production. If the Claude environment variable is missing, it safely falls back to local prototype ranking.

After Vercel deploys, check:

- `https://artihubs.com/api/v1/health`

Run repository checks:

```bash
node scripts/predeploy-check.mjs
```

The GitHub Actions workflow `.github/workflows/predeploy.yml` runs the same predeploy command for pull requests and pushes to `main`.

Individual checks:

```bash
node scripts/syntax-check.mjs
node scripts/config-smoke-test.mjs
node scripts/client-security-smoke-test.mjs
node scripts/secrets-smoke-test.mjs
node scripts/api-smoke-test.mjs
```

## Next Security Step

Before public outreach:

- Configure the real Cloudflare Turnstile public site key on intake form pages, then verify token submission before setting `TURNSTILE_REQUIRED=true`.
- Current default API rate limiting is serverless best-effort only. Use `RATE_LIMIT_MODE=supabase` after the durable limiter migration is validated before larger traffic.
- Add email confirmation or Clerk auth for authenticated flows.
- Split verified maker profiles and seeker requests into dedicated tables.
- Add audit logs for status changes.
