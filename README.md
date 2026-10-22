# Actual Budget MCP Server

Krzysztof's Actual Budget MCP fork for safe, complete day-to-day financial management by AI assistants.

## Overview

The Actual Budget MCP Server allows you to interact with your personal financial data from [Actual Budget](https://actualbudget.com/) using natural language through LLMs. It exposes your accounts, transactions, and financial metrics through the Model Context Protocol (MCP).

## Features

### Resources

- **Account Listings** - Browse all your accounts with their balances
- **Account Details** - View detailed information about specific accounts
- **Transaction History** - Access transaction data with complete details

### Tools

#### Transaction & Account Management

- **`get-transactions`** - Retrieve and filter transactions by account, date, amount, category, or payee, including native transfer and schedule link IDs. Omitting `startDate`, `endDate`, or `limit` leaves that bound unrestricted; an explicit positive `limit` is applied after all other filters.
- **`create-transaction`** - Create a new transaction in an account with optional category, payee, notes, and split children. Each split child can use its own existing payee by exact ID or unique case-insensitive name.
- **`update-transaction`** - Update an existing transaction with new category, payee, notes, amount, or a full replacement list of split children. Split children can share a category while using different payees.
- **`get-accounts`** - Retrieve a list of all accounts with their current balance and ID
- **`balance-history`** - View balance changes for one account or, when `accountId` is omitted, an aggregate of open on-budget accounts. `months` defaults to 3; `includeOffBudget` affects only aggregate reports.
- **`delete-transaction`**, **`import-transactions`** - Delete or reconcile/import transactions, including split children with independent payees
- **`create-account`**, **`update-account`**, **`close-account`**, **`reopen-account`**, **`delete-account`** - Full account lifecycle
- **`reconcile-account`** - Create and verify an explicit balance adjustment

#### Budget

- **`get-budget-month`**, **`set-budget-amount`**, **`move-budget`** - Read and edit monthly category budgets
- **`set-budget-carryover`**, **`hold-budget-for-next-month`**, **`reset-budget-hold`** - Manage rollover and held money
- **`apply-budget-strategy`** - Preview or apply batch zero/copy-previous strategies. `dryRun` is required so every request explicitly chooses preview or write.

#### Schedules, tags, and notes

- **`get-schedules`**, **`create-schedule`**, **`update-schedule`**, **`delete-schedule`**
- **`match-transaction-to-schedule`** - Link one exact transaction UUID to a schedule UUID or unique case-insensitive name
- **`unmatch-transaction-from-schedule`** - Remove only the schedule link from one exact transaction UUID
- **`get-tags`**, **`create-tag`**, **`update-tag`**, **`delete-tag`**, **`assign-transaction-tag`**
- **`get-note`**, **`update-note`** - Read, set, or clear generic entity notes

Actual stores a posted schedule occurrence directly on the transaction in the native `transactions.schedule` field. These tools use the public `@actual-app/api.updateTransaction` mutation with either the schedule UUID or `null`, matching Actual 26.8.1's own Link schedule / Unlink schedule behavior. They reject automatic reassignment from another schedule and verify both the link and the transaction's protected financial fields by readback.

When `update-schedule.resetNextDate` is omitted, the next occurrence is recalculated only if the schedule date or recurrence changes. An explicit boolean overrides that behavior.

Transaction updates preserve the source transaction ID and use Actual's native transfer engine.
Readback verifies transfers in both directions: normal-to-transfer requires a reciprocal counterpart,
and transfer-to-normal requires removal of the old standalone counterpart. Actual detaches a counterpart
that belongs to another split in place; readback checks that its transfer link and payee are cleared.
An empty grouped `subtransactions` array is treated as a standalone transaction.
Readback matches children by supplied ID or by their requested fields, independently of native sort order,
and checks reciprocal links and amounts for transfer counterparts. Readback accepts native category clearing
for off-budget source accounts and transfers between accounts of the same budget type. `get-transactions` includes split child details.
A `TRANSACTION_UPDATE_READBACK_MISMATCH` after a write includes JSON with `writeAttempted`,
`rollbackPerformed`, `state`, `retrySafe`, `before`, `observed`, `counterparts`, and `counterpartStates`.
`counterpartStates` includes checked counterpart IDs and their observed records, or `null` when no active record exists.
Amounts in these snapshots use Actual's integer minor units. `state: "unknown"` means readback failed;
otherwise the snapshots describe the observed state after the write. No automatic rollback is performed.
Do not blindly retry: first inspect the reported state and read the transaction again.
Invalid split totals are rejected before writing.

#### Reporting & Analytics

- **`spending-by-category`** - Generate spending breakdowns categorized by type. Omitted date bounds are unrestricted; income is excluded unless `includeIncome` is true.
- **`monthly-summary`** - Get monthly income, expenses, and savings metrics. `months` is a positive integer and defaults to 3.

#### Categories

- **`get-grouped-categories`** - Retrieve a list of all category groups with their categories
- **`create-category`** - Create a new category within a category group
- **`update-category`** - Update an existing category's name or group
- **`delete-category`** - Delete a category
- **`create-category-group`** - Create a new category group
- **`update-category-group`** - Update a category group's name
- **`delete-category-group`** - Delete a category group

#### Payees

- **`get-payees`** - Retrieve a list of all payees with their details
- **`create-payee`** - Create a new payee
- **`update-payee`** - Update an existing payee's details
- **`delete-payee`** - Delete a payee
- **`merge-payees`** - Merge duplicate payees into a selected target

#### Rules

- **`get-rules`** - Retrieve a list of all transaction rules
- **`create-rule`** - Create a new transaction rule with conditions and actions
- **`update-rule`** - Update an existing transaction rule
- **`delete-rule`** - Delete a transaction rule

Split amount actions use Actual's native `options.method`: `fixed-amount`,
`fixed-percent`, `remainder`, or `formula`. Create and update accept the same shape;
get-rules returns native actions without rewriting formulas. For example:

```json
{
  "op": "set-split-amount",
  "field": null,
  "value": null,
  "options": {
    "splitIndex": 1,
    "method": "formula",
    "formula": "=INTEGER_TO_AMOUNT(parent_amount) * 0.5"
  }
}
```

Split indexes start at 1. A formula must start with `=` and contain an expression.
Formula/remainder actions use `value: null` (legacy `0` is accepted); fixed amounts
use integer cents and fixed percentages use a number from 0 to 100. Formulas
return major currency units, which Actual converts to cents. Do not attach a
formula to a fixed or remainder action. Conditions can inspect `notes`.

Parent text variables (`parent_notes`, `parent_imported_payee`, `parent_payee`,
`parent_account`) require the corresponding Actual rules-engine enhancement in
**every client that executes rules**, including the API used by bank importers.
MCP only passes the native formula through; it does not implement an evaluator,
transaction watcher, or a processing database.


#### Bank synchronization

- **`run-bank-sync`** - Queue a real bank sync for all, on-budget, off-budget, or one existing account. `scope` is required; an empty request never defaults to all accounts.
- **`get-bank-sync-status`** - Read durable asynchronous job status and history

All mutating tools require an `operationId` idempotency key. They are serialized, synchronized before and after execution, audited, and validated with a readback. Amounts in write-tool inputs are exact decimal strings such as `"123.45"`. Conversational confirmation policy belongs to the AI client; the MCP enforces deterministic validation and safety invariants.

### Prompts

- **`financial-insights`** - Generate insights and recommendations. Omitted dates use a recent three-month period ending today (or ending at an explicitly supplied `endDate`).
- **`budget-review`** - Analyze your budget compliance and suggest adjustments. `months` defaults to 3 and must be a positive integer.

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v24 or higher)
- [Actual Budget](https://actualbudget.com/) installed and configured
- [Claude Desktop](https://claude.ai/download) or another MCP-compatible client
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (optional)

### Remote access

Pull the latest docker image:

```
docker pull ghcr.io/krzysztofwojt/actual-mcp:latest
```

### Local setup

1. Clone the repository:

```bash
git clone https://github.com/krzysztofwojt/actual-mcp.git
cd actual-mcp
```

2. Install dependencies:

```bash
npm install
```

3. Build the server:

```bash
npm run build
```

4. Build the local docker image (optional):

```bash
docker build -t <local-image-name> .
```

5. Configure environment variables (optional):

```bash
# Path to your Actual Budget data directory (default: ~/.actual)
export ACTUAL_DATA_DIR="/path/to/your/actual/data"

# If using a remote Actual server
export ACTUAL_SERVER_URL="https://your-actual-server.com"
export ACTUAL_PASSWORD="your-password"

# Specific budget to use. Optional only when the server exposes exactly one budget.
export ACTUAL_BUDGET_SYNC_ID="your-budget-id"

# How long downloaded data stays fresh before the server re-syncs, in ms
# (default: 0). Use 0 to sync before every call, or -1 to never sync.
export ACTUAL_SYNC_TTL_MS="60000"
```

Optional: separate encryption budget password

If your Actual setup requires a different password to unlock the local/encrypted budget data than the server authentication password, you can set `ACTUAL_BUDGET_ENCRYPTION_PASSWORD` in addition to `ACTUAL_PASSWORD`.

```bash
# If server auth and encryption/unlock use different passwords
export ACTUAL_BUDGET_ENCRYPTION_PASSWORD="your-encryption-password"
```

## Usage with Claude Desktop

To use this server with Claude Desktop, add it to your Claude configuration:

On MacOS:

```bash
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

On Windows:

```bash
code %APPDATA%\Claude\claude_desktop_config.json
```

Add the following to your configuration...

### a. Using Node.js (npx version):

```json
{
  "mcpServers": {
    "actualBudget": {
      "command": "npx",
      "args": ["-y", "github:krzysztofwojt/actual-mcp", "--enable-write"],
      "env": {
        "ACTUAL_DATA_DIR": "path/to/your/data",
        "ACTUAL_PASSWORD": "your-password",
        "ACTUAL_SERVER_URL": "http://your-actual-server.com",
        "ACTUAL_BUDGET_SYNC_ID": "your-budget-id"
      }
    }
  }
}
```

### a. Using Node.js (local only):

```json
{
  "mcpServers": {
    "actualBudget": {
      "command": "node",
      "args": ["/path/to/your/clone/build/index.js", "--enable-write"],
      "env": {
        "ACTUAL_DATA_DIR": "path/to/your/data",
        "ACTUAL_PASSWORD": "your-password",
        "ACTUAL_SERVER_URL": "http://your-actual-server.com",
        "ACTUAL_BUDGET_SYNC_ID": "your-budget-id"
      }
    }
  }
}
```

### b. Using Docker (local or remote images):

```json
{
  "mcpServers": {
    "actualBudget": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "/path/to/your/data:/data",
        "-e",
        "ACTUAL_PASSWORD=your-password",
        "-e",
        "ACTUAL_SERVER_URL=https://your-actual-server.com",
        "-e",
        "ACTUAL_BUDGET_SYNC_ID=your-budget-id",
        "ghcr.io/krzysztofwojt/actual-mcp:latest",
        "--enable-write"
      ]
    }
  }
}
```

After saving the configuration, restart Claude Desktop.

> 💡 `ACTUAL_DATA_DIR` is optional if you're using `ACTUAL_SERVER_URL`.

> 💡 Use `--enable-write` to enable write-access tools.

## Running an SSE Server

To expose the server over a port using Docker:

```bash
docker run -i --rm \
  -p 3000:3000 \
  -v "/path/to/your/data:/data" \
  -e ACTUAL_PASSWORD="your-password" \
  -e ACTUAL_SERVER_URL="http://your-actual-server.com" \
  -e ACTUAL_BUDGET_SYNC_ID="your-budget-id" \
  -e BEARER_TOKEN="your-bearer-token" \
  ghcr.io/krzysztofwojt/actual-mcp:latest \
  --sse --enable-write --enable-bearer
```

> ⚠️ Important: When using --enable-bearer, the BEARER_TOKEN environment variable must be set.  
> 🔒 This is highly recommended if you're exposing your server via a public URL.

## Example Queries

Once connected, you can ask Claude questions like:

- "What's my current account balance?"
- "Show me my spending by category last month"
- "How much did I spend on groceries in January?"
- "What's my savings rate over the past 3 months?"
- "Analyze my budget and suggest areas to improve"

## Usage with Codex CLI

Example Codex configuration:

In `~/.codex/config.toml`:
```toml
[mcp_servers.actual-budget]
url = "http://localhost:3000"
```

Point Codex at the same port you pass to `npm start -- --sse --port <PORT>`.

## Reproducible Actual SDK patches

`npm ci` applies the versioned patch in `patches/` using `patch-package` and fails
if it cannot be applied. Actual API/core are pinned to 26.9.0 to match the NAS
snapshot. The patch preserves bounded binary sync requests and split parent-field
handling. Build history and source reconciliation: [NAS notes](deploy/nas-20260930/README.md).

## Actual HTTP connections

Actual requests use an origin-scoped Undici dispatcher compatible with Node 24's
built-in `fetch`, including the function cached by `@actual-app/api`. Other origins
retain their previous dispatcher. No request is replayed by this dispatcher.

`ACTUAL_HTTP_KEEPALIVE_TIMEOUT_MS` defaults to **2000 ms** (positive integer,
maximum 4000 ms; invalid values use the default). It caps both the ordinary idle
timeout and server keep-alive hints; a 1000 ms threshold is subtracted from hints.
This keeps idle connections below the Actual server's 5-second timeout. Adjust
the value downward if your server uses a shorter idle timeout.

Safe retries are limited to login, budget download, and CRDT synchronization.
Each retry uses a separate Agent and fresh connection. Financial mutation handlers,
imports, transfers, and bank sync are called once. A failure after a mutation
starts returns `MUTATION_OUTCOME_UNCERTAIN`; reconcile state before submitting again.
The completed-operation ledger does not establish exactly-once delivery for failed
or interrupted operations.

| Variable | Default | Accepted values |
| --- | --- | --- |
| `ACTUAL_HTTP_REQUEST_TIMEOUT_MS` | 15000 | Integer 1–300000; response header and idle body timeout |
| `ACTUAL_SYNC_REQUEST_TIMEOUT_MS` | 15000 | Positive finite number; absolute binary sync deadline including response body |
| `ACTUAL_HTTP_RETRY_ATTEMPTS` | 3 | Integer 1–5, including the initial attempt |
| `ACTUAL_HTTP_RETRY_DELAY_MS` | 500 | Integer 1–10000, multiplied by the failed attempt number |

Invalid values use defaults. Retry logs contain only operation, attempt, error
code, fresh-connection flag, elapsed time and retry decision. Recovery emits one
summary. No URL, credentials, budget IDs, financial payload or stack is logged by
the retry layer. Authentication rejection, certificate errors, HTTP rate limits
and unknown errors are not retried. The HTTP warmup remains a background readiness
loop with a 15-second pause between network-failed initialization cycles; terminal
configuration or authentication errors stop warmup until configuration is fixed
and the process is restarted.

## Development

For development with auto-rebuild:

```bash
npm run watch
```

### Testing the connection to Actual

To verify the server can connect to your Actual Budget data:

```bash
node build/index.js --test-resources
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. You can use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

## Project Structure

- `index.ts` - Main server implementation
- `types.ts` - Type definitions for API responses and parameters
- `prompts.ts` - Prompt templates for LLM interactions
- `utils.ts` - Helper functions for date formatting and more

## Fork Modifications

This public fork tracks upstream while using independent versions such as `1.12.1-kwojt.1` and images at `ghcr.io/krzysztofwojt/actual-mcp`.

- Actual Server and `@actual-app/api` are pinned together; this release uses `26.8.1`.
- Mutations use a durable idempotency ledger and structured audit logs retained for three months.
- Exact ID or unique case-insensitive name resolution is supported; fuzzy write matching is intentionally rejected.
- Bank synchronization is asynchronous and rejects concurrent runs.
- The fork adds complete budget primitives, account lifecycle/reconciliation, schedules (including explicit transaction match/unmatch), tags, generic notes, and payee merging.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
