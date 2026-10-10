import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// docs/CONVENTIONS.md. Prettier owns layout; these own naming and shape.
const conventions = {
	'@typescript-eslint/no-explicit-any': 'error',
	'@typescript-eslint/consistent-type-imports': 'error',
	'id-length': ['error', { min: 2, properties: 'never', exceptions: ['_'] }],
	curly: ['error', 'multi-line'],
	'one-var': ['error', 'never'],
	'no-nested-ternary': 'error',
	'max-statements-per-line': ['error', { max: 1 }],
	// Exported type declarations belong in types/ (docs/CONVENTIONS.md §1.2).
	'no-restricted-syntax': [
		'error',
		{
			selector: 'ExportNamedDeclaration > TSTypeAliasDeclaration',
			message: 'Exported types live in types/ (docs/CONVENTIONS.md §1.2).'
		},
		{
			selector: 'ExportNamedDeclaration > TSInterfaceDeclaration',
			message: 'Exported interfaces live in types/ (docs/CONVENTIONS.md §1.2).'
		}
	]
};

// Type-aware: the `no-unsafe-*` family surfaces the hidden `any` (JSON.parse, file reads)
// that never says the word.
export default tseslint.config(
	{ ignores: ['**/node_modules', 'out'] },
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	prettier,
	{
		languageOptions: {
			globals: { ...globals.node },
			parserOptions: {
				projectService: { allowDefaultProject: ['*.js'] },
				tsconfigRootDir: import.meta.dirname
			}
		}
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
			...conventions
		}
	},
	{
		files: ['types/**'],
		rules: { 'no-restricted-syntax': 'off' }
	}
);
