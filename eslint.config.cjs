const jsConfig = require('@eslint/js');
const importPlugin = require('eslint-plugin-import');

module.exports = [
    {
        ignores: ['node_modules', 'schemas/gschemas.compiled'],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            sourceType: 'module',
            ecmaVersion: 2021,
            globals: {
                imports: 'readonly',
                console: 'readonly',
                globalThis: 'readonly',
            },
        },
        plugins: {
            import: importPlugin,
        },
        rules: {
            ...jsConfig.configs.recommended.rules,
            'no-console': 'off',
            'import/no-unresolved': 'off',
        },
    },
];