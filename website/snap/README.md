# CapOS Snap Store

`snap.capos.top` combines three surfaces in one Cloudflare Worker deployment:

- a public, App Store-style catalog for CapOS users;
- Snap Store compatible `/v2/*` federation endpoints and proxied upstream downloads;
- a Cloudflare Access-protected `/admin` console for repository versions, upstream order, local packages and CapOS metadata.

## Architecture

- **Cloudflare Worker**: API, Access JWT verification, upstream federation, streaming proxy and authenticated package upload controller.
- **D1**: repository versions, ordered upstreams, local Snap metadata and audit log.
- **Cloudflare R2 / `repo.capos.top`**: the existing `capos` bucket stores local artifacts at `/<version>/snaps/*.snap`.
- **Canonical/other upstreams**: queried in priority order. Their Snap downloads are proxied in real time and are never mirrored into R2.

Resolution order is always `local > upstream[0] > upstream[1] > ...` for a repository version.

## Local development

Use Node.js 22 or newer.

```sh
npm install
npm run dev
```

Vite development mode uses representative catalog/admin data so the UI can be developed without production credentials.

## Production setup

The production bootstrap is intentionally one command:

```sh
npm run setup:production
```

It authenticates Wrangler if necessary, reuses or creates the `capos-snap-store` D1 database in APAC, writes its non-secret database ID into `wrangler.toml`, applies migrations, builds and deploys the Worker, binds the existing `capos` R2 bucket, creates the `snap.capos.top` custom domain, and verifies the public endpoints.

Production admin access is enforced by the `CapOS Snap Admin` Cloudflare Access application. It protects `/admin`, `/admin/*`, `/api/admin` and `/api/admin/*`; the Worker also validates the Access JWT audience before serving admin APIs. The public storefront and `/embed` stay outside Access.

The resulting D1 database ID and Access audience ID are not secrets and should be committed after the first production setup.

## R2 uploads

Large Snap files are uploaded as a Cloudflare R2 multipart upload. The browser splits the file into 32 MiB parts and sends authenticated same-origin requests to the Worker; the Worker streams each part into the `ARTIFACTS` R2 binding. This avoids single-request body limits without creating R2 S3 access keys or exposing any storage credential to the browser.

## Caching

Public catalog reads use two cache layers. Canonical catalog responses are cached at Cloudflare for 10 minutes (5 minutes for the featured feed and 2 minutes for searches), while the final aggregated `/api/storefront` and `/api/search` responses use a short Worker Cache API layer of 120 and 60 seconds respectively. Browser caching remains deliberately short at 15 seconds for the storefront and 10 seconds for search results. Responses expose `X-CapOS-Cache: HIT|MISS` for diagnostics.

Administrative endpoints and mutations remain `no-store`; credentials and admin state are never written to the public cache.

After every part is accepted, `/api/admin/packages/finalize` completes the multipart upload, verifies the final object size, and records the local package in D1. Failed uploads are explicitly aborted.
