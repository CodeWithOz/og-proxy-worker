# og-proxy-worker

A Cloudflare Worker that intercepts link-preview bot requests to incodethismeans.com and returns
minimal OG-tag HTML shells sourced from a GitHub Gist. The problem it solves: Vercel's bot
protection returns HTTP 429 to preview crawlers (Telegram, Discord, WhatsApp, etc.), so those
crawlers never see OG meta tags. Non-bot traffic is passed through to the Hashnode origin unchanged.

## How it works

```
Request arrives
  │
  ├─ Bot UA? ──yes──► fetch Gist (posts.json)
  │                       │
  │                       ├─ slug found  ──► post OG shell  (og:type=article)
  │                       └─ slug missing ──► blog OG shell (og:type=website)
  │
  └─ Non-bot ──────────────────────────────► pass-through to Hashnode
                                             (method + headers + body preserved)
```

Bot UA patterns matched (case-insensitive substring): `telegrambot`, `discordbot`, `whatsapp`,
`twitterbot`, `facebookexternalhit`, `linkedinbot`, `slackbot`.

## Setup

```
npm install
```

### Create and point to a Gist

1. Create a public GitHub Gist with a file named `posts.json`.
2. Open the raw view and copy the URL — it looks like:
   ```
   https://gist.githubusercontent.com/{user}/{gist-id}/raw/posts.json
   ```
3. This URL goes into the Cloudflare dashboard (see Deployment below), not the repo.

### posts.json shape

```json
{
  "post-slug": {
    "title": "Post Title",
    "description": "One-sentence description.",
    "image": "https://cdn.example.com/cover.png"
  }
}
```

`image` is optional. When omitted, `og:image` and `twitter:image` tags are not emitted.
The key must match the URL slug exactly (e.g. `understanding-closures` for `/understanding-closures`).

## Local development

```
npm run dev
```

Starts wrangler dev at http://localhost:8787.

To exercise the bot path:

```
curl -A "TelegramBot" http://localhost:8787/your-post-slug
```

To override `GIST_URL` locally, create a `.dev.vars` file in the project root (this file is
gitignored):

```
GIST_URL="https://gist.githubusercontent.com/{user}/{id}/raw/posts.json"
```

## Testing

```
npm test           # run all 31 tests once
npm run test:watch # watch mode
```

Tests use `@cloudflare/vitest-pool-workers` and run inside a real workerd instance. The
`GIST_URL` binding is overridden in `vitest.config.js` so the repo never contains a real Gist URL.

## Deployment (Cloudflare Workers Builds, GitHub-connected)

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: Workers & Pages → Create → Connect to Git → pick this repo.
   Cloudflare auto-detects `wrangler.toml` and builds on every push to `main`.
3. **Set the real Gist URL**: Workers & Pages → og-proxy-worker → Settings → Variables and
   Secrets → add `GIST_URL` with your real Gist raw URL. This overrides the placeholder in
   `wrangler.toml`.
4. Add a custom route (Workers & Pages → og-proxy-worker → Settings → Triggers) matching your
   blog's hostname, or use the generated `*.workers.dev` subdomain for testing.

## Updating OG data

Edit `posts.json` in the Gist. Changes propagate within ~5 minutes (the cache-buster TTL window).
No redeploy needed.

## Adding a new bot UA

Append to `BOT_UA_PATTERNS` in `src/worker.js`. Patterns are matched as case-insensitive
substrings of the lowercased `User-Agent` header.
