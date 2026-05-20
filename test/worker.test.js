/**
 * Tests for the OG-proxy Cloudflare Worker.
 *
 * Run with:  npx vitest run
 *
 * These tests use @cloudflare/vitest-pool-workers, which executes inside a
 * real workerd instance.  SELF is the bound worker under test.
 * vi.stubGlobal('fetch', ...) patches the global fetch that the worker calls
 * for Gist lookups and pass-through requests.
 */

import { SELF } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_GIST_URL = "https://gist.githubusercontent.com/testuser/abc123/raw/posts.json";

/**
 * Shape: { [slug]: { title, description, image? } }
 * Mirrors what the worker reads from the Gist.
 */
const POSTS_FIXTURE = {
  "understanding-closures": {
    title: "Understanding Closures in JavaScript",
    description: "A deep dive into how closures work under the hood.",
    image: "https://cdn.hashnode.com/res/hashnode/image/upload/closures.png",
  },
  "async-await-guide": {
    title: "The Complete Guide to async/await",
    description: "Master asynchronous JavaScript with async and await.",
    // intentionally no image field
  },
  "special-chars-post": {
    title: 'Post with <Special> "Chars" & More',
    description: 'Description with <b>HTML</b> & "quotes" > here',
    image: "https://cdn.hashnode.com/image/special.png",
  },
};

/** Returns a fetch stub that serves POSTS_FIXTURE for any Gist URL. */
function makeGistFetch(posts = POSTS_FIXTURE) {
  return vi.fn((url, _init) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes("gist.githubusercontent.com")) {
      return Promise.resolve(
        new Response(JSON.stringify(posts), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    // Pass-through or unknown — return a generic upstream response.
    return Promise.resolve(new Response("upstream", { status: 200 }));
  });
}

/** Returns a fetch stub whose Gist fetch fails with a network error. */
function makeGistFetchThrows() {
  return vi.fn((url, _init) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes("gist.githubusercontent.com")) {
      return Promise.reject(new Error("network failure"));
    }
    return Promise.resolve(new Response("upstream", { status: 200 }));
  });
}

/** Returns a fetch stub whose Gist fetch responds with a non-OK status. */
function makeGistFetchNonOk() {
  return vi.fn((url, _init) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes("gist.githubusercontent.com")) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(new Response("upstream", { status: 200 }));
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function botRequest(path, ua = "TelegramBot (like TwitterBot)", extra = {}) {
  return new Request(`https://incodethismeans.com${path}`, {
    method: "GET",
    headers: { "user-agent": ua, ...extra.headers },
    ...extra,
  });
}

function humanRequest(path, method = "GET") {
  return new Request(`https://incodethismeans.com${path}`, {
    method,
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── 1. Bot detection ──────────────────────────────────────────────────────────

describe("bot detection", () => {
  it("routes TelegramBot UA through the bot path (returns HTML)", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/", "TelegramBot (like TwitterBot)"));
    const text = await res.text();
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(text).toContain("<!DOCTYPE html>");
  });

  it("routes Discordbot UA through the bot path", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/", "Discordbot/2.0; +https://discordapp.com"));
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");
  });

  it("routes WhatsApp UA through the bot path", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/", "WhatsApp/2.21.11 A"));
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");
  });

  it("passes through a standard browser UA without returning OG HTML", async () => {
    const mockFetch = vi.fn(() => Promise.resolve(new Response("upstream", { status: 200 })));
    vi.stubGlobal("fetch", mockFetch);
    const res = await SELF.fetch(humanRequest("/some-post"));
    // fetch must have been called exactly once (the pass-through), not twice
    // (which would indicate a Gist lookup happened).
    const calls = mockFetch.mock.calls;
    const gistCall = calls.find(([u]) => {
      const urlStr = typeof u === "string" ? u : u instanceof URL ? u.href : u.url;
      return urlStr.includes("gist");
    });
    expect(gistCall).toBeUndefined();
    // The worker must not have returned OG HTML.
    const text = await res.text();
    expect(text).not.toContain('<meta property="og:type"');
  });

  it("is case-insensitive for UA matching (mixed-case TELEGRAMBOT)", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/", "TELEGRAMBOT UPPERCASE"));
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");
  });
});

// ── 2. Slug extraction ────────────────────────────────────────────────────────

describe("slug extraction", () => {
  it("/ produces a blog-default shell (og:type=website)", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/"));
    const text = await res.text();
    expect(text).toContain('content="website"');
  });

  it("/my-post resolves the slug and uses post data if present", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    expect(text).toContain('content="article"');
    expect(text).toContain("Understanding Closures in JavaScript");
  });

  it("/my-post/ (trailing slash) resolves the same slug as /my-post", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/understanding-closures/"));
    const text = await res.text();
    expect(text).toContain('content="article"');
    expect(text).toContain("Understanding Closures in JavaScript");
  });

  it("/tag/foo is treated as a sub-path and produces a blog-default shell", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/tag/javascript"));
    const text = await res.text();
    expect(text).toContain('content="website"');
  });
});

// ── 3. Post shell content ──────────────────────────────────────────────────────

describe("post shell", () => {
  it("contains og:type=article for a known post slug", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    expect(text).toContain('<meta property="og:type" content="article">');
  });

  it("contains og:title matching the post title", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    expect(text).toContain(
      `<meta property="og:title" content="Understanding Closures in JavaScript">`
    );
  });

  it("contains og:description matching the post description", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    expect(text).toContain(
      `<meta property="og:description" content="A deep dive into how closures work under the hood.">`
    );
  });

  it("contains twitter:title and twitter:description matching the post", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    expect(text).toContain(
      `<meta name="twitter:title" content="Understanding Closures in JavaScript">`
    );
    expect(text).toContain(
      `<meta name="twitter:description" content="A deep dive into how closures work under the hood.">`
    );
  });

  it("contains a canonical link tag pointing to the request URL", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    expect(text).toContain(
      `<link rel="canonical" href="https://incodethismeans.com/understanding-closures">`
    );
  });

  it("contains og:url equal to the request URL", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    expect(text).toContain(
      `<meta property="og:url" content="https://incodethismeans.com/understanding-closures">`
    );
  });
});

// ── 4. Blog shell content ──────────────────────────────────────────────────────

describe("blog shell", () => {
  it("contains og:type=website on the homepage", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/"));
    const text = await res.text();
    expect(text).toContain('<meta property="og:type" content="website">');
  });

  it("contains the blog-level title on the homepage", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/"));
    const text = await res.text();
    // BLOG_TITLE from worker.js
    expect(text).toContain("In Code This Means");
  });

  it("contains the blog-level description on the homepage", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/"));
    const text = await res.text();
    expect(text).toContain("A blog about software development by Uche Ozoemena");
  });

  it("returns blog shell for an unknown slug (slug not in posts data)", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/this-slug-does-not-exist"));
    const text = await res.text();
    expect(text).toContain('content="website"');
  });
});

// ── 5. Image-tag conditional ──────────────────────────────────────────────────

describe("image tags", () => {
  it("emits og:image and twitter:image when the post has an image field", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    expect(text).toContain(
      `<meta property="og:image" content="https://cdn.hashnode.com/res/hashnode/image/upload/closures.png">`
    );
    expect(text).toContain(
      `<meta name="twitter:image" content="https://cdn.hashnode.com/res/hashnode/image/upload/closures.png">`
    );
  });

  it("omits og:image and twitter:image when the post has no image field", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/async-await-guide"));
    const text = await res.text();
    expect(text).not.toContain('<meta property="og:image"');
    expect(text).not.toContain('<meta name="twitter:image"');
  });

  it("uses twitter:card=summary_large_image when the post has an image", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    expect(text).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it("uses twitter:card=summary when the post has no image", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/async-await-guide"));
    const text = await res.text();
    expect(text).toContain('<meta name="twitter:card" content="summary">');
  });

  it("uses twitter:card=summary for the blog shell (no image)", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/"));
    const text = await res.text();
    expect(text).toContain('<meta name="twitter:card" content="summary">');
  });
});

// ── 6. Gist fetch failure → minimalFallback ───────────────────────────────────

describe("gist fetch failure", () => {
  it("returns status 200 when gist fetch throws a network error", async () => {
    vi.stubGlobal("fetch", makeGistFetchThrows());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    expect(res.status).toBe(200);
  });

  it("returns valid HTML with a canonical tag when gist fetch throws", async () => {
    vi.stubGlobal("fetch", makeGistFetchThrows());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");
    expect(text).toContain('<link rel="canonical"');
  });

  it("returns status 200 when gist fetch returns 404", async () => {
    vi.stubGlobal("fetch", makeGistFetchNonOk());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    expect(res.status).toBe(200);
  });

  it("returns a blog shell (not minimal fallback) when gist returns 404 (non-OK → empty posts)", async () => {
    vi.stubGlobal("fetch", makeGistFetchNonOk());
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    const text = await res.text();
    // Non-OK fetch returns {}, so slug is not found → blog shell
    expect(text).toContain('<meta property="og:type"');
  });
});

// ── 7. HTML escaping ──────────────────────────────────────────────────────────

describe("HTML escaping", () => {
  it("escapes < > & \" in the post title within og:title", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/special-chars-post"));
    const text = await res.text();
    // Raw title: 'Post with <Special> "Chars" & More'
    expect(text).toContain(
      `content="Post with &lt;Special&gt; &quot;Chars&quot; &amp; More"`
    );
  });

  it("escapes HTML characters in the post description", async () => {
    vi.stubGlobal("fetch", makeGistFetch());
    const res = await SELF.fetch(botRequest("/special-chars-post"));
    const text = await res.text();
    // Raw: 'Description with <b>HTML</b> & "quotes" > here'
    expect(text).toContain("&lt;b&gt;HTML&lt;/b&gt;");
    expect(text).toContain("&amp;");
    expect(text).toContain("&gt;");
  });
});

// ── 8. Malformed Gist entry guard ─────────────────────────────────────────────

describe("malformed Gist entry guard", () => {
  it("falls back to blog-level defaults when title and description are missing from the post entry", async () => {
    const postsWithMissingFields = {
      "incomplete-post": {
        // title and description intentionally omitted
        image: "",
      },
    };
    vi.stubGlobal("fetch", makeGistFetch(postsWithMissingFields));
    const res = await SELF.fetch(botRequest("/incomplete-post"));
    const text = await res.text();
    // Must not contain the literal string "undefined"
    expect(text).not.toContain(">undefined<");
    expect(text).not.toContain('content="undefined"');
    // Must contain blog-level defaults
    expect(text).toContain("In Code This Means");
    expect(text).toContain("A blog about software development by Uche Ozoemena");
  });
});

// ── 9. GIST_URL is read from env, not a const ────────────────────────────────

describe("env.GIST_URL", () => {
  it("fetches from the URL provided in env.GIST_URL, not a hardcoded constant", async () => {
    const mockFetch = makeGistFetch();
    vi.stubGlobal("fetch", mockFetch);

    // The worker under test is loaded via SELF (bound from wrangler.toml [vars]).
    // The TEST_GIST_URL must be set there, or the worker must be called with
    // env.GIST_URL = TEST_GIST_URL.  Phase 2 should set vars.GIST_URL in the
    // test wrangler.toml to TEST_GIST_URL so this assertion holds.
    const res = await SELF.fetch(botRequest("/understanding-closures"));
    await res.text(); // consume body

    const gistCalls = mockFetch.mock.calls.filter(([u]) => {
      const urlStr = typeof u === "string" ? u : u instanceof URL ? u.href : u.url;
      return urlStr.includes("gist.githubusercontent.com");
    });

    expect(gistCalls.length).toBeGreaterThan(0);

    // The URL fetched must start with the value in env.GIST_URL (TEST_GIST_URL),
    // not the old hardcoded placeholder URL.
    const fetchedUrl = (() => {
      const u = gistCalls[0][0];
      return typeof u === "string" ? u : u instanceof URL ? u.href : u.url;
    })();
    expect(fetchedUrl).toMatch(
      new RegExp(`^${TEST_GIST_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
  });
});

// ── 9. Pass-through ────────────────────────────────────────────────────────────

describe("pass-through for non-bot requests", () => {
  it("fetches https://incodethismeans.com{path} for a GET request", async () => {
    const mockFetch = vi.fn(() => Promise.resolve(new Response("upstream", { status: 200 })));
    vi.stubGlobal("fetch", mockFetch);

    await SELF.fetch(humanRequest("/some-post"));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledArg] = mockFetch.mock.calls[0];
    const calledUrl =
      calledArg instanceof Request
        ? calledArg.url
        : typeof calledArg === "string"
        ? calledArg
        : calledArg.href;
    expect(calledUrl).toBe("https://incodethismeans.com/some-post");
  });

  it("preserves the query string in the pass-through URL", async () => {
    const mockFetch = vi.fn(() => Promise.resolve(new Response("upstream", { status: 200 })));
    vi.stubGlobal("fetch", mockFetch);

    await SELF.fetch(humanRequest("/some-post?ref=twitter"));

    const [calledArg] = mockFetch.mock.calls[0];
    const calledUrl =
      calledArg instanceof Request
        ? calledArg.url
        : typeof calledArg === "string"
        ? calledArg
        : calledArg.href;
    expect(calledUrl).toBe("https://incodethismeans.com/some-post?ref=twitter");
  });

  it("preserves the HTTP method and body in the pass-through request", async () => {
    let capturedBody = null;
    const mockFetch = vi.fn(async (input) => {
      if (input instanceof Request) {
        capturedBody = await input.text();
      }
      return new Response("upstream", { status: 200 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const payload = JSON.stringify({ name: "test" });
    const req = new Request("https://incodethismeans.com/contact", {
      method: "POST",
      headers: { "user-agent": "Mozilla/5.0", "content-type": "application/json" },
      body: payload,
    });
    await SELF.fetch(req);

    const [calledArg] = mockFetch.mock.calls[0];
    const method =
      calledArg instanceof Request ? calledArg.method : "GET";
    expect(method).toBe("POST");
    expect(capturedBody).toBe(payload);
  });
});
