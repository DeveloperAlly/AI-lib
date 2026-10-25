// Environment configuration. Everything is read once at startup and validated,
// so a misconfigured deploy fails fast with a clear message instead of at the
// first tool call.

export interface GhostConfig {
  url: string; // Ghost admin/API base, e.g. https://blog.alisonhaire.com
  adminApiKey: string; // "<24 hex id>:<64 hex secret>"
  apiVersion: string;
}

export interface GitHubConfig {
  token: string;
  repo: string; // "owner/name"
  branch: string;
  postsDir: string;
}

export interface MediaConfig {
  maxBytes: number;
  allowPrivateHosts: boolean; // dev/testing only: lets the fetcher reach localhost/private IPs
}

export interface ServerConfig {
  publicUrl: URL; // e.g. https://blog.mcp.developerally.io
  port: number;
  ownerPassphrase: string;
  tokenSecret: string;
  dataDir: string;
  allowedRedirectHosts: string[];
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
}

const KEY_RE = /^[0-9a-f]{24}:[0-9a-f]{64}$/i;

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required environment variable ${name}`);
  return v.trim();
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

export function loadGhostConfig(): GhostConfig {
  const url = req('GHOST_URL').replace(/\/+$/, '');
  const adminApiKey = req('GHOST_ADMIN_API_KEY');
  if (!KEY_RE.test(adminApiKey)) {
    throw new Error('GHOST_ADMIN_API_KEY must look like <24 hex id>:<64 hex secret> (copy the Admin API key from Ghost Admin > Settings > Integrations)');
  }
  const parsed = new URL(url);
  if (parsed.username || parsed.password) throw new Error('GHOST_URL must not contain credentials');
  return { url, adminApiKey, apiVersion: opt('GHOST_API_VERSION', 'v6.0') };
}

export function loadGitHubConfig(): GitHubConfig | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_REPO?.trim();
  if (!token || !repo) return null;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPO must be owner/name');
  return {
    token,
    repo,
    branch: opt('GITHUB_BRANCH', 'main'),
    postsDir: opt('GITHUB_POSTS_DIR', 'posts').replace(/^\/+|\/+$/g, ''),
  };
}

export function loadMediaConfig(): MediaConfig {
  const mb = Number(opt('MEDIA_MAX_MB', '10'));
  return {
    maxBytes: Math.max(1, Math.min(50, Number.isFinite(mb) ? mb : 10)) * 1024 * 1024,
    allowPrivateHosts: opt('MEDIA_ALLOW_PRIVATE_HOSTS', 'false') === 'true',
  };
}

export function loadServerConfig(): ServerConfig {
  const publicUrl = new URL(req('PUBLIC_URL'));
  const local = ['localhost', '127.0.0.1'].includes(publicUrl.hostname);
  if (publicUrl.protocol !== 'https:' && !local) throw new Error('PUBLIC_URL must be https');
  const ownerPassphrase = req('OWNER_PASSPHRASE');
  if (ownerPassphrase.length < 16) throw new Error('OWNER_PASSPHRASE must be at least 16 characters');
  // Optional: if unset, the server generates one on first start and keeps it in DATA_DIR.
  const tokenSecret = process.env.TOKEN_SECRET?.trim() ?? '';
  if (tokenSecret && tokenSecret.length < 32) throw new Error('TOKEN_SECRET must be at least 32 characters (or leave it unset to auto-generate)');
  return {
    publicUrl,
    port: Number(opt('PORT', '8080')),
    ownerPassphrase,
    tokenSecret,
    dataDir: opt('DATA_DIR', './data'),
    allowedRedirectHosts: opt('ALLOWED_REDIRECT_HOSTS', 'claude.ai,claude.com,localhost,127.0.0.1')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    accessTokenTtlSec: Number(opt('ACCESS_TOKEN_TTL_SEC', '3600')),
    refreshTokenTtlSec: Number(opt('REFRESH_TOKEN_TTL_SEC', String(30 * 24 * 3600))),
  };
}
