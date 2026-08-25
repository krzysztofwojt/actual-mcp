import { z } from 'zod';

export const AccountReferenceSchema = z.string().trim().min(1, 'account reference must not be empty');

export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const PositiveIntegerSchema = z
  .number()
  .finite('value must be a positive integer')
  .int('value must be a positive integer')
  .positive('value must be a positive integer');
