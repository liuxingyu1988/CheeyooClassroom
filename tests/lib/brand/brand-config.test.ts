import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

describe('DEFAULT_BRAND (single-brand build)', () => {
  it('uses the product identity for full chrome', () => {
    expect(DEFAULT_BRAND.productName).toBe('CheeyooClassroom');
    expect(DEFAULT_BRAND.shortName).toBe('启云课堂');
    expect(DEFAULT_BRAND.markSrc).toBe('/logo.png');
    expect(DEFAULT_BRAND.themeColor).toBe('#e8884a');
  });

  it('marks its horizontal logo as already containing the wordmark', () => {
    expect(DEFAULT_BRAND.logoHasWordmark).toBe(true);
    expect(DEFAULT_BRAND.logoSrc).toBe('/logo-horizontal.png');
  });
});
