// Parses and validates input arguments for spending-by-category tool

import { SpendingByCategoryArgsSchema } from '../../types.js';

export interface SpendingByCategoryInput {
  startDate?: string;
  endDate?: string;
  accountId?: string;
  includeIncome: boolean;
}

export class SpendingByCategoryInputParser {
  parse(args: unknown): SpendingByCategoryInput {
    return SpendingByCategoryArgsSchema.parse(args);
  }
}
