#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() {
  printf '\n==> %s\n' "$1"
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required." >&2
  exit 1
fi

say "Checking Cloudflare authentication"
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "Wrangler is not authenticated. A browser authorization flow will open now."
  npx wrangler login --device
fi
npx wrangler whoami

say "Resolving the production D1 database"
DB_JSON="$(npx wrangler d1 list --json)"
DB_ID="$(printf '%s' "$DB_JSON" | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  const rows=JSON.parse(s); const row=rows.find(x=>x.name==="capos-snap-store");
  if(row) process.stdout.write(row.uuid || row.id || "");
});
')"

if [[ -z "$DB_ID" ]]; then
  echo "Creating capos-snap-store in the Asia-Pacific region..."
  npx wrangler d1 create capos-snap-store --location apac
  DB_JSON="$(npx wrangler d1 list --json)"
  DB_ID="$(printf '%s' "$DB_JSON" | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  const rows=JSON.parse(s); const row=rows.find(x=>x.name==="capos-snap-store");
  if(row) process.stdout.write(row.uuid || row.id || "");
});
')"
fi

if [[ -z "$DB_ID" ]]; then
  echo "Unable to determine the D1 database ID." >&2
  exit 1
fi

node - "$DB_ID" <<'NODE'
const fs = require('fs');
const id = process.argv[2];
const path = 'wrangler.toml';
let text = fs.readFileSync(path, 'utf8');
const pattern = /(database_name\s*=\s*"capos-snap-store"[\s\S]*?database_id\s*=\s*")[^"]+(\")/;
if (!pattern.test(text)) throw new Error('Could not locate capos-snap-store database_id in wrangler.toml');
text = text.replace(pattern, `$1${id}$2`);
fs.writeFileSync(path, text);
NODE

echo "D1 database: $DB_ID"

say "Applying D1 migrations"
npx wrangler d1 migrations apply capos-snap-store --remote

say "Preparing administrator credentials"
read -rsp "Choose the administrator PIN: " ADMIN_PIN
echo
read -rsp "Confirm the administrator PIN: " ADMIN_PIN_CONFIRM
echo
if [[ -z "$ADMIN_PIN" || "$ADMIN_PIN" != "$ADMIN_PIN_CONFIRM" ]]; then
  echo "PINs did not match or were empty." >&2
  exit 1
fi

SESSION_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
ADMIN_PIN_HASH="$(PIN="$ADMIN_PIN" SECRET="$SESSION_SECRET" node -e 'console.log(require("crypto").createHash("sha256").update(process.env.PIN+":"+process.env.SECRET).digest("hex"))')"
unset ADMIN_PIN ADMIN_PIN_CONFIRM

SECRETS_FILE="$(mktemp)"
trap 'rm -f "$SECRETS_FILE"' EXIT
chmod 600 "$SECRETS_FILE"
SESSION_SECRET="$SESSION_SECRET" ADMIN_PIN_HASH="$ADMIN_PIN_HASH" node >"$SECRETS_FILE" <<'NODE'
process.stdout.write(JSON.stringify({
  SESSION_SECRET: process.env.SESSION_SECRET,
  ADMIN_PIN_HASH: process.env.ADMIN_PIN_HASH,
}));
NODE

say "Building the Snap Store"
npm ci --no-audit --no-fund
npm run build

say "Deploying capos-snap"
npx wrangler deploy --secrets-file "$SECRETS_FILE"

if [[ "${SKIP_VERIFY:-0}" != "1" ]]; then
  say "Verifying public endpoints"
  node <<'NODE'
const endpoints = [
  'https://snap.capos.top/',
  'https://snap.capos.top/api/storefront',
];
(async () => {
  for (const url of endpoints) {
    let last;
    for (let i = 0; i < 12; i++) {
      try {
        const response = await fetch(url, { redirect: 'follow' });
        last = `${response.status} ${response.statusText}`;
        if (response.ok) {
          console.log(`OK  ${url} -> ${last}`);
          last = null;
          break;
        }
      } catch (error) {
        last = error.message;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (last) {
      console.error(`WARN ${url} -> ${last}`);
      process.exitCode = 2;
    }
  }
})();
NODE
fi

cat <<EOF

Production setup is complete.

  Store:  https://snap.capos.top/
  Admin:  https://snap.capos.top/admin
  D1 ID:  $DB_ID

The generated SESSION_SECRET and PIN hash were uploaded directly to Cloudflare and were not saved in the repository.
The D1 database ID was written to website/snap/wrangler.toml; it is not a secret and should be committed.
EOF
