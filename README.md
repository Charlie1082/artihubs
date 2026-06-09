# Artihubs Prototype Site

Prospector가 후보 Maker에게 연락하기 전에 보여줄 수 있는 Artihubs 프로토타입 사이트입니다.

## Run

```bash
cd "/Users/charlie/Artihubs Project/prototype-site"
python3 -m http.server 4173 --bind 0.0.0.0
```

## Pages

- `/`
- `/living-globe-v2/`
- `/for-makers/`
- `/for-seekers/`
- `/explore/`
- `/signup/`
- `/login/`
- `/welcome/`
- `/account/`
- `/cofounder-mockup/`

## Deploy

This folder is prepared for Vercel.

- Static pages are plain HTML/CSS/JS.
- `/api/v1/intake.js` is the current intake API wrapper.
- `/api/v1/search.js` is the current Claude Sonnet 4.6 maker search API wrapper.
- `/api/v1/health.js` is a minimal deployment health check.
- `/api/v1/me.js` validates Supabase bearer tokens and returns profile/role context when Auth is configured; missing profile rows fail closed with `PROFILE_NOT_FOUND`.
- `/api/v1/auth/signup.js` and `/api/v1/auth/login.js` are guarded public Auth wrappers. They stay disabled unless `AUTH_PUBLIC_AUTH_ENABLED=true` and Supabase Auth config are present.
- `/api/v1/admin/intake-submissions.js` lists and updates private intake submissions only for server-validated `reviewer`, `admin`, or `super_admin` roles.
- `/api/v1/admin/audit-events.js` lists sanitized audit events only for server-validated `admin` or `super_admin` roles.
- `/api/v1/admin/roles.js` lists and updates admin roles only for server-validated `super_admin` users.
- `/api/v1/admin/maintenance.js` calls approved maintenance RPC helpers only for server-validated `admin` or `super_admin` users.
- `/api/v1/admin/privacy-redactions.js` calls approved privacy redaction RPC helpers only for server-validated `admin` or `super_admin` users.
- `/api/intake` and `/api/search` remain compatibility paths through Vercel rewrites to the v1 handlers.
- Supabase and Claude credentials must be set only in Vercel environment variables.
- Optional search query logging is disabled by default and stores only redacted previews plus HMAC hashes when enabled.
- See `DEPLOYMENT.md`.

## Verification

```bash
node scripts/predeploy-check.mjs
```

The same predeploy gate is also defined in `.github/workflows/predeploy.yml` for GitHub pull requests and pushes to `main`.

Individual checks:

```bash
node scripts/check-env.mjs
node scripts/syntax-check.mjs
node scripts/config-smoke-test.mjs
node scripts/client-security-smoke-test.mjs
node scripts/secrets-smoke-test.mjs
node scripts/api-smoke-test.mjs
```
