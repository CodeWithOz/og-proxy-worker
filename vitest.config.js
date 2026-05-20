import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          // Override GIST_URL for tests so wrangler.toml stays production-clean.
          // This value must match TEST_GIST_URL in test/worker.test.js.
          GIST_URL: "https://gist.githubusercontent.com/testuser/abc123/raw/posts.json",
        },
      },
      wrangler: { configPath: "./wrangler.toml" },
    }),
  ],
});
