// Generates the markdown report for spending-by-category tool
import type { GroupSpending } from './types.js';
import { formatAmount } from '../../utils.js';

export class SpendingByCategoryReportGenerator {
  generate(
    sortedGroups: GroupSpending[],
    period: { start?: string; end?: string },
    accountLabel: string,
    includeIncome: boolean
  ): string {
    let markdown = `# Spending by Category\n\n`;
    const periodLabel = period.start
      ? period.end
        ? `${period.start} to ${period.end}`
        : `on or after ${period.start}`
      : period.end
        ? `on or before ${period.end}`
        : 'all available history';
    markdown += `Period: ${periodLabel}\n\n`;
    markdown += `${accountLabel}\n\n`;
    markdown += `Income categories: ${includeIncome ? 'Included' : 'Excluded'}\n\n`;
    sortedGroups.forEach((group) => {
      markdown += `## ${group.name}\n`;
      markdown += `Total: ${formatAmount(group.total)}\n\n`;
      markdown += `| Category | Amount | Transactions |\n`;
      markdown += `| -------- | ------ | ------------ |\n`;
      group.categories.forEach((category) => {
        markdown += `| ${category.name} | ${formatAmount(category.total)} | ${category.transactions} |\n`;
      });
      markdown += `\n`;
    });
    return markdown;
  }
}
