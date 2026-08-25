import { MonthlySummaryArgsSchema } from '../../types.js';

export class MonthlySummaryInputParser {
  parse(args: unknown): { months: number; accountId?: string } {
    return MonthlySummaryArgsSchema.parse(args);
  }
}
