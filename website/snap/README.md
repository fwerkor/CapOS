# CapOS Snap Store

`snap.capos.top` combines three surfaces in one Cloudflare Worker deployment:

- a public, App Store-style catalog for CapOS users;
- Snap Store compatible `/v2/*` federation endpoints and proxied upstream downloads;
- a PIN-protected `/admin` console for repository versions, upstream order, local packages and CapOS metadata.

## Architecture

- **Cloudflare Worker**: API, authentication, upstream federation, streaming proxy and authenticated package upload controller.
- **D1**: repository versions, ordered upstreams, local Snap metadata, sessions and audit log.
- **Cloudflare R2 / `repo.capos.top`**: the existing `capos` bucket stores local artifacts at `/<version>/snaps/*.snap`.
- **Canonical/other upstreams**: queried in priority order. Their Snap downloads are proxied in real time and are never mirrored into R2.

Resolution order is always `local > upstream[0] > upstream[1] > ...` for a repository version.

## Local development

Use Node.js 22 or newer.

```sh
npm install
npm run dev
```

Vite development mode uses representative catalog/admin data so the UI can be developed without production credentials. Any non-empty PIN unlocks the local admin preview.

## Production setup

The production bootstrap is intentionally one command:

```sh
npm run setup:production
```

It authenticates Wrangler if necessary, reuses or creates the `capos-snap-store` D1 database in APAC, writes its non-secret database ID into `wrangler.toml`, applies migrations, prompts for the administrator PIN, generates `SESSION_SECRET` and `ADMIN_PIN_HASH`, builds and deploys the Worker, binds the existing `capos` R2 bucket, creates the `snap.capos.top` custom domain, and verifies the public endpoints.

The only interactive steps are Cloudflare authorization in the browser and choosing the administrator PIN. The generated session secret and PIN hash are sent to Cloudflare through Wrangler and are never written to the repository.

The resulting D1 database ID is not secret and should be committed after the first production setup.

Generate the administrator hash without putting the PIN into the repository:

```sh
node -e "const c=require('crypto'); const pin=process.env.PIN; const secret=process.env.SESSION_SECRET; console.log(c.createHash('sha256').update(pin+':'+secret).digest('hex'))"
```

The admin session is an HttpOnly/Secure/SameSite=Strict cookie. Five failed PIN attempts from one IP lock authentication for 15 minutes.

## R2 uploads

Large Snap files are uploaded as a Cloudflare R2 multipart upload. The browser splits the file into 32 MiB parts and sends authenticated same-origin requests to the Worker; the Worker streams each part into the `ARTIFACTS` R2 binding. This avoids single-request body limits without creating R2 S3 access keys or exposing any storage credential to the browser.

After every part is accepted, `/api/admin/packages/finalize` completes the multipart upload, verifies the final object size, and records the local package in D1. Failed uploads are explicitly aborted.
