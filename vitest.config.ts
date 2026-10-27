import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    workspace: ['packages/*', 'pages/content', 'pages/offscreen'],
    coverage: {
      reporter: ['text', 'json-summary', 'json', 'html'],
      reportOnFailure: true,
    },
  },
});
