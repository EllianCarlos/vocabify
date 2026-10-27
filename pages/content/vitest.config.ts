import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'content-script',
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
