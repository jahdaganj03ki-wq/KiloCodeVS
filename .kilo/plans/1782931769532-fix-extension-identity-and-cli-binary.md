# Fix Extension Identity and CLI Binary in VSIX

## Goal
Make the VSIX install as a separate extension named "Kilo Code Auto Memory" with a working bundled CLI binary.

## Problems
1. **Extension name conflict**: `package.json` has `name: "kilo-code"` and `publisher: "kilocode"` → installs to `kilocode.kilo-code-7.3.63`, conflicting with upstream Kilo Code.
2. **CLI binary missing**: CI workflow creates bash placeholder `bin/kilo` instead of building the real CLI binary. On Windows, extension expects `bin/kilo.exe` and fails.

## Plan

### 1. Update Extension Identity (`package.json`)
- `name`: `"kilo-code"` → `"kilo-code-auto-memory"`
- `publisher`: `"kilocode"` → `"kilo-code-auto-memory"`
- `displayName`: Already `"Kilo Code Auto Memory"` ✓
- Result: Extension ID `kilo-code-auto-memory.kilo-code-auto-memory` — fully separate from `kilocode.kilo-code`

### 2. Fix CLI Binary Build in GitHub Actions (`.github/workflows/build.yml`)
- Add step after `bun install` to build real CLI:
  ```yaml
  - name: Build CLI binary
    working-directory: monorepo/packages/kilo-vscode
    run: bun script/local-bin.ts
  ```
- Remove placeholder step (`echo '#!/bin/bash' > bin/kilo`)
- `script/local-bin.ts` builds CLI from `packages/opencode` using `bun run build --single`, copies binary + resources (Tree-sitter, sandbox worker, ffmpeg, bwrap) to `bin/kilo`

### 3. Re-tag and Rebuild
- Delete/recreate `v0.1.0` tag to trigger new build
- Verify release asset works on install

## Validation
- Install new VSIX → appears as "Kilo Code Auto Memory" in VS Code
- Open extension → no "CLI binary not found" error
- Sidebar loads, connects to CLI backend

## Notes
- CI builds Linux x64 binary only (matches `ubuntu-latest` runner)
- Windows/macOS binaries require build matrix — out of scope
- Version remains `7.3.63` (upstream version) for now