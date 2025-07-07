import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
    // Globally ignored files
    {
        ignores: ["node_modules/", "dist/"],
    },

    // Base recommended configs for type-checked linting
    ...tseslint.configs.recommendedTypeChecked,

    // Disable ESLint rules that conflict with Prettier
    eslintConfigPrettier,

    // Configuration for all TypeScript files in the project
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parserOptions: {
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // It's good practice to be explicit about module boundaries
            "@typescript-eslint/explicit-module-boundary-types": "warn",
            // Allow `any` but with a warning to encourage better typing
            "@typescript-eslint/no-explicit-any": "warn",
            // Allow non-null assertions, as they can be useful in a controlled way
            "@typescript-eslint/no-non-null-assertion": "off",
            // Warn about unused variables instead of ignoring them
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            // Enforce consistent type imports for better code organization
            "@typescript-eslint/consistent-type-imports": "error",
        },
    },

    // Environment-specific configurations
    {
        files: ["src/server.ts", "src/bot.ts", "src/testEnvironment.ts", "src/events.ts"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: ["src/client.ts"],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
        },
    }
);