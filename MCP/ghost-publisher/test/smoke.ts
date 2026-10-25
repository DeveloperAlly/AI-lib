// Smoke test against a RUNNING server (container or deployed):
//   SMOKE_BASE=http://localhost:18555 SMOKE_PASSPHRASE='...' npx tsx test/smoke.ts
// Registers a loopback client, completes the owner login + PKCE, lists tools,
// calls check_connection, and verifies a refresh token works. Read-only on Ghost.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { pkce } from './helpers.js';

const base = process.env.SMOKE_BASE!;
const pass = process.env.SMOKE_PASSPHRASE!;
const redirect = 'http://127.0.0.1:45678/callback';

const reg = await (await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'smoke', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) })).json();
const { verifier, challenge } = pkce();
const auth = new URL(`${base}/authorize`);
for (const [k, v] of Object.entries({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource: `${base}/mcp` })) auth.searchParams.set(k, v);
const html = await (await fetch(auth)).text();
const form = new URLSearchParams({ req: /name="req" value="([^"]+)"/.exec(html)![1], sig: /name="sig" value="([^"]+)"/.exec(html)![1], passphrase: pass, decision: 'allow' });
const login = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', body: form });
const code = new URL(login.headers.get('location')!).searchParams.get('code')!;
const tok = await (await fetch(`${base}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: verifier, redirect_uri: redirect, resource: `${base}/mcp` }) })).json();
if (!tok.access_token) throw new Error(`token exchange failed: ${JSON.stringify(tok)}`);
console.log('oauth: ok (access + refresh issued)');

const client = new Client({ name: 'smoke', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${tok.access_token}` } } }));
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const r = await client.callTool({ name: 'check_connection', arguments: {} });
console.log('check_connection:', (r.content as { text: string }[])[0].text.replace(/\s+/g, ' ').slice(0, 200));
await client.close();
if (process.env.SMOKE_REFRESH_OUT) (await import('node:fs')).writeFileSync(process.env.SMOKE_REFRESH_OUT, JSON.stringify({ client_id: reg.client_id, refresh_token: tok.refresh_token }));
