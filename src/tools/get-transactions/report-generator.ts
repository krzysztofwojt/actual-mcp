// Generates the response/report for get-transactions tool
import type { MappedTransaction } from './transaction-mapper.js';

export class GetTransactionsReportGenerator {
  generate(
    mappedTransactions: MappedTransaction[],
    filterDescription: string,
    filteredCount: number,
    totalCount: number
  ): string {
    const header =
      '| ID | Date | Payee | Category | Amount | Cleared | Notes | Transfer | Schedule |\n| ---- | ----- | -------- | ------ | ----- | ------- | ----- | -------- | -------- |\n';
    const splitLabels = mappedTransactions
      .filter((t) => t.subtransactions?.length)
      .map((t) => `Split parent ${t.id} (${t.subtransactions!.length} children)`)
      .join('\n');
    const rows = mappedTransactions.flatMap((t) => this._rowsFor(t)).join('\n');
    return `# Filtered Transactions\n\n${filterDescription}\nMatching Transactions: ${filteredCount}/${totalCount}\n\n${header}${rows}\n${splitLabels}`;
  }

  // Reason: A split's subtransactions are rendered as extra rows right under their parent
  // (id prefixed with "↳") so a subtransaction's id — needed to target it with
  // update-transaction, e.g. to turn one leg into a transfer — is visible without adding a
  // second table or changing the column count consumers already parse.
  private _rowsFor(t: MappedTransaction): string[] {
    const parentRow = `| ${t.id} | ${t.date} | ${t.payee} | ${t.category} | ${t.amount} | ${t.cleared} | ${t.notes} | ${t.transferId} | ${t.scheduleId ?? ''} |`;
    const subRows = (t.subtransactions ?? []).map(
      (sub) =>
        `| ↳ ${sub.id} | ${sub.date} | ${sub.payee} | ${sub.category} | ${sub.amount} | ${sub.cleared} | ${sub.notes} | ${sub.transferId} | ${sub.scheduleId ?? ''} |`
    );
    return [parentRow, ...subRows];
  }
}
