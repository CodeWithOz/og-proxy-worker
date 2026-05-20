/**
 * Cloudflare Worker: OG tag proxy for incodethismeans.com
 *
 * Problem: Vercel's bot protection returns HTTP 429 to link preview crawlers
 * (TelegramBot, Discordbot, WhatsApp), so they never see OG meta tags.
 *
 * Fix: Intercept bot UA requests, look up the post slug in a GitHub Gist
 * containing OG metadata, build a minimal HTML shell with those tags, and
 * return it to the crawler. All non-bot requests pass through to Hashnode.
 *
 * When you publish a new post, add one entry to the Gist. That's it.
 *
 * GIST_URL is read from env (set in the Cloudflare dashboard), not hardcoded.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

// Blog-level defaults used when a slug isn't in the Gist (e.g. homepage).
const BLOG_TITLE = "In Code This Means { ... }";
const BLOG_DESCRIPTION = "A blog about software development by Uche Ozoemena.";
const BLOG_URL = "https://incodethismeans.com";

// Bot UA substrings to intercept (lowercase).
const BOT_UA_PATTERNS = [
  "telegrambot",
  "discordbot",
  "whatsapp",
  "twitterbot",
  "facebookexternalhit",
  "linkedinbot",
  "slackbot",
];

// Bucket size (seconds) for the Gist URL cache-buster. Bot hits within the
// same window share an identical URL, so Cloudflare's subrequest cache +
// GitHub's CDN dedupe Gist fetches.
const GIST_CACHE_TTL_SECONDS = 300;

// ─── Gist fetch ───────────────────────────────────────────────────────────────

async function getPostsData(env) {
  // Append a cache-buster so Cloudflare's edge cache doesn't serve stale Gist
  // content (GitHub Gist raw URLs are cached aggressively by CDNs).
  // The bucket changes every GIST_CACHE_TTL_SECONDS seconds, so identical
  // requests within that window share the same CDN-cached response.
  const now = Date.now();
  const url = `${env.GIST_URL}?t=${Math.floor(now / (GIST_CACHE_TTL_SECONDS * 1000))}`;
  const res = await fetch(url);
  if (!res.ok) return {};
  return res.json();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Flow:
 *   request arrives
 *     → isBot(ua)?
 *         yes → extractSlug(pathname)
 *                 → look up slug in Gist data → buildOgShell()
 *         no  → pass through to Hashnode origin unchanged
 */
export default {
  async fetch(request, env) {
    const ua = (request.headers.get("user-agent") || "").toLowerCase();
    const url = new URL(request.url);

    if (isBot(ua)) {
      return handleBotRequest(url, env);
    }

    // Pass-through: forward to Hashnode, preserving path + query + headers + body.
    const passthroughUrl = `https://incodethismeans.com${url.pathname}${url.search}`;
    const newHeaders = new Headers(request.headers);
    newHeaders.set("host", "incodethismeans.com");
    // Buffer the body so it can be forwarded regardless of stream state.
    // GET/HEAD have no body; arrayBuffer() returns an empty buffer for them.
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody ? await request.arrayBuffer() : null;
    return fetch(new Request(passthroughUrl, {
      method: request.method,
      headers: newHeaders,
      body,
      redirect: request.redirect,
    }));
  },
};

// ─── Bot handling ─────────────────────────────────────────────────────────────

function isBot(ua) {
  return BOT_UA_PATTERNS.some((p) => ua.includes(p));
}

async function handleBotRequest(url, env) {
  const slug = extractSlug(url.pathname);

  try {
    const posts = await getPostsData(env);
    const post = slug ? posts[slug] : null;

    if (post) {
      return new Response(buildPostShell(url.href, post), ogHeaders());
    }

    // Homepage or unknown path — use blog-level defaults.
    return new Response(buildBlogShell(url.href), ogHeaders());
  } catch {
    return new Response(minimalFallback(url.href), ogHeaders());
  }
}

/**
 * Extracts a post slug from the pathname.
 * Returns null for the homepage (/) or sub-paths (/tag/foo, /series/foo).
 */
function extractSlug(pathname) {
  const stripped = pathname.replace(/^\//, "").replace(/\/$/, "");
  if (!stripped || stripped.includes("/")) return null;
  return stripped;
}

// ─── HTML shell builders ──────────────────────────────────────────────────────

function buildPostShell(canonicalUrl, post) {
  return htmlShell({
    canonicalUrl,
    title: post.title,
    description: post.description,
    image: post.image || "",
    ogType: "article",
  });
}

function buildBlogShell(canonicalUrl) {
  return htmlShell({
    canonicalUrl,
    title: BLOG_TITLE,
    description: BLOG_DESCRIPTION,
    image: "",
    ogType: "website",
  });
}

function htmlShell({ canonicalUrl, title, description, image, ogType }) {
  const e = escapeHtml;
  const imageTags = image
    ? `\n  <meta property="og:image" content="${e(image)}">
  <meta name="twitter:image" content="${e(image)}">`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${e(title)}</title>
  <link rel="canonical" href="${e(canonicalUrl)}">
  <meta name="description" content="${e(description)}">

  <meta property="og:type" content="${e(ogType)}">
  <meta property="og:url" content="${e(canonicalUrl)}">
  <meta property="og:title" content="${e(title)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:site_name" content="${e(BLOG_TITLE)}">${imageTags}

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${e(title)}">
  <meta name="twitter:description" content="${e(description)}">
</head>
<body></body>
</html>`;
}

function minimalFallback(canonicalUrl) {
  return `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
</head><body></body></html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ogHeaders() {
  return {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
