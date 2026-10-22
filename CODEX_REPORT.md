# actual-mcp: stabilne połączenie z Actual

Data: 22.10.2026. Worktree: `actual-conn`, gałąź `codex/actual-conn`.
Baza: `755e746`. Wszystkie działania były lokalne. Nie wykonano pushowania,
wdrożenia ani połączenia z NAS lub usługami produkcyjnymi. Nie pobierano credentiali.

## Commity i zakres

1. `a0b8121` — `sync NAS patches (28–30.09)`.
2. `28fc4b5` — krótki keep-alive dla originu Actual i test wbudowanego fetch.
3. `ec09ede` — retry tylko bezpiecznych operacji na świeżych połączeniach,
   klasyfikacja błędów i ochrona przed ponowieniem mutacji.
4. `d39f297` — redakcja logów SDK, warmup, pakowanie łatki i wyrównanie
   zależności przechodnich do NAS.
5. Ostatni commit — ten raport.

## Odtworzenie NAS

Po `npm ci` i buildzie bazy porównano **każdy plik** `build/` z dostarczonym
`app/build/`. Dokładny wykaz znajduje się w
[deploy/nas-20260930/README.md](deploy/nas-20260930/README.md).

Różniły się tylko cztery pliki wykonawcze i jedna deklaracja:

- `actual-api.js`: współdzielona trwająca synchronizacja, trzy próby sync/download,
  reset sesji po błędzie pobierania, marker gotowości, scope odczytu z jednym sync,
  zerowanie błędu inicjalizacji po sukcesie.
- `index.js`: warmup HTTP w tle.
- `tools/index.js`: odczyt w `withSyncedRead`.
- `resources.js`: wspólna blokada budżetu i scope świeżości; bez wyłączania SDK
  po odczycie listy zasobów.
- `tools/rules/input-schema.d.ts`: wyłącznie inna kolejność tych samych pól enum.

Pozostałe artefakty bazy były identyczne bajtowo. Nie kopiowano nieaktualnych map
źródeł i deklaracji NAS; zostały wygenerowane z TypeScript. Nie odtwarzano kolejności
pól deklaracji, komentarzy bundlera o ścieżce `xmlbuilder` ani końcowego newline SDK.
Pomocniki wydzielono z `actual-api.ts`, aby pozostał poniżej 500 linii. Ścieżka
markera jest obliczana podczas wywołania, co umożliwia izolację testów.
Nie stwierdzono innych nieodtworzonych różnic wykonawczego builda aplikacji.

Oba pakiety Actual podniesiono z 26.8.1 do **26.9.0**, zgodnie z NAS. Porównanie
manifestów wykazało, że były to jedyne różnice zależności bezpośrednich względem
NAS. W końcowym lockfile wersje wszystkich wspólnych pakietów odpowiadają NAS;
nowe pozycje wynikają z dodania Undici i patch-package.

Łatka [patches/@actual-app+api+26.9.0.patch](patches/@actual-app+api+26.9.0.patch)
powstała względem oryginalnego pakietu npm 26.9.0. Odtwarza limit czasu `postBinary`
obejmujący także treść odpowiedzi oraz pola rodzica splitów używane przez reguły
(formuły i usuwanie pól tymczasowych przed serializacją). Końcowa wersja dodatkowo
usuwa dwa stack trace'y dla przejściowego błędu sync oraz dane żądań z logowania
odrzuconych żądań SDK. Pierwotna łatka NAS jest zachowana w pierwszym commicie.

Wybrano **patch-package**, stosowany przez `postinstall --error-on-fail`, zamiast
samego dokumentu do wdrożenia: instalacja ma przerwać się, jeśli łatka przestanie
pasować. Jest to zależność produkcyjna. Dockerfile kopiuje `patches/` przed
instalacją zarówno w builderze, jak i w obrazie wynikowym. Starych skryptów
podmieniających pliki NAS nie należy uruchamiać na nowym obrazie.

## Transport i retry

Undici **7.30.1** instaluje dispatcher dla originu z `ACTUAL_SERVER_URL`; pozostałe
originy przechodzą do wcześniejszego dispatchera. SDK zachowuje referencję do
wbudowanego fetch, a dispatcher działa także dla tej referencji. Jest to zgodne z
[dokumentacją Node 24](https://nodejs.org/download/release/v24.21.0/docs/api/globals.html#fetch).

Keep-alive ma domyślnie 2000 ms. **Oba** parametry `keepAliveTimeout` i
`keepAliveMaxTimeout` mają ten limit, żeby wskazówka serwera nie wydłużyła go znowu;
threshold wynosi 1000 ms. Znaczenie parametrów opisuje
[dokumentacja Undici](https://github.com/nodejs/undici/blob/v7.30.1/docs/docs/api/Client.md).
Retry dostaje własny Agent w AsyncLocalStorage; zamknięcie tej puli nie niszczy
zwykłej puli ani połączeń innego żądania. Obsłużone są oba kontrakty handlerów
Undici, w tym używany przez Node 24.

| Operacja | Polityka |
| --- | --- |
| Login/inicjalizacja SDK | Retry znanych błędów transportowych, reset SDK przed następną próbą. Brak retry odrzuconych credentiali. |
| Download budżetu | Retry znanych błędów transportowych, reset i ponowne init; bez usuwania danych budżetu. |
| Sync CRDT | Retry przesyła istniejące wiadomości z zachowaniem timestampów; nie uruchamia ponownie handlera mutacji. |
| Odczyty narzędzi/zasobów | Jeden świeży sync na żądanie; lokalne zapytania nie są obejmowane ogólną pętlą retry. |
| Create/update/delete, import, transfer, bank sync, pozostałe mutacje | Handler wykonuje się raz. Transport nie zawiera RetryAgent ani ogólnego retry fetch. |
| Auth rejection, TLS/certyfikat, HTTP rate limit, nieznany błąd | Bez retry. |

Bezpieczeństwo ponowienia CRDT sprawdzono w tagu Actual **v26.9.0**:
[serwer](https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/sync-simple.js)
używa `INSERT OR IGNORE`, a
[schemat](https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/sql/messages.sql)
ma timestamp jako klucz główny. Test wykonuje te instrukcje SQL w lokalnej bazie
SQLite. Drugi test wykonuje wyciętą z zainstalowanego SDK funkcję `_fullSync` i
potwierdza identyczny payload i timestampy przy ponowieniu po awarii.
Nie weryfikowano wersji ani implementacji działającego serwera produkcyjnego.

Po błędzie od momentu wejścia do handlera mutacji zwracane jest konserwatywne
`MUTATION_OUTCOME_UNCERTAIN`, z zachowaniem pierwotnego komunikatu i zaleceniem
sprawdzenia stanu przed ponownym zleceniem. Także błąd sync **po** zapisie nie
powoduje ponowienia zapisu. Istniejący ledger zapamiętuje zakończone operacje;
nie gwarantuje exactly-once po awarii lub dla operacji zakończonej błędem.
Ponowne ręczne zlecenie takiej operacji wymaga uzgodnienia stanu.

Jedna linia JSON opisuje nieudaną próbę: operacja, numer/limit, kod, świeże połączenie,
czas i decyzja retry. Sukces po retry dostaje jedno podsumowanie. Nie wypisuje się
adresów, argumentów, credentiali ani stacków. Kiedy SDK gubi pierwotną przyczynę,
kod przechwytywany jest z dispatchera; jeśli nie jest dostępny, pozostaje dokładny
kod SDK `network-failure`. Usunięto powtórne logowanie wyjątków w nadrzędnych
handlerach. Istniejącego audytu mutacji nie zmieniano na log transportowy.

Warmup czeka 15 sekund po wyczerpanej próbie inicjalizacji z błędem sieciowym.
Błąd terminalny zatrzymuje warmup; po naprawieniu konfiguracji potrzebny jest restart.
Dane testów i marker gotowości mają osobne katalogi tymczasowe.

## Konfiguracja

Wszystkie nowe ustawienia mają domyślne wartości; konfiguracja produkcyjna nie
została zmieniona. Szczegóły i walidacja są również w README.

| Env | Domyślnie | Zakres |
| --- | --- | --- |
| `ACTUAL_HTTP_KEEPALIVE_TIMEOUT_MS` | 2000 | Integer 1–4000 |
| `ACTUAL_HTTP_REQUEST_TIMEOUT_MS` | 15000 | Integer 1–300000; nagłówki i bezczynność body |
| `ACTUAL_SYNC_REQUEST_TIMEOUT_MS` | 15000 | Dodatnia skończona liczba; całe binarne żądanie sync wraz z body |
| `ACTUAL_HTTP_RETRY_ATTEMPTS` | 3 | Integer 1–5, razem z pierwszą próbą |
| `ACTUAL_HTTP_RETRY_DELAY_MS` | 500 | Integer 1–10000, mnożony przez numer nieudanej próby |

Błędne wartości zastępowane są domyślnymi. Dotychczasowe `ACTUAL_SYNC_TTL_MS` i
konfiguracja budżetu pozostają obsługiwane.

## Weryfikacja lokalna

Końcowe sprawdzenie: **Node v24.21.0**, taki jak wskazany runtime kontenera.
Node pobrany przez npm exec; cache npm ustawiony w `/tmp`.

| Polecenie | Wynik |
| --- | --- |
| `npm ci` | PASS; łatka SDK nałożona automatycznie |
| `npm run build` | PASS |
| `npm test` | PASS: **55 plików, 366 testów** |
| `npm run type-check` | PASS |
| `npm run lint` | PASS; lint bazy również przechodził |
| Osobne `npm ci --omit=dev` w katalogu tymczasowym | PASS; patch-package dostępny i łatka nałożona |
| `git diff --check` | PASS; kontekst unified diff dopuszcza taby przez atrybut dla patches |

Testy HTTP używają wyłącznie `127.0.0.1` i fikcyjnych danych:

- Serwer niszczy ponownie użyte gniazdo: wariant bez poprawki daje
  `TypeError: fetch failed`, przyczyna `UND_ERR_SOCKET`; krótki timeout powoduje
  otwarcie nowego gniazda i sukces.
- Ten sam scenariusz odzyskuje bezpieczny sync na dedykowanym połączeniu retry.
- Prawdziwe SDK z wcześniej przechwyconym fetch korzysta z dispatchera; prawdziwy
  login odzyskuje połączenie po zerwaniu, bez utraty kodu transportowego w logu.
- Test zapisu symuluje przyjęcie operacji przez serwer i zerwanie odpowiedzi:
  licznik zapisów wynosi jeden. Osobny test sprawdza błąd sync po mutacji.
- Sprawdzono timeout nagłówków i body sync, brak retry błędów terminalnych,
  limit prób, scope zasobów, warmup, redakcję logów oraz odtwarzanie timestampów.

Pierwotny pełny zestaw liczył 334 testy. Całą końcową sekwencję `npm ci`, build,
366 testów, type-check i lint powtórzono także na domyślnym **Node 26.3.1**: PASS.
Worktree pozostawiono z node_modules dla tego lokalnego runtime. Jeden pośredni
przebieg Node 26 po instalacji dla Node 24 zakończył się błędem ABI `better-sqlite3`;
czyste instalacje i kontrole wykonane osobno na każdej wersji rozwiązują ten problem.
Nie budowano obrazu Docker ani nie wykonywano testu z rzeczywistym serwerem Actual.

## Ryzyka i wdrożenie do wykonania osobno

- Hipoteza wyścigu keep-alive pozostaje hipotezą przyczyny awarii produkcyjnych.
  Lokalny test dowodzi zachowania przy zerwaniu podczas reuse i sposobu odzyskania,
  nie dowodzi przyczyny wszystkich 260 przypadków z dostarczonego opisu.
- Porównany `attempt-counts.txt` agreguje linie prób; sam nie wystarcza do dokładnego
  odtworzenia liczby incydentów i odzyskań. Nie kopiowano logów z identyfikatorami budżetu.
- Krótszy keep-alive i dedykowane pule retry zwiększają liczbę połączeń. Opóźnienia
  retry i limity zmniejszają ryzyko lawiny; nie powtarza się odpowiedzi rate limit.
- Limit 15 sekund może wymagać podniesienia dla dużego budżetu lub wolnego serwera.
  Timeout zwykłego HTTP jest limitem nagłówków/bezczynności body, nie całkowitym
  terminem powolnego, lecz stale przesyłanego downloadu.
- Łatka jest związana z SDK 26.9.0. Aktualizacja SDK wymaga jej ponownej oceny.
  Instalacja z `--ignore-scripts` omija postinstall i nie jest wspieraną ścieżką.
- `npm ci` nadal zgłasza podatności zależności (w tym critical). Nie wykonywano
  `npm audit fix`, aby nie mieszać modernizacji zależności z tą poprawką.

Do późniejszego wdrożenia: zbudować nowy, jednoznacznie oznaczony obraz ze źródeł
tej gałęzi standardowym Dockerfile; zachować poprzedni obraz i trwałe dane. Domyślne
nowe env wystarczają dla opisanego timeoutu serwera 5 s. Po osobnej autoryzacji
sprawdzić readiness, odczyt MCP, liczbę retry i logi bez danych wrażliwych.
Rollback: przywrócić poprzedni obraz i wcześniejsze env, bez kasowania katalogu
budżetu. Nie odwracać łatki ręcznie w działającym kontenerze.
