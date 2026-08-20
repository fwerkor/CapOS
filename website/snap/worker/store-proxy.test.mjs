import assert from 'node:assert/strict';
import worker from './index.ts';

const upstreamRows = [{
  id: 1,
  name: 'Canonical Snap Store',
  api_url: 'https://api.snapcraft.io',
  kind: 'canonical',
  priority: 10,
  enabled: 1,
}];

const env = {
  DEFAULT_VERSION: 'rolling',
  REPO_PUBLIC_BASE: 'https://repo.capos.top',
  STORE_PUBLIC_BASE: 'https://snap.capos.top',
  DB: {
    prepare(sql) {
      assert.match(sql, /version_upstreams/);
      return {
        bind() {
          return { all: async () => ({ results: upstreamRows }) };
        },
      };
    },
  },
  ASSETS: { fetch: async () => new Response('asset') },
  ARTIFACTS: {
    get: async () => null,
    put: async () => ({ key: 'test-cache' }),
  },
};

const pending = [];
const ctx = { waitUntil(promise) { pending.push(Promise.resolve(promise)); } };
const realFetch = globalThis.fetch;
const upstreamRequests = [];

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  upstreamRequests.push(request.clone());
  const url = new URL(request.url);

  if (url.pathname === '/v2/snaps/refresh') {
    return new Response(JSON.stringify({
      results: [{
        result: 'install',
        'instance-key': 'hello-world',
        'snap-id': 'buPKUD3TKqCOgLEjjHx5kSiCpIs5cMuQ',
        name: 'hello-world',
        snap: {
          name: 'hello-world',
          revision: 29,
          version: '6.4',
          download: {
            url: 'https://api.snapcraft.io/api/v1/snaps/download/test.snap',
            size: 20480,
            'sha3-384': 'deadbeef',
          },
        },
        'assertion-stream-urls': [
          'https://api.snapcraft.io/v2/assertions/snap-declaration/16/test-id',
        ],
      }],
    }), { headers: { 'content-type': 'application/json' } });
  }

  if (url.pathname === '/v2/redirect-test') {
    return new Response(null, {
      status: 302,
      headers: { location: 'https://api.snapcraft.io/v2/assertions/account/canonical' },
    });
  }

  if (url.pathname === '/api/v1/snaps/sections') {
    return new Response(JSON.stringify({
      _links: { self: { href: 'http://api.snapcraft.io/api/v1/snaps/sections' } },
      _embedded: { 'clickindex:sections': [] },
    }), { headers: { 'content-type': 'application/json' } });
  }

  if (url.pathname === '/api/v1/snaps/download/test.snap') {
    assert.equal(request.headers.get('range'), 'bytes=0-3');
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 206,
      headers: {
        'content-type': 'application/vnd.snap',
        'content-range': 'bytes 0-3/20480',
      },
    });
  }

  throw new Error(`unexpected upstream request: ${request.method} ${request.url}`);
};

try {
  const actionResponse = await worker.fetch(new Request('https://snap.capos.top/v2/snaps/refresh', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Snap-Device-Series': '16',
      'Snap-Device-Architecture': 'amd64',
    },
    body: JSON.stringify({ context: [], actions: [{ action: 'install', name: 'hello-world', 'instance-key': 'hello-world' }] }),
  }), env, ctx);

  assert.equal(actionResponse.status, 200);
  assert.equal(actionResponse.headers.get('x-capos-store'), 'federated');
  const action = await actionResponse.json();
  const downloadUrl = action.results[0].snap.download.url;
  const assertionUrl = action.results[0]['assertion-stream-urls'][0];
  assert.match(downloadUrl, /^https:\/\/snap\.capos\.top\/download\/upstream\?/);
  assert.match(downloadUrl, /version=rolling/);
  assert.equal(assertionUrl, 'https://snap.capos.top/v2/assertions/snap-declaration/16/test-id');
  assert.ok(!JSON.stringify(action).includes('https://api.snapcraft.io/v2/'));

  const payloadResponse = await worker.fetch(new Request(downloadUrl, {
    headers: { range: 'bytes=0-3' },
  }), env, ctx);
  assert.equal(payloadResponse.status, 206);
  assert.equal(payloadResponse.headers.get('x-capos-store'), 'payload');
  assert.deepEqual([...new Uint8Array(await payloadResponse.arrayBuffer())], [1, 2, 3, 4]);
  await Promise.all(pending);

  const redirectResponse = await worker.fetch(new Request('https://snap.capos.top/v2/redirect-test'), env, ctx);
  assert.equal(redirectResponse.status, 302);
  assert.equal(redirectResponse.headers.get('location'), 'https://snap.capos.top/v2/assertions/account/canonical');

  const sectionsResponse = await worker.fetch(new Request('https://snap.capos.top/api/v1/snaps/sections'), env, ctx);
  assert.equal(sectionsResponse.status, 200);
  const sections = await sectionsResponse.json();
  assert.equal(sections._links.self.href, 'https://snap.capos.top/api/v1/snaps/sections');

  assert.equal(new URL(upstreamRequests[0].url).origin, 'https://api.snapcraft.io');
  assert.equal(upstreamRequests[0].headers.get('Snap-Device-Series'), '16');
  console.log('snap store proxy tests: PASS');
} finally {
  globalThis.fetch = realFetch;
}
