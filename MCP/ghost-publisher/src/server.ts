// HTTP entry point: OAuth endpoints + protected Streamable HTTP MCP endpoint.

import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { rateLimit } from 'express-rate-limit';
import { loadGhostConfig, loadGitHubConfig, loadMediaConfig, loadServerConfig } from './config.js';
import { OwnerOAuthProvider, SCOPE } from './auth.js';
import { Ghost } from './ghost.js';
import { GitHubRepo } from './github.js';
import { registerTools } from './tools.js';

const VERSION = '0.1.0';

export async function createApp() {
  const cfg = loadServerConfig();
  const ghost = new Ghost(loadGhostConfig());
  const ghCfg = loadGitHubConfig();
  const github = ghCfg ? new GitHubRepo(ghCfg) : null;
  const media = loadMediaConfig();

  const mcpUrl = new URL('/mcp', cfg.publicUrl);
  const provider = new OwnerOAuthProvider(cfg, mcpUrl);
  await provider.init();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Sliplane terminates TLS in front of the container

  // Health check before host validation: Sliplane probes the container directly.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: VERSION });
  });

  app.use(hostHeaderValidation([cfg.publicUrl.hostname]));

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(cfg.publicUrl.origin),
      resourceServerUrl: mcpUrl,
      scopesSupported: [SCOPE],
      resourceName: 'Ghost publisher',
    }),
  );

  app.post('/login', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }), express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
    void provider.handleLogin(req, res);
  });

  const auth = requireBearerAuth({
    verifier: provider,
    requiredScopes: [SCOPE],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });

  // Stateless Streamable HTTP: a fresh server + transport per request.
  app.post('/mcp', auth, express.json({ limit: '25mb' }), async (req: Request, res: Response) => {
    const server = new McpServer({ name: 'ghost-publisher', version: VERSION });
    registerTools(server, { ghost, media, github });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('MCP request failed', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  };
  app.get('/mcp', auth, notAllowed);
  app.delete('/mcp', auth, notAllowed);

  return { app, cfg, github };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createApp()
    .then(({ app, cfg, github }) => {
      app.listen(cfg.port, '0.0.0.0', () => {
        console.log(`ghost-publisher-mcp ${VERSION} listening on :${cfg.port}; MCP endpoint ${new URL('/mcp', cfg.publicUrl).href}; GitHub mirror ${github ? 'on' : 'off'}`);
      });
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
