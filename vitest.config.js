import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // envFile is loaded into process.env BEFORE any user modules are imported,
        // so env.js validation doesn't throw during test collection.
        envFile: '.env',
        // Look for tests in the tests/ directory
        include: ['tests/**/*.test.js'],
        // Run test files sequentially to avoid DB state conflicts
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        // Sensible timeout for DB operations
        testTimeout: 15_000,
    },
});
