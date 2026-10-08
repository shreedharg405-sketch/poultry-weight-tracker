export interface Env {
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // If Cloudflare Worker Assets binding is present
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      if (response.status !== 404) {
        return response;
      }
      // Single Page Application (SPA) routing fallback to index.html
      const url = new URL(request.url);
      const indexRequest = new Request(new URL('/', url.origin), request);
      return env.ASSETS.fetch(indexRequest);
    }

    return new Response(
      'Poultry Weight Tracker Cloudflare Worker is active. Configure [assets] in wrangler.toml to serve frontend.',
      {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }
    );
  },
};
