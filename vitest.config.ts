import { defineConfig } from 'vitest/config';

export default defineConfig({
    define: {
        // Mirror the build-time injection so tests can exercise --version output.
        __VERSION__: JSON.stringify('0.0.0-test'),
    },
    test: {
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts'],
            thresholds: {
                lines: 80,
            },
        },
    },
});
