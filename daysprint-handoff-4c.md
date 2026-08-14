# DAYSPRINT handoff — packet 4c (CI MATRIX)

Branch: `worktree-agent-ad202b7d2b3e5e8d4` (committed, NOT pushed)

## 1. CI matrix

`.github/workflows/test.yml` extended from `node: [22, 24]` to `node: [22, 24, 26]` with `fail-fast: false` so one version's failure can't cancel/mask the others. No existing CI step was weakened, removed, or made conditional.

**Why not Node 20** (documented in a workflow comment, per packet): `package.json` engines is `>=22`, and the test script passes a quoted glob to `node --test` (`"test/**/*.test.js"`) — node only self-expands glob args from 21+, so on Node 20 the glob is treated as a literal path and zero tests run (a silent false-green, worse than a failure). Node 20 is also past EOL (April 2026). Matrix is therefore 22/24/26: current maintenance LTS, active LTS, and current.

## 2. Local verification

- `node --version` locally: **v26.0.0** → full suite run under 26: **245 tests, 243 pass, 2 skipped, 0 fail**.
- No version managers present (checked nvm, fnm, asdf, volta — none installed), so **Node 22 and 24 legs are CI-verified-only**. Node 24 was already green in CI under the previous matrix; 22 is engines-floor and was in the prior matrix too, so risk is confined to the new 26 leg — which is the one verified locally.

## 3. .d.ts generation — DONE (feasible, zero source changes)

`tsc --declaration --emitDeclarationOnly --allowJs` over `src/core` emits with **zero diagnostics and zero source changes** — the existing JSDoc is good enough to produce useful declarations (verdict/domain unions, trust-tier sets, typedef-backed shapes).

- `tsconfig.types.json` — dev-only emit config (`rootDir: src`, `outDir: types`, include `src/core/**/*.js`). Adapters are emitted transitively because `core/registry.js` statically imports all adapter modules.
- `types/` — 26 committed `.d.ts` files (core + interfaces + adapters).
- `types/index.d.ts` — small hand-written barrel, one namespace per `src/core` module; typechecked under nodenext resolution. tsc emit never touches it (no `src/index.js` exists, so no collision).
- `package.json` gets `"types": "types/index.d.ts"`. Runtime paths untouched: `start`/`demo`/`test` scripts unchanged, still zero npm dependencies, no build step anywhere. Regeneration is opt-in: `npx -y -p typescript tsc -p tsconfig.types.json`.

**Known limitation (accepted):** committed declarations can drift from `src/core` since nothing regenerates them automatically. A CI freshness check was deliberately NOT added — it would pull `typescript` over the network in CI (new flake surface) for a repo whose README promises zero-install. If drift becomes a problem, the cheap fix is a `types:check` job that regenerates and `git diff --exit-code`s.

## 4. Status

- `npm test` green (Node 26 locally): 243 pass / 0 fail / 2 skipped.
- All changes committed on the worktree branch; nothing pushed.

## Files touched

- `.github/workflows/test.yml` — matrix 22/24/26, fail-fast: false, expanded exclusion comment
- `package.json` — `types` field only
- `tsconfig.types.json` — new, dev-only
- `types/**` — new, 27 files (26 generated + 1 barrel)
- `daysprint-handoff-4c.md` — this file
