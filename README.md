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
- `/cofounder-mockup/`

## Deploy

This folder is prepared for Vercel.

- Static pages are plain HTML/CSS/JS.
- `/api/intake.js` is a Vercel serverless function.
- `/api/search.js` is a Vercel serverless function for Claude Sonnet 4.6 maker search.
- Supabase and Claude credentials must be set only in Vercel environment variables.
- See `DEPLOYMENT.md`.
