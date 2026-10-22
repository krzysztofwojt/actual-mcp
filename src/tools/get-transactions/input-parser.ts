// Parses and validates input arguments for get-transactions tool

import { GetTransactionsArgs, GetTransactionsArgsSchema } from '../../types.js';

export class GetTransactionsInputParser {
  parse(args: unknown): GetTransactionsArgs {
    if (!args || typeof args !== 'object') throw new Error('Arguments must be an object');
    return GetTransactionsArgsSchema.parse(args);
  }
}
