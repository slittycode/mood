import tseslint from 'typescript-eslint';

export default tseslint.config(
    ...tseslint.configs.recommended,
    {
        rules: {
            // Explicit any is banned; use unknown + narrowing.
            '@typescript-eslint/no-explicit-any': 'error',
            // Require explicit return types on exported functions.
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            // Allow _-prefixed names to signal intentionally unused vars/params.
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        // Test files: relax a few strict rules where vi.fn() typing requires casts.
        files: ['**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
);
