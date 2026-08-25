// Parses and validates input arguments for get-transactions tool

import { GetTransactionsArgs, GetTransactionsArgsSchema } from '../../types.js';

export class GetTransactionsInputParser {
  parse(args: unknown): GetTransactionsArgs {
    return GetTransactionsArgsSchema.parse(args);
  }
}
