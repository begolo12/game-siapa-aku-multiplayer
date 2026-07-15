# Siapa Aku Multiplayer

## Run locally

**Prerequisites:** Node.js and npm.

1. Install the locked dependencies:
   ```sh
   npm ci
   ```
2. Copy the environment template and, if persistent storage is wanted locally, set
   `DATABASE_URL` in `.env`:
   ```sh
   cp .env.example .env
   ```
   Without `DATABASE_URL`, the local server uses `data-store.json`.
3. Start the development server:
   ```sh
   npm run dev
   ```

## Build and deploy on Vercel

`npm run build` creates the Vite frontend in `dist/` and a local production
server bundle. On Vercel, `api/[...path].ts` imports the server source as a
function dependency; `vercel.json` serves the static frontend and routes
`/api/*` requests to that function.

Set `DATABASE_URL` in the Vercel project's Production (and Preview, if used)
environment before deploying. The file-based local fallback is not persistent
in Vercel serverless functions.
