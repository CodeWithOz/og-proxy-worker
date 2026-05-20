# AGENTS.md

Small Cloudflare Worker, plain JS (no TypeScript), tested with vitest + @cloudflare/vitest-pool-workers.

## Entry point

`src/worker.js` exports a default `{ fetch(request, env) }`.
`env.GIST_URL` is the only environment binding — it points to a GitHub Gist raw URL
that serves the OG metadata JSON for all posts.

## Conventions

- Plain ES modules; `"type": "module"` in package.json.
- No transpilation, no build step. Wrangler bundles automatically on deploy.
- Tests live in `test/`. Use vitest + `@cloudflare/vitest-pool-workers`. Do not use
  `vitest-environment-miniflare` or other older patterns.
- `GIST_URL` for tests is overridden via `miniflare.bindings` in `vitest.config.js`.
  Keep that value in sync with `TEST_GIST_URL` at the top of `test/worker.test.js`.
- Do not introduce a module-level in-memory cache for the Gist response. The URL-bucket
  cache-buster + Cloudflare's subrequest cache already dedupe within the TTL window, and
  shared isolate state breaks vitest's test isolation.

## What NOT to commit

- `.dev.vars` (local env overrides — already gitignored)
- Real Gist URLs. The placeholder in `wrangler.toml` is intentional; the real value lives
  in the Cloudflare dashboard (Settings → Variables and Secrets).
- Cloudflare account IDs or API tokens.

## Image proxy (`/_img`)

The `/_img?url=<encoded>` route runs **before** bot detection — every UA hits it.
`proxyImage()` validates the URL, checks the origin against `ALLOWED_IMAGE_ORIGINS`, fetches
the upstream image, and streams it back with `cache-control: public, max-age=86400`.

`ALLOWED_IMAGE_ORIGINS` holds full HTTPS origins (e.g. `"https://cdn.hashnode.com"`). The
scheme is part of the check and is load-bearing: including it prevents `javascript:` and
`file:` SSRF bypasses. Only add HTTPS origins to this list.

`proxyImageUrl(requestUrl, rawImageUrl)` rewrites a raw CDN URL into a `/_img` proxy URL.
It is called inside `buildPostShell` so that `og:image` tags in bot shells point through the
worker rather than directly to the CDN.

**Add a new allowed image origin**
Append `"https://<hostname>"` to `ALLOWED_IMAGE_ORIGINS` at the top of `src/worker.js`.

## Common workflows

**Add a bot UA**
Append a lowercase substring to `BOT_UA_PATTERNS` in `src/worker.js`.

**Change blog-level defaults** (title, description, URL shown when no post slug matches)
Edit `BLOG_TITLE`, `BLOG_DESCRIPTION`, `BLOG_URL` at the top of `src/worker.js`.

**Change pass-through behavior**
The non-bot branch forwards `method + headers + body` to Hashnode. Body is read with
`request.arrayBuffer()` before constructing the outgoing `Request`. Preserve this pattern
for any non-GET method support — dropping it silently discards POST/PUT bodies.

**Add a new post to OG data**
Edit `posts.json` in the GitHub Gist (no redeploy needed). Shape:
`{ "slug": { "title": "...", "description": "...", "image": "https://..." } }` — `image` optional.

## Tests

```
npm test
```

31 tests as of this writing. New behavior must come with a test. All 31 must pass before merging.
