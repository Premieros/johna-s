import { describe, expect, it } from 'vitest';
import { formatAllocatedInvoiceNumber, normalizeInvoicePrefix } from '@/features/pos/utils/invoiceNumber';

describe('branch invoice prefix', () => {
  it('formats newly allocated sequence numbers with the branch prefix', () => {
    expect(formatAllocatedInvoiceNumber("JOHNA'S-00012", 12, '#S')).toBe('#S12');
    expect(formatAllocatedInvoiceNumber("JOHNA'S-00013", '13', '#C')).toBe('#C13');
  });

  it('preserves existing server numbering when no branch prefix is configured', () => {
    expect(formatAllocatedInvoiceNumber("JOHNA'S-00014", 14, null)).toBe("JOHNA'S-00014");
    expect(formatAllocatedInvoiceNumber("JOHNA'S-00015", 15, '')).toBe("JOHNA'S-00015");
  });

  it('can recover the raw sequence from the server number without keeping zero padding', () => {
    expect(formatAllocatedInvoiceNumber('POS-00016', undefined, '#A')).toBe('#A16');
  });

  it('sanitizes control characters and limits the prefix length', () => {
    expect(normalizeInvoicePrefix('  #S\n')).toBe('#S');
    expect(normalizeInvoicePrefix('123456789012345')).toBe('123456789012');
  });
});
