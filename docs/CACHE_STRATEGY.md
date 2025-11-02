# GitHub Actions Cache and Dependency Management

## Overview
This document explains how our GitHub Actions workflows handle dependency management and caching.

## Dependency Installation Strategy

Our workflows use a robust dependency installation strategy that handles both `npm ci` and `npm install`:

```yaml
- name: Install dependencies
  run: |
    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi
```

### Why This Approach?

1. **`npm ci`**: Used when `package-lock.json` exists
   - Faster installation
   - Reproducible builds
   - Exactly matches `package-lock.json`

2. **`npm install`**: Used when no lock file exists
   - Generates new `package-lock.json`
   - Resolves latest compatible versions
   - Fallback for initial setups

## Caching Strategy

Node.js setup with automatic cache detection:

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: ${{ env.NODE_VERSION }}
    cache: 'npm'
```

### Cache Benefits

- **Faster builds**: Dependencies cached between runs
- **Reduced bandwidth**: No re-downloading unchanged packages
- **Improved reliability**: Less dependency on external registries

## Workflow Files Updated

The following workflows have been updated with robust dependency handling:

- ✅ `ci-cd.yml`
- ✅ `tests.yml`
- ✅ `security.yml`
- ✅ `package-scripts.yml`
- ✅ `documentation.yml`
- ✅ `release.yml`

## Troubleshooting

### Cache Issues

If you encounter cache-related issues:

1. **Clear cache manually**:
   ```bash
   gh cache delete --all
   ```

2. **Force reinstall**:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

### Lock File Issues

If `package-lock.json` is missing:

1. **Generate locally**:
   ```bash
   npm install --package-lock-only
   ```

2. **Commit the generated file**:
   ```bash
   git add package-lock.json
   git commit -m "Add package-lock.json for reproducible builds"
   ```

## Best Practices

1. **Always commit `package-lock.json`**
2. **Use `npm ci` in production/CI environments**
3. **Use `npm install` for development**
4. **Keep dependencies up to date**
5. **Monitor security vulnerabilities**

## Environment Variables

Key environment variables used across workflows:

- `NODE_VERSION`: '22.x' (Latest LTS)
- `MONGODB_VERSION`: '8.0'
- Test matrix: ['22.x', '24.x']