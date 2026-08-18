# CapOS Snap Store

`snap.capos.top` combines three surfaces in one Cloudflare Worker deployment:

- a public, App Store-style catalog for CapOS users;
- Snap Store compatible `/v2/*` federation endpoints and proxied upstream downloads;
- a PIN-protected `/admin` console for repository versions, upstream order, local packages and CapOS metadata.

## Architecture

- **Cloudflare Worker**: API, authentication, upstream federation and streaming proxy.
- **D1**: repository versions, ordered upstreams, local Snap metadata, sessions and audit log.
- **Backblaze B2 / `repo.capos.top`**: local artifacts only, at `/<version>/snaps/*.snap`.
- **Canonical/other upstreams**: queried in priority order. Their Snap downloads are proxied in real time and are not copied into B2.

Resolution order is always `local > upstream[0] > upstream[1] > ...` for a repository version.

## Local development

Use Node.js 22 or newer.

```sh
npm install
npm run dev
```

Vite development mode uses representative catalog/admin data so the UI can be developed without production credentials. Any non-empty PIN unlocks the local admin preview.

## Production setup

1. Create the D1 database and replace the placeholder `database_id` in `wrangler.toml`.
2. Apply `migrations/0001_init.sql` with `npm run db:migrate:remote`.
3. Set `B2_ENDPOINT` and, if needed, `B2_REGION` as Worker variables.
4. Add Worker secrets:
   - `SESSION_SECRET`: a long random value;
   - `ADMIN_PIN_HASH`: SHA-256 hex of `<PIN>:<SESSION_SECRET>`;
   - `B2_KEY_ID` and `B2_APPLICATION_KEY`: credentials restricted to the CapOS repository bucket.
5. Deploy with `npm run deploy` and route `snap.capos.top` to the Worker.

Generate the administrator hash without putting the PIN into the repository:

```sh
node -e "const c=require('crypto'); const pin=process.env.PIN; const secret=process.env.SESSION_SECRET; console.log(c.createHash('sha256').update(pin+':'+secret).digest('hex'))"
```

The admin session is an HttpOnly/Secure/SameSite=Strict cookie. Five failed PIN attempts from one IP lock authentication for 15 minutes.

## B2 uploads

The browser never uploads a Snap through the Worker. `/api/admin/packages/upload-url` creates a short-lived AWS SigV4 presigned `PUT` URL for B2's S3-compatible endpoint; after upload, `/api/admin/packages/finalize` records the local package in D1.

No B2 secrets are sent to the browser.
