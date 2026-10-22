# NAS source reconciliation (28–30 September 2026)

Input: the explicitly supplied offline `/app` and compose-directory copy.
Baseline: commit `755e746`, package version `1.12.1-kwojt.8`.
No NAS or live service was contacted.

The baseline was installed and compiled, then **every file** under `build/` was
compared with the supplied `app/build/` using `diff -qr`.

| File differing from baseline | Source reconciliation |
| --- | --- |
| `actual-api.js` | Coalesced sync with three transient retries, download retry/reset, readiness marker, one AsyncLocalStorage freshness scope per read, clear initialization error after success. Helpers extracted to `src/core/connection/nas-reliability.ts` to keep each source below 500 lines. |
| `index.js` | HTTP warmup retries every 15 seconds until initialization succeeds. |
| `tools/index.js` | Read tools use `withSyncedRead` instead of a separate sync followed by repeated per-helper syncs. |
| `resources.js` | List/read under the budget lock and one freshness scope; never shut down the shared SDK after listing. |
| `tools/rules/input-schema.d.ts` | Only enum property order differs. Same members, identical runtime JavaScript; no behavioral change to reproduce. |

All other baseline build artifacts were byte-identical to the NAS copy. Maps and
NAS declarations were stale after JavaScript patching; the new build regenerates
them from TypeScript. Formatting and helper-module boundaries intentionally differ.
Readiness path is resolved at call time, allowing isolated test data directories.

## SDK patch

NAS used `@actual-app/api` and `@actual-app/core` **26.9.0**, while the baseline
manifest pinned 26.8.1. Both are now pinned to the NAS version.
`patches/@actual-app+api+26.9.0.patch` is the diff against the pristine published
26.9.0 bundle, automatically applied by `patch-package --error-on-fail` during
installation (including production dependencies). It preserves:

- A bounded binary sync request and body read (`ACTUAL_SYNC_REQUEST_TIMEOUT_MS`,
  positive finite value, default 15000 ms), cleanup of abort timer, and preservation
  of existing `PostError` status errors.
- Parent notes, imported payee, payee and account fields on split rule evaluation;
  literal escaping of string parent fields in formulas; removal of ephemeral
  parent fields before transaction serialization.

Bundle region comments referring to nested versus hoisted `xmlbuilder` and a
trailing newline were excluded: they do not alter runtime behavior. There are no
other functional SDK differences against the supplied `sdk-index.js`.

`patch-package` was chosen over a deploy-only diff so a clean install cannot
silently drop required behavior. Do not run the historic NAS binary replacement
scripts on this source build: they would overwrite it with stale compiled files.
Old scripts were inspected for provenance; only behavior actually present in the
supplied final build was ported.

## Build and rollback

Build a fresh image from this branch using `npm ci` then `npm run build`. Keep the
previous image and persistent data intact. Rollback means selecting the previously
built image; do not reverse patches in a running installation. No deployment was
performed. The connection follow-up and final verification are in `CODEX_REPORT.md`.
