/**
 * Brand configuration.
 *
 * The reference (live deployment) resolves the brand per vendor from the
 * desktop shell's User-Agent token. This workspace has no vendor shell: the
 * product ships with its own single brand, so the config is static and the
 * desktop flag is always off. The shape is kept so surfaces that read the
 * brand (home hero, workspace rail, site header) keep one source of truth.
 */

export interface BrandConfig {
  /** Full product name (page titles, logo alt text). Always the Latin name. */
  productName: string;
  /** Short name for space-constrained spots. */
  shortName: string;
  /**
   * The name to actually render, resolved for the active locale: `shortName` on
   * Chinese locales, `productName` everywhere else. BrandProvider fills this in
   * from the live i18n language; `DEFAULT_BRAND` carries the default-locale
   * value so un-provisioned reads stay correct. Render sites use this field and
   * never pick between the two names themselves.
   */
  displayName: string;
  /** Horizontal logo asset under `public/`. */
  logoSrc: string;
  /** Whether `logoSrc` already carries the product wordmark. */
  logoHasWordmark: boolean;
  /** Square brand mark under `public/` (favicon, workspace header). */
  markSrc: string;
  /** Browser theme color (`<meta name="theme-color">` / PWA). */
  themeColor: string;
}

/** The default brand: the product itself, with no vendor overrides. */
export const DEFAULT_BRAND: BrandConfig = {
  productName: 'CheeyooClassroom',
  shortName: '启云课堂',
  // The default locale (zh-CN) is also what i18n starts on and what the server
  // renders, so this matches BrandProvider's first client render — no mismatch.
  displayName: '启云课堂',
  logoSrc: '/logo-horizontal.png',
  logoHasWordmark: true,
  markSrc: '/logo.png',
  // Must stay in step with --primary in app/brand.css. This one is a meta tag
  // for the browser chrome; the token drives the UI itself.
  themeColor: '#e8884a',
};

/** Picks the render name for a locale: Chinese gets the Chinese name. */
export function resolveBrand(brand: BrandConfig, locale: string): BrandConfig {
  return {
    ...brand,
    displayName: locale.toLowerCase().startsWith('zh') ? brand.shortName : brand.productName,
  };
}
