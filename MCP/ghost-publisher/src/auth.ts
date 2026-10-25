// Single-owner OAuth 2.1 authorization server for the MCP endpoint.
//
// Claude registers itself (Dynamic Client Registration), sends the owner to
// /authorize, the owner enters the passphrase, and Claude gets a short-lived
// access token plus a rotating refresh token. Only redirect URIs on an
// allowlisted host can be registered, so a stranger cannot point a login at
// their own site. PKCE (S256) is enforced by the SDK's token handler.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { ServerConfig } from './config.js';

export const SCOPE = 'ghost:write';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest();
const hashToken = (t: string) => sha256(t).toString('hex');

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

// ---------- persistent state (clients + refresh tokens) ----------

interface RefreshRecord {
  clientId: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}
interface State {
  clients: Record<string, OAuthClientInformationFull>;
  refresh: Record<string, RefreshRecord>; // keyed by sha256(token)
}

class StateStore {
  private state: State = { clients: {}, refresh: {} };
  private file: string;
  private writing: Promise<void> = Promise.resolve();
  constructor(dir: string) {
    this.file = join(dir, 'oauth-state.json');
  }
  async load(): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true });
    try {
      this.state = JSON.parse(await readFile(this.file, 'utf8')) as State;
    } catch {
      this.state = { clients: {}, refresh: {} };
    }
    this.prune();
  }
  get data(): State {
    return this.state;
  }
  prune(): void {
    const now = Date.now() / 1000;
    for (const [k, r] of Object.entries(this.state.refresh)) if (r.expiresAt < now) delete this.state.refresh[k];
    // Keep the client list bounded: DCR registers a fresh client per connection.
    const ids = Object.keys(this.state.clients);
    if (ids.length > 200) {
      ids.sort((a, b) => (this.state.clients[a].client_id_issued_at ?? 0) - (this.state.clients[b].client_id_issued_at ?? 0));
      const live = new Set(Object.values(this.state.refresh).map((r) => r.clientId));
      for (const id of ids.slice(0, ids.length - 200)) if (!live.has(id)) delete this.state.clients[id];
    }
  }
  save(): Promise<void> {
    this.prune();
    const snapshot = JSON.stringify(this.state);
    this.writing = this.writing.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.writing;
  }
}

// ---------- provider ----------

interface PendingCode {
  clientId: string;
  challenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

export class OwnerOAuthProvider implements OAuthServerProvider {
  private codes = new Map<string, PendingCode>();
  private store: StateStore;
  private loginAttempts = new Map<string, { count: number; reset: number }>();

  constructor(private cfg: ServerConfig, private resourceUrl: URL) {
    this.store = new StateStore(cfg.dataDir);
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (id) => this.store.data.clients[id],
      registerClient: async (client) => {
        for (const uri of client.redirect_uris) {
          let u: URL;
          try {
            u = new URL(uri);
          } catch {
            throw new InvalidClientMetadataError(`Invalid redirect_uri ${uri}`);
          }
          const host = u.hostname.toLowerCase();
          const loopback = host === 'localhost' || host === '127.0.0.1';
          if (!this.cfg.allowedRedirectHosts.includes(host)) throw new InvalidClientMetadataError(`redirect_uri host ${host} is not allowed`);
          if (u.protocol !== 'https:' && !loopback) throw new InvalidClientMetadataError('redirect_uri must be https');
        }
        const full = {
          ...client,
          client_id: randomBytes(16).toString('hex'),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        } as OAuthClientInformationFull;
        this.store.data.clients[full.client_id] = full;
        await this.store.save();
        return full;
      },
    };
  }

  // --- authorize: render the owner login page ---

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const payload = {
      c: client.client_id,
      r: params.redirectUri,
      ch: params.codeChallenge,
      s: params.state ?? '',
      sc: params.scopes?.length ? params.scopes : [SCOPE],
      rs: params.resource?.href ?? '',
      e: Math.floor(Date.now() / 1000) + 600,
    };
    const blob = b64url(JSON.stringify(payload));
    const sig = this.sign(`login:${blob}`);
    res.status(200).type('html').set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" })
      .send(loginPage({ clientName: client.client_name || 'MCP client', redirectHost: new URL(params.redirectUri).host, blob, sig }));
  }

  /** POST /login — verifies the passphrase and redirects back with a code. */
  async handleLogin(req: Request, res: Response): Promise<void> {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const a = this.loginAttempts.get(ip);
    if (a && a.reset > now && a.count >= 5) {
      res.status(429).type('text').send('Too many attempts. Try again in 15 minutes.');
      return;
    }
    const { req: blob = '', sig = '', passphrase = '', decision = '' } = (req.body ?? {}) as Record<string, string>;
    if (!blob || !sig || !safeEqual(sig, this.sign(`login:${blob}`))) {
      res.status(400).type('text').send('Invalid or tampered login request. Start again from Claude.');
      return;
    }
    const p = JSON.parse(Buffer.from(blob, 'base64url').toString('utf8')) as { c: string; r: string; ch: string; s: string; sc: string[]; rs: string; e: number };
    if (p.e < now / 1000) {
      res.status(400).type('text').send('This login link expired. Start again from Claude.');
      return;
    }
    const client = this.store.data.clients[p.c];
    if (!client || !client.redirect_uris.includes(p.r)) {
      res.status(400).type('text').send('Unknown client. Start again from Claude.');
      return;
    }
    const back = new URL(p.r);
    if (p.s) back.searchParams.set('state', p.s);
    if (decision === 'deny') {
      back.searchParams.set('error', 'access_denied');
      res.redirect(302, back.href);
      return;
    }
    if (!safeEqual(passphrase, this.cfg.ownerPassphrase)) {
      const cur = a && a.reset > now ? a : { count: 0, reset: now + 15 * 60_000 };
      cur.count += 1;
      this.loginAttempts.set(ip, cur);
      res.status(401).type('html').send(loginPage({ clientName: client.client_name || 'MCP client', redirectHost: back.host, blob, sig, error: 'Incorrect passphrase.' }));
      return;
    }
    this.loginAttempts.delete(ip);
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, { clientId: p.c, challenge: p.ch, redirectUri: p.r, scopes: p.sc, resource: p.rs || undefined, expiresAt: now + 5 * 60_000 });
    back.searchParams.set('code', code);
    res.redirect(302, back.href);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    const c = this.codes.get(code);
    if (!c || c.clientId !== client.client_id || c.expiresAt < Date.now()) throw new InvalidGrantError('Invalid or expired authorization code');
    return c.challenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const c = this.codes.get(code);
    this.codes.delete(code); // single use
    if (!c || c.clientId !== client.client_id || c.expiresAt < Date.now()) throw new InvalidGrantError('Invalid or expired authorization code');
    if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri mismatch');
    if (resource && c.resource && resource.href !== c.resource) throw new InvalidGrantError('resource mismatch');
    return this.issue(client.client_id, c.scopes, c.resource ?? resource?.href);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[]): Promise<OAuthTokens> {
    const key = hashToken(refreshToken);
    const r = this.store.data.refresh[key];
    if (!r || r.clientId !== client.client_id || r.expiresAt < Date.now() / 1000) throw new InvalidGrantError('Invalid or expired refresh token');
    delete this.store.data.refresh[key]; // rotate: old refresh token is now dead
    const granted = scopes?.length ? scopes.filter((s) => r.scopes.includes(s)) : r.scopes;
    return this.issue(client.client_id, granted, r.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const [body, sig] = token.split('.');
    if (!body || !sig || !safeEqual(sig, this.sign(`at:${body}`))) throw new InvalidTokenError('Invalid access token');
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { cid: string; sc: string[]; exp: number; aud?: string };
    if (p.exp < Date.now() / 1000) throw new InvalidTokenError('Access token expired');
    if (!this.store.data.clients[p.cid]) throw new InvalidTokenError('Client no longer registered');
    if (p.aud && p.aud !== this.resourceUrl.href) throw new InvalidTokenError('Token was issued for a different resource');
    return { token, clientId: p.cid, scopes: p.sc, expiresAt: p.exp, resource: p.aud ? new URL(p.aud) : undefined };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const key = hashToken(request.token);
    if (this.store.data.refresh[key]?.clientId === client.client_id) {
      delete this.store.data.refresh[key];
      await this.store.save();
    }
  }

  private async issue(clientId: string, scopes: string[], resource?: string): Promise<OAuthTokens> {
    const exp = Math.floor(Date.now() / 1000) + this.cfg.accessTokenTtlSec;
    const body = b64url(JSON.stringify({ cid: clientId, sc: scopes, exp, aud: resource, n: randomBytes(8).toString('hex') }));
    const access = `${body}.${this.sign(`at:${body}`)}`;
    const refresh = randomBytes(32).toString('base64url');
    this.store.data.refresh[hashToken(refresh)] = { clientId, scopes, resource, expiresAt: Math.floor(Date.now() / 1000) + this.cfg.refreshTokenTtlSec };
    await this.store.save();
    return { access_token: access, token_type: 'Bearer', expires_in: this.cfg.accessTokenTtlSec, refresh_token: refresh, scope: scopes.join(' ') };
  }

  private sign(s: string): string {
    return createHmac('sha256', this.cfg.tokenSecret).update(s).digest('base64url');
  }
}

// ---------- login page ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function loginPage(o: { clientName: string; redirectHost: string; blob: string; sig: string; error?: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorise Ghost publishing</title>
<style>
:root{color-scheme:light dark;--bg:#f6f5f2;--fg:#1d1c1a;--muted:#6b675f;--card:#fff;--line:#dedad2;--accent:#1d1c1a;--accent-fg:#fff;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#ece9e3;--muted:#a19c92;--card:#201f1c;--line:#36342f;--accent:#ece9e3;--accent-fg:#161513;--err:#f2b8b5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:1.25rem;margin:0 0 8px}p{margin:0 0 16px;color:var(--muted)}strong{color:var(--fg)}
label{display:block;font-weight:600;margin-bottom:6px}input[type=password]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--fg);font:inherit}
.row{display:flex;gap:8px;margin-top:16px}button{flex:1;padding:10px;border-radius:8px;border:1px solid var(--line);font:inherit;font-weight:600;cursor:pointer;background:transparent;color:var(--fg)}
button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}.err{color:var(--err);margin:0 0 12px}
</style></head><body><main>
<h1>Authorise Ghost publishing</h1>
<p><strong>${esc(o.clientName)}</strong> is asking to create drafts and, on your approval, publish posts to your Ghost blog. You will be returned to <strong>${esc(o.redirectHost)}</strong>.</p>
${o.error ? `<p class="err">${esc(o.error)}</p>` : ''}
<form method="post" action="login">
<input type="hidden" name="req" value="${esc(o.blob)}"><input type="hidden" name="sig" value="${esc(o.sig)}">
<label for="pp">Owner passphrase</label>
<input id="pp" name="passphrase" type="password" autocomplete="current-password" autofocus>
<div class="row"><button type="submit" name="decision" value="deny" formnovalidate>Deny</button><button class="primary" type="submit" name="decision" value="allow">Authorise</button></div>
</form></main></body></html>`;
}
