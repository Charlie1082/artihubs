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
3. Keep Data API enabled.
4. Copy the project URL from Supabase project settings or Data API.
   - Use the base project URL in Vercel: `https://PROJECT_REF.supabase.co`
   - Do not include `/rest/v1/` in `SUPABASE_URL`.
5. Copy the server-side service role key or secret key from Supabase API settings.
   - Put it only in Vercel environment variables.
   - Never paste it into public code, GitHub issues, docs, or chat.

## Vercel Environment Variables

Set these in Vercel Project Settings -> Environment Variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`

If the Supabase dashboard exposes a newer server-side secret key label instead of a legacy service role key, set `SUPABASE_SECRET_KEY`. The deployed API accepts either `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`.

For natural-language Explore Hubs search, set the Claude key as `ANTHROPIC_API_KEY`. The deployed search API also accepts `CLAUDE_API_KEY`, but `ANTHROPIC_API_KEY` is preferred. The model is fixed in code to `claude-sonnet-4-6`.

Model selection note: Claude Sonnet 4.6 is the current Artihubs replacement for prior Sonnet-class natural-language search, analysis, and ranking work.

## GitHub To Vercel

1. Import `Charlie1082/artihubs` into Vercel.
2. Framework preset: `Other`.
3. Build command: leave empty.
4. Output directory: leave empty.
5. Root directory: leave empty, because this repository is already the deployable site root.

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

Local form submissions fall back to browser localStorage. Production submissions should go to `/api/intake` and then Supabase.

Natural-language Explore Hubs search calls `/api/search` in production. If the Claude environment variable is missing, it safely falls back to local prototype ranking.

## Next Security Step

Before public outreach:

- Add rate limiting or Cloudflare Turnstile.
- Add email confirmation or Clerk auth for authenticated flows.
- Split verified maker profiles and seeker requests into dedicated tables.
- Add audit logs for status changes.
