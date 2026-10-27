import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'offscreen',
    include: ['tests/**/*.test.ts'],
  },
});
