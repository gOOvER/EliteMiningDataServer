module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true
  },
  extends: [
    'standard'
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module'
  },
  rules: {
    // 'linebreak-style': ['error', process.platform === 'win32' ? 'windows' : 'unix'],
    'no-console': 'warn',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // Entspannung für bessere Prettier-Kompatibilität
    'semi': ['error', 'never'],
    'comma-dangle': 'off',
    'space-before-function-paren': 'off',
    'indent': 'off',
    'quotes': 'off'
  },
  overrides: [
    {
      files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
      env: {
        jest: true
      },
      rules: {
        'no-console': 'off'
      }
    }
  ]
};