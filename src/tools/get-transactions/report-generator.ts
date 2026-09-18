import type { MappedTransaction } from './transaction-mapper.js';

// Generates the response/report for get-transactions tool

export class GetTransactionsReportGenerator {
  generate(
    mappedTransactions: MappedTransaction[],
    filterDescription: string,
    filteredCount: number,
    totalCount: number
  ): string {
    const header =
      '| ID | Date | Payee | Category | Amount | Cleared | Notes | Transfer | Schedule |\n| ---- | ----- | -------- | ------ | ----- | ------- | ----- | -------- | -------- |\n';
    const rows = mappedTransactions
      .map(
        (t) =>
          `| ${t.id} | ${t.date} | ${t.payee} | ${t.category} | ${t.amount} | ${t.cleared} | ${t.notes} | ${t.transferId} | ${t.scheduleId} |`
      )
      .join('\n');
    const splits = mappedTransactions
      .filter((transaction) => transaction.subtransactions?.length)
      .map(
        (parent) =>
          `\n\nSplit parent ${parent.id} (${parent.subtransactions!.length} children):\n` +
          header +
          parent
            .subtransactions!.map(
              (child) =>
                `| ${child.id} | ${child.date} | ${child.payee} | ${child.category} | ${child.amount} | ${child.cleared} | ${child.notes} | ${child.transferId} | ${child.scheduleId} |`
            )
            .join('\n')
      )
      .join('');
    return `# Filtered Transactions\n\n${filterDescription}\nMatching Transactions: ${filteredCount}/${totalCount}\n\n${header}${rows}${splits}`;
  }
}
