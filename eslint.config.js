import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
    // Globally ignored files
    {
        ignores: ["node_modules/", "dist/"],
    },

    // Base config for JS files
    ...tseslint.configs.recommended,

    // Configuration for all TypeScript files in the project
    {
        files: ["src/**/*.ts"],
        extends: [...tseslint.configs.recommendedTypeChecked],
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
        files: [
            "src/server.ts",
            "src/bot.ts",
            "src/testEnvironment.ts",
            "src/events.ts",
            "check-db.js",
            "test-users.js",
            "webpack.config.js",
        ],
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
    },

    // Disable ESLint rules that conflict with Prettier
    eslintConfigPrettier
);