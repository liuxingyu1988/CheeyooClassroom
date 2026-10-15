'use client';

/**
 * Brand context.
 *
 * The reference resolves the brand and the desktop flag on the server per
 * request (vendor UA parsing) and injects them through the provider. This
 * workspace is single-brand and has no desktop shell, so the provider accepts
 * the values as props (for future wiring) and defaults to the static brand /
 * non-desktop.
 *
 * The provider additionally resolves `displayName` against the live i18n
 * language, so Chinese locales render 启云课堂 and the rest render the Latin
 * name. i18n starts on the default locale (zh-CN) and only switches after
 * hydration, so the server render and the first client render agree.
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import i18n from '@/lib/i18n/config';
import { DEFAULT_BRAND, resolveBrand, type BrandConfig } from './brand-config';

interface BrandContextValue {
  brand: BrandConfig;
  /** Whether the request came from a desktop client (vendor UA marker). */
  isDesktop: boolean;
}

const BrandContext = createContext<BrandContextValue>({
  brand: DEFAULT_BRAND,
  isDesktop: false,
});

function subscribeToLanguage(onStoreChange: () => void): () => void {
  i18n.on('languageChanged', onStoreChange);
  return () => {
    i18n.off('languageChanged', onStoreChange);
  };
}

function readLanguage(): string {
  return i18n.language;
}

export function BrandProvider({
  brand = DEFAULT_BRAND,
  isDesktop = false,
  children,
}: {
  brand?: BrandConfig;
  isDesktop?: boolean;
  children: React.ReactNode;
}) {
  const locale = useSyncExternalStore(subscribeToLanguage, readLanguage, readLanguage);

  const value = useMemo<BrandContextValue>(
    () => ({ brand: resolveBrand(brand, locale), isDesktop }),
    [brand, locale, isDesktop],
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandConfig {
  return useContext(BrandContext).brand;
}

export function useIsDesktop(): boolean {
  return useContext(BrandContext).isDesktop;
}
