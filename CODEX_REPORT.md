# actual-mcp 1.15.1-kwojt.1 upgrade report

Date: 2026-10-22. Branch: `codex/actual-upgrade`. Base: upstream tag `v1.15.1` (`d546bc3`).
Only local work, tests and commits. Nothing pushed or deployed; no NAS/production connections or credential discovery.

## Result and provenance

Rebased the 755e746 fork onto v1.15.1 using merge base `9c64ad232448b47146a2e35f7ffaa6eefeb816bb`. Nine original commits were replayed; one overlapping commit was omitted and its stricter missing/ambiguous-budget safeguards were ported to the new connection layer. Package is now `1.15.1-kwojt.1`, with exact API/core `26.10.0` pins (already selected by upstream v1.15.1). This matches the intended Actual server release. The installed 26.10.0 SDK includes parent-context, so the earlier custom parent-context api-dist overlay is unnecessary.

Snapshot evidence starts at `README-NAS-SNAPSHOT.md`. Production snapshot reports package 1.12.1-kwojt.8 but runtime API 26.9.0; the original Git package specified 26.8.1. Thus package version alone did not describe the deployed runtime.

## Original fork commits: complete mapping

| Original | Status | New commit / disposition |
| --- | --- | --- |
| `1c6dfb4` safe full financial management tools | Kept/adapted | `1f5842c`; idempotency, audit, strict decimal input, accounts/budget/schedules/metadata retained. Upstream report/dashboard tools also retained. Integration removes duplicate tool names and prefers stricter fork budget handlers. |
| `ebd3b28` manual GHCR release | Kept | `9a9c09a`; manual fork publishing remains. No publishing executed. |
| `48bf0a9` partial transaction update readback | Kept | `728eb58`; later split/transfer refinements retained. |
| `bb954d0` match transactions to schedules | Kept | `210e15c`; native schedule linkage and protected-field readback retained, alongside upstream nested split reporting. |
| `b55022f` explicit ranges/defaults | Kept/adapted | `ccba25d`; schema validation/explicit date bounds preserved. Upstream optional-account query and historical balance cutoff behavior retained. |
| `48a7930` configured Actual sync IDs | Ported; original replay dropped | Upstream already directly uses configured IDs, so the conflicting old lifecycle implementation was omitted. `9b15c85` additionally restores trim, missing-ID and multi-budget ambiguity checks, and permits an explicit sync ID without a nonempty local listing. Regression test included. |
| `7f371c0` split child payees | Kept/adapted | `3ebc4ff`; exact payee resolution and split total/readback validation retained. Integration also preserves upstream transfer_account_id support on split children. |
| `240bf90` native split formulas | Kept | `12fe5c7`; native formula/remainder action schemas and validation retained. |
| `aee2ba3` logical child state for split transfers | Kept | `442188f`; child matching/readback and counterpart verification retained. Child IDs remain visible in upstream-style nested rows. |
| `755e746` reconcile native transfer readback | Kept | `3bd2ad7`; bounded verification, counterpart state and explicit ambiguous-write reporting retained. |

## NAS-only runtime patches: complete behavior mapping

| Patch / behavior | Status | Implementation / reason |
| --- | --- | --- |
| Reliability CJS: single-flight sync, transient network retries | Ported | Connection queue plus one shared sync promise; three attempts, 500/1000ms waits. Authentication/validation failures are not retried. `reliability.ts`, `connection.ts`; tests cover bound and recovery. |
| Reliability CJS: budget download retry with shutdown/re-init | Ported | Three attempts, 750/1500ms waits; lifecycle queue excludes concurrent SDK operations. Failed initialization also cleans handles, including rejection from init itself. |
| Reliability CJS: `.actual-mcp-ready` marker | Ported | Clear on connection construction/failure/shutdown; mark after successful download/sync. Failed sync also clears freshness timestamp. Marker I/O remains best-effort. |
| Reliability CJS: HTTP background init warmup | Ported | Retry every 15s until initialization succeeds or shutdown begins; starts after listener is ready. |
| Docker `NODE_OPTIONS=--unhandled-rejections=none` | Dropped as redundant | Upstream index.ts already installs explicit rejection/exception logging handlers. Do not globally hide rejections; awaited financial failures propagate. The existing upstream catch-all process behavior remains. |
| request-sync `actual-api.js`: one fresh sync per read scope | Ported | AsyncLocalStorage scope in connection, exported `withSyncedRead`; nested facade reads skip TTL refresh. Direct facade calls retain default TTL 0. Explicit scoped reads force sync even with a configured TTL. |
| request-sync `tools-index.js`: scope the read handler | Ported | Read tools take existing shared budget lock then `withSyncedRead`. Durable bank-job status is deliberately observable without a remote refresh. All upstream-added write tools also require operationId and use the fork mutation runtime. |
| request-sync readiness clearing/recovery | Ported | Sync failure blocks the operation, clears marker, later successful sync restores it. Health endpoint now returns 503 while not ready, 200 while ready. |
| request-sync prior init error reset | Obsolete as a separate variable patch | Upstream promise/state lifecycle clears a failed init and starts a fresh attempt; successful retry has no cached initializationError. Tested with a rejected attempt followed by successful retry. |
| request-sync `sdk-index.js`: abort-aware binary sync timeout | Ported as SDK patch | `patches/@actual-app+api+26.10.0.patch`, applied by production dependency patch-package in postinstall with `--error-on-fail`. Timer covers fetch AND body read, default 15000ms, positive ACTUAL_SYNC_REQUEST_TIMEOUT_MS override. Preserve PostError identity and wrap transport/body failures as network-failure; timer always cleared. |
| resources overlay: shared lock/fresh read/no per-request shutdown | Ported | Both resource handlers take the same lock/scope as tools. Shared SDK stays open across requests; connection drain owns shutdown. Vitest MCP in-memory regression tests reproduce contention and recovery. |
| custom API parent-context runtime | Obsolete downstream overlay | Official Actual/API 26.10.0 already includes merged PR #8898. Keep matching engine/server versions, not an old custom dist. See server report. |

The resource lifecycle harness was inspected as a behavioral specification; equivalent TypeScript Vitest regressions were added instead of committing a copied compiled-JS harness. Tests cover resource/tool ordering, one sync per handler including multiple inner reads, absence of per-request shutdown, and lock release after failure. Connection tests cover draining in-flight operations. The HTTP warmup loop and health route are compile-checked; no real server/production health probe was run.

## SDK investigation

Downloaded pristine `@actual-app/api@26.9.0` with npm pack under ignored `.upgrade-tmp/pristine-26.9/`, compared its dist/index.js to the snapshot request-sync sdk-index.js. The 387-line diff contains four functional clusters: postBinary cancellation and three parent-context clusters (literal parent strings, populated context fields, temporary-field cleanup). Other hunks are xmlbuilder bundle source-location comments and a final newline. No downloaded package or generated bundle is committed.

Parent-context is already in 26.10.0. Its postBinary still has no abort signal, so only the cancellation cluster is patched. A facade Promise.race would leave the SDK fetch/body and native operation running, making retries overlap; the SDK uses its own captured fetch, so a generic application fetch wrapper is insufficient. The version-specific patch is the bounded solution. Tests evaluate the actual installed patched function with synthetic transport/body stalls, HTTP errors, invalid timeout configuration and timer cleanup. These are cancellation unit tests, not a live SDK/server integration test. The bundled source map is not regenerated for this small patch; nearby SDK stack offsets can differ.

Docker copies patches before npm ci, compiles native dependencies in its builder, prunes there and copies the result to runtime. Removed the old fork's redundant runtime npm ci, which would otherwise discard builder-compiled modules and lack a compiler. Ignored .upgrade-tmp downloads/caches are also excluded from the Docker context. Container construction was not run. patch-package stays a production dependency because production-only npm installs must also apply the patch.

## Older patchers: checked, not blindly replayed

These scripts predate the clean 755e746 image and are not additional layers in the snapshot's declared effective image chain.

| Legacy patch behavior | Status | Coverage / intentional difference |
| --- | --- | --- |
| stability: retry sync/download, shared lifecycle and no per-tool shutdown | Ported/covered | Current connection queue and reliability port; mutation pre/post sync in operation-runtime. |
| stability: delete local cache on schema/storage mismatch | Dropped | Not in the declared current layer chain; automatic data/cache deletion is not introduced. Propagate failure and require a backed-up, deliberate cache recovery. |
| stability/splits: normalize or create payee_name during updates | Dropped/superseded | Fork/upstream reject unsafe update payee_name; exact existing payee ID or unique name via payee is supported. No implicit payee creation on update. |
| splits: minor-unit checks, child preservation/IDs, split totals and readback | Kept/covered | Exact decimal input conversion, strict totals, grouped-state/readback and transfer counterpart tests. |
| splits: filter by child category IDs/imported_payee and raw JSON report section | Dropped legacy-only behavior | Not present in the clean source/effective transfer baseline contract. Current filters use category_name/payee_name; child IDs/details remain in markdown. No claim that old expanded filters/raw report have been restored. |
| readback: shared lock, synced reads/writes and create/update verification | Kept/covered | Operation lock, scoped fresh reads, mutation runtime, grouped create/update verification. |
| readback: extra imported-ID readback on imports | Dropped legacy-only behavior | Native import/reconciliation response and mutation sync retained; no new imported-ID-specific post-sync assertion was added. This limitation is explicit. |
| readback: cache/session reset for storage errors | Dropped | Same non-destructive recovery policy as above; failed init handles still close before retry. |
| readback: disable bank sync | Dropped/superseded | Fork has durable asynchronous bank jobs with concurrency guards; no live bank sync was run. |
| readback: 240s warmup then process exit | Dropped/superseded | Current effective reliability layer uses 15s background retry. Readiness exposes failure without requiring that old forced restart. |

Build comparison caveat: effective build has 388 files, release baseline 28. Only actual-api.js/index.js/resources.js differ among the common JS modules; 25 common files are identical. The release baseline omits imported tool/core modules, so extra emitted files cannot establish extra runtime features. Used source commits plus declared overlay chain to resolve that ambiguity.

## Conflicts and integration decisions

Rebase conflicts affected package/lock/version identity, fork release workflow/Docker setup, README, API lifecycle/mutations, transaction types/tools/tests, rule schemas, report mapping and range/balance behavior. Retained upstream connection queue, session-token auth, graceful drain, newer reports/dashboards, rule string-null normalization, optional-account reads and historical balance fixes. Layered fork idempotency/mutation safety and decimal validation on top. Duplicate read/write budget tool names are collapsed by name, choosing later stricter fork definitions. Contract tests assert 21 unique read tools and 71 unique tools with writes enabled; every write requires operationId. The new lockfile was regenerated from the final dependency manifest rather than choosing either conflicted binary lockfile.

Added commits after replay: dce6c63 (integration), 9b15c85 (reliability/scopes), f31e3c4 (resources), a853f8f (SDK timeout/version), cc66e99 (fixture alignment/formatting), a4a8358 (report/release metadata), and the build-context cleanup commit. Older replayed commits remain focused historical changes; no other branches/worktrees were rewritten.

## Verification

Final runtime Node v24.22.1 via isolated `.tooling/` under working root (system was v26.3.1). npm cache and node-gyp headers redirected into `.upgrade-tmp/`. Initial npm ci hit the default external node-gyp cache restriction; rerun with npm_config_devdir inside the worktree succeeded.

| Command | Final result |
| --- | --- |
| `npm ci` (Node 24, local cache/devdir) | PASS; postinstall applied @actual-app/api@26.10.0 patch |
| `npm run build` | PASS |
| `npm test` | PASS: 97 files, 563 tests |
| `npm run type-check` | PASS |
| `npm run lint` | PASS |
| `git diff --check` | PASS |

Ignored logs: `.upgrade-tmp/ci.log`, `final-build.log`, `final-tests.log`, `final-types.log`, `final-lint.log`. Added coverage includes transient retry bounds, init retry/explicit-ID selection, stale-read rejection/readiness recovery, nested fresh scopes, resource/tool serialization, SDK fetch/body cancellation, and adapted upstream split-transfer fixtures with exact decimal inputs. Existing split/formula/transaction/idempotency tests pass. No Docker E2E suite, live Actual integration, real bank sync or production authentication was executed.

## Deployment notes and remaining risks

- Requires separate approved deployment, backups, target-architecture image build and local/staging E2E validation with a disposable budget before production. Current tests use mocks/in-memory MCP and local fixtures; financial production state was never loaded.
- Coordinate Actual server 26.10.0, MCP API/core 26.10.0, and Enable Banking derivative image. `actual-enablebanking-sync` image is FROM the MCP image and shares its API. Rebuild/retest that image too. Its application code is outside this task's allowed scope and was not inspected.
- NAS used both a custom web build and custom API dist with parent-context; official 26.10.0 supplies both. Do not copy old sdk-index.js or old api-dist into the new image. A future custom API rebuild must preserve/reapply the timeout patch against its exact bundle and rerun tests.
- SDK patch is version/bundle-specific. Treat any API upgrade or postinstall failure as requiring patch review. Positive timeout overrides and three retry attempts can extend a failed sync to roughly 46.5s at default settings; download includes more requests and has no whole-operation deadline. Only binary sync POSTs get this timeout, not every login/download HTTP request.
- Readiness marker and /healthz now track initialized/fresh connection state. Resources return no financial data on refresh failure (list handler keeps its existing empty-list error response); clients should inspect readiness/logs rather than equate an empty list with a new empty budget.
- Upgrade playbook explicitly warns that SDK/server schema mismatches can cause invalid-schema/missing-table errors. 26.10 improves cross-version sync but can defer newer data; matching versions remain required for this deployment policy. Its older Tailscale /sse route/port instructions conflict with its later July note naming /mcp; verify real deployment configuration when separately authorized.
- Runtime marker I/O is best-effort; health readiness is in memory. Warmup/health and native Docker dependencies need an image smoke test. Existing upstream process-level exception handlers keep the process alive; they do not prove recovery from arbitrary fatal native/storage faults.


## actual-conn-v2

Data: 2026-10-22. Worktree: `actual-conn-v2`, gałąź `codex/actual-conn-v2`,
baza `601ba68` (main, 1.15.1-kwojt.1, API/core 26.10.0).
Powyższa treść raportu #1 jest zachowana; ta sekcja aktualizuje opis transportu,
retry, logowania i wyników dla nowej gałęzi. Wyłącznie lokalne testy i commity;
bez push, wdrożenia, połączeń z NAS/produkcją ani pozyskiwania credentiali.
Nie uruchamiano agentów pomocniczych. Nie czytano keychaina, ~/.ssh, menedżerów
haseł, profili przeglądarek ani plików innych projektów.

### Przeniesione zmiany i różnice względem źródła

Źródło sprawdzono przez `git show` trzech wskazanych commitów oraz ich plików.
`a0b8121` nie został przeniesiony: main zawiera już jego odpowiedniki z #1.
`d080618` służył jedynie jako kontekst raportu; nie kopiowano jego treści.

| Źródło | Przeniesienie / adaptacja |
| --- | --- |
| `28fc4b5` | `3c734eb`: Undici 7.30.1, dispatcher tylko dla originu ACTUAL_SERVER_URL, limit obu keep-alive, timeout nagłówków/body. Instalacja przed init SDK i zamykanie w cyklu życia ActualConnection, także po nieudanym init. Zachowane sessionToken/password, kolejka, single-flight i graceful drain z main. |
| `ec09ede` | `a41c3dc`: ścisła klasyfikacja kodów i jedna pętla retry w istniejącym reliability.ts; zastąpiono szeroki regex oraz poprzednie pętle sync/download, dodano login. Świeży Agent przez AsyncLocalStorage dla każdej ponownej próby. Reset SDK dla login/download jest wewnątrz tej próby, bez zagnieżdżonego retry. |
| `ec09ede` | Runtime oznacza błędy po wejściu do handlera jako MUTATION_OUTCOME_UNCERTAIN. Mutacja nie jest powtarzana; retry może objąć jedynie pre/post sync CRDT. Objęto też osobne wykonanie bank sync w tle, którego nie zabezpiecza sam runtime zgłoszenia zadania. |
| `d39f297` | `bc31666`: redakcja SDK i usunięcie powielonych logów aplikacji, testy wykonywanego kodu SDK i warmup. Jedna łatka wygenerowana patch-package względem czystego API 26.10.0. Main już miał produkcyjne patch-package, postinstall --error-on-fail, atrybuty patch i poprawny Docker builder; nie cofano tych zmian. |
| Dodatkowe dopasowanie | `a31a056`: po zakończeniu próby usuwa się z odziedziczonego scope referencję do zamykanego Agenta, aby przyszłe timery SDK używały zwykłej puli. Osobny lokalny test regresji. |

Timeout binarnego sync z main jest zachowany. Wszystkie trzy klastry parent-context
z łatki 26.9.0 sprawdzono w zainstalowanym 26.10.0: literały parent_ w formułach,
parent_notes/imported_payee/payee/account przy split oraz usuwanie pól pomocniczych
z rodzica/dzieci już są upstream. Nie dodano ich ponownie ani pliku patch 26.9.0.
Pozostaje tylko `patches/@actual-app+api+26.10.0.patch`.

Redakcja jest silniejsza od oryginału: usunięto dodatkowy ogólny log odrzucenia
post/del/patch i wszystkie dwa logi stosów fullSync, także dla błędów terminalnych.
Jedna warstwa retry emituje jedną linię JSON na nieudaną próbę, z operacją,
próbą/limitem, kodem, freshConnection, elapsedMs i decyzją retry; po odzyskaniu
emituje podsumowanie. Bez URL, argumentów, credentiali i stacków. Istniejący lokalny
audyt operacji i ledger nadal mają swoją odrębną funkcję i format.
Nie dołączono surowej wiadomości błędu do MUTATION_OUTCOME_UNCERTAIN (oryginalny
d39f297 ją dopisywał), aby nie ujawniać danych finansowych/odpowiedzi SDK.

Sprawdzono rejestr narzędzi main: create/update/delete transakcji, import,
transfery i split transfers, kategorie/grupy/payees/rules, merge-payees,
run-bank-sync, konta (w tym close z transferem i reconcile), budżet, tagi/notatki,
schedules oraz match/unmatch transaction-to-schedule, custom reports i dashboardy.
Wszystkie zapisy rejestru wymagają operationId i przechodzą przez executeMutation;
dodano test tej właściwości, także dla narzędzi 1.15.x. Wrapper run() nie ponawia
callbacków. Istniejące pętle weryfikacji transakcji/schedule odpytują readback po
jednym zapisie; nie powtarzają mutacji. Bank job nie ponawia runBankSync.

HTTP warmup zachowuje interwał 15 s między wyczerpanymi cyklami przejściowych
błędów inicjalizacji. Zatrzymuje się na błędach terminalnych i respektuje shutdown
z main. Nie jest dodatkową pętlą retry pojedynczego sync/download ani mutacji.

### Konfiguracja

README opisuje wszystkie limity. Wartości domyślne:
`ACTUAL_HTTP_KEEPALIVE_TIMEOUT_MS=2000` (integer 1–4000),
`ACTUAL_HTTP_REQUEST_TIMEOUT_MS=15000` (integer 1–300000),
`ACTUAL_SYNC_REQUEST_TIMEOUT_MS=15000` (dodatnia skończona liczba, zgodnie z main),
`ACTUAL_HTTP_RETRY_ATTEMPTS=3` (integer 1–5, razem z pierwszą próbą),
`ACTUAL_HTTP_RETRY_DELAY_MS=500` (integer 1–10000, mnożnik numeru nieudanej próby).
Błędne wartości zastępuje się domyślnymi. Download używa teraz wspólnego delay
500/1000 ms zamiast dawnego 750/1500 ms. ACTUAL_SYNC_TTL_MS pozostaje bez zmian.

### Weryfikacja lokalna

Kontrole wykonano osobno po instalacji dla każdego runtime, aby nie mieszać ABI
modułów natywnych. Node 24 uruchamiano przez
`npm exec --yes --package=node@24.21.0 -- sh -c '…'`. Cache npm i nagłówki node-gyp
przy kolejnych instalacjach skierowano do `/private/tmp/actual-conn-v2-*`.

| Kontrola | Node 24.21.0 | Domyślny Node 26.3.1 |
| --- | --- | --- |
| npm ci | PASS; postinstall nałożył łatkę 26.10.0 | PASS; postinstall nałożył łatkę 26.10.0 |
| npm ci --omit=dev | PASS; produkcyjne patch-package nałożyło łatkę | PASS; produkcyjne patch-package nałożyło łatkę |
| npm run build | PASS | PASS |
| npm test | PASS: 103 pliki, 596 testów | PASS: 103 pliki, 596 testów |
| npm run type-check | PASS | PASS |
| npm run lint | PASS | PASS |
| git diff --check | PASS | PASS |

Testy obejmują: lokalny serwer 127.0.0.1 niszczący gniazdo przy reuse (baseline
UND_ERR_SOCKET, krótki keep-alive OK), świeże gniazdo retry i powrót do zwykłej puli,
fetch przechwycony przez prawdziwe SDK, odzyskanie loginu, timeout nagłówków i
binarnego body, limity prób i brak retry auth/TLS/rate-limit/cancel/nieznanych
wiadomości. Test utraty odpowiedzi po przyjęciu zapisu potwierdza dokładnie jeden
zapis. Są też testy awarii przed mutacją, po mutacji i wewnątrz bank job.

Dowód CRDT składa się z wykonania zainstalowanego sendera 26.10.0 w VM (ten sam
payload i timestamp po awarii) oraz testu SQLite: timestamp PRIMARY KEY i INSERT
OR IGNORE odrzucają powtórkę. SQL pochodzi z testu ec09ede, referującego serwer
26.9.0. Jest to dowód mechanizmu pod warunkiem zachowania tych semantyk na serwerze,
nie test działającego serwera 26.10.0. Nie pobierano ani nie sprawdzano produkcji.

Testy Docker/testcontainers (`npm run test:e2e`) i budowę kontenera pominięto.
Nie uruchamiano Dockera, prawdziwego bank sync ani połączenia z rzeczywistym Actual.
Końcowe node_modules i build pozostawiono dla domyślnego Node 26.3.1.
Logi kontroli znajdują się w `/private/tmp/actual-v2-*.log` i nie są commitowane.
Instalacja Node 26 zgłasza nieudaną kompilację opcjonalnego sshcrypto (testcontainers/
ssh2, zmienione API V8); instalacja kończy się kodem 0 i fallbackiem. Nie dotyczy
transportu Actual. npm ostrzega też o allow-scripts i nieznanym env config devdir;
postinstall faktycznie się wykonał. Nie zmieniano pobocznych zależności.

### Ryzyka, późniejsze wdrożenie i rollback

- Lokalny test potwierdza wyścig przy reuse i sposób odzyskania; nie dowodzi,
  że to jedyna przyczyna wcześniejszych awarii produkcyjnych.
- Świeże pule i krótki keep-alive zwiększą liczbę połączeń. Trzy próby oraz
  backoff ograniczają serię; rate limit jest terminalny.
- Timeout HTTP dotyczy nagłówków i bezczynności body; aktywnie przesyłany download
  nie ma całkowitego deadline. Binarny sync ma osobny deadline obejmujący body.
  Duży budżet może wymagać większych limitów niż domyślne 15 s.
- SDK patch jest związany z dokładnym bundle 26.10.0; upgrade wymaga regeneracji
  i testów. Source map nie jest regenerowana. --ignore-scripts omija zabezpieczenia.
- MUTATION_OUTCOME_UNCERTAIN wymaga uzgodnienia stanu przed ponownym zgłoszeniem.
  Nie dodano automatycznego rollbacku ani trwałego dedupe nieudanych operacji;
  istniejący ledger zapisuje tylko sukcesy. Walidacja po wejściu do handlera też
  konserwatywnie dostaje ten kod. Background bank jobs mają taki sam status błędu.
- Dopiero po osobnej autoryzacji: zachować poprzedni obraz, env i backup danych;
  zbudować oznaczony obraz dla architektury docelowej standardowym Dockerfile,
  wykonać Docker E2E z budżetem jednorazowym i sprawdzić zgodność server/API 26.10.0.
  Następnie sprawdzić readiness, odczyt MCP, liczbę retry, redakcję logów i brak
  duplikatów. Nie nadpisywać bundle starymi overlayami 26.9.0.
- Rollback: przywrócić poprzedni obraz (bazę main 601ba68) oraz poprzednie env,
  zachowując dane i ledger/audyt. Nie usuwać katalogu budżetu i nie odwracać
  ręcznie fragmentów łatki w działającym kontenerze. Brak nowych migracji danych.
