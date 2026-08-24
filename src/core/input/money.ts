const MONEY_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

/** Convert an exact decimal currency string to Actual's integer minor units. */
export function parseMoney(value: string): number {
  if (!MONEY_PATTERN.test(value)) throw new Error(`INVALID_AMOUNT: expected a decimal string, received ${value}`);
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) throw new Error('INVALID_AMOUNT: value exceeds the safe supported range');
  return negative ? -minor : minor;
}

export function formatMoney(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error('INVALID_MINOR_AMOUNT');
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(minor);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}
