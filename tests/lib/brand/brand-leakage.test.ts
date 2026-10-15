import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_BRAND, resolveBrand } from '@/lib/brand/brand-config';

/**
 * The product was renamed away from "OpenMAIC"; no user-visible surface may
 * still say it. This pins that promise, because a rebrand that is applied by
 * hand greps once drifts the next time someone adds a string.
 *
 * "User-visible" means: anything rendered in the app, and anything that ends
 * up inside a downloaded export — its text, its DOM ids, and its filenames.
 * The export roots are in SCANNED_ROOTS for exactly that reason; an earlier
 * version of this file scanned only the app, and the default video manifest
 * filename (`openmaic-video-manifest.json`) sailed straight through it.
 *
 * What is deliberately NOT policed, and why:
 *   - The npm scope `@openmaic/*`, the 30-odd `OPENMAIC_*` env vars, storage
 *     keys, `Symbol.for('openmaic.*')` and the `X-OpenMAIC-*` HTTP headers.
 *     Those are deployment and wire contracts; renaming them is a migration,
 *     not a copy change.
 *   - The server-rendered `<title>`, which stays the Latin `productName`
 *     because Next.js metadata cannot follow the client locale.
 *   - The JavaScript globals and data attributes listed in FROZEN_TOKENS. They
 *     reach the exported HTML but are read by the player at runtime, not by a
 *     person; renaming them is a separate call.
 */

const SCANNED_ROOTS = [
  'app',
  'components',
  'lib/i18n',
  'lib/export',
  'lib/video-export',
  'lib/video-export-app',
  'lib/standalone-player',
  'lib/legacy-browser-import',
  'e2e',
] as const;

const SCANNED_EXT = /\.(ts|tsx|json)$/;

/**
 * Exact strings allowed to carry the old name, each for a stated reason.
 * Anything added here is a decision to keep an old-branded identifier, so it
 * belongs in the list deliberately rather than by accident.
 */
const FROZEN_TOKENS = [
  // HTTP headers, client <-> render-service and the legacy import route.
  /x-openmaic-[A-Za-z-]+/gi,
  // npm scope of the six published packages (the `\/` form appears inside a
  // regex literal in legacy-browser-import/sources.ts).
  /@openmaic(?:\\|\/)[^'"\s]*/g,
  // JS globals and placeholders inside the exported HTML.
  /__OPENMAIC_[A-Z_]+__/g,
  /openmaicVideoDiagnostics/g,
  /openmaicInteractiveReady/g,
  /openmaicInteractiveStatic/g,
  /openmaicFreezeInteractive/g,
  /initializeOpenMaic[A-Za-z]*/g,
  // data attributes the app sets on the exported player before capture.
  /openmaic-runtime-diagnostics/g,
  /openmaic-static-(?:state|frozen|csp|capture)/g,
  // Persisted ids: renaming these invalidates every stored manifest.
  /openmaic\.videoTimeline/g,
  /openmaic-video-timeline/g,
  // localStorage / BroadcastChannel lock names, and the access-code cookie.
  /openmaic:[a-z-]+/g,
  /openmaic_access/g,
  // MIME type on the asset-descriptor response.
  /vnd\.openmaic\./g,
  // Test-only fake hostname.
  /openmaic-http\.test/g,
  // Kimi's affiliate referral code on the provider signup links. Not our brand
  // — it is Kimi's attribution parameter, and only Kimi can issue a new one.
  /[?&]aff=openmaic\b/g,
] as const;

/**
 * Comments are the one place the old name legitimately survives, so they are
 * removed before the search. `[^:]` keeps the `//` in a URL from eating the
 * rest of the line.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Comments out, frozen identifiers removed: what a reader could actually see. */
function userVisibleText(source: string): string {
  const stripped = codeOnly(source);
  return FROZEN_TOKENS.reduce((text, pattern) => text.replace(pattern, ''), stripped);
}

function sourceFilesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFilesUnder(path, found);
    } else if (SCANNED_EXT.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

function leaks(): string[] {
  const hits: string[] = [];
  for (const root of SCANNED_ROOTS) {
    for (const file of sourceFilesUnder(root)) {
      userVisibleText(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, index) => {
          if (/openmaic/i.test(line)) hits.push(`${file}:${index + 1}: ${line.trim()}`);
        });
    }
  }
  return hits;
}

describe('the old product name does not leak into user-visible surfaces', () => {
  it('finds no OpenMAIC outside comments and the frozen identifiers', () => {
    expect(leaks()).toEqual([]);
  });

  // Without these the guard could pass by the scan being wrong rather than by
  // the rename being complete.
  it('would flag a rendered string', () => {
    expect(userVisibleText('const x = <img alt="OpenMAIC" />;')).toContain('OpenMAIC');
  });

  it('would flag an exported filename', () => {
    expect(userVisibleText(`const p = 'openmaic-video-manifest.json';`)).toContain('openmaic');
  });

  it('would flag an exported DOM id', () => {
    expect(userVisibleText(`const id = 'openmaic-player';`)).toContain('openmaic');
  });

  it('would not flag a comment', () => {
    expect(userVisibleText('// still called OpenMAIC internally')).not.toMatch(/openmaic/i);
    expect(userVisibleText('/* OpenMAIC fullscreen */')).not.toMatch(/openmaic/i);
  });

  it('would not flag a frozen identifier', () => {
    for (const sample of [
      `headers.get('X-OpenMAIC-Legacy-Import')`,
      `import type { Slide } from '@openmaic/dsl';`,
      `const s = 'openmaic.videoTimeline';`,
      `data-openmaic-runtime-diagnostics`,
      `__OPENMAIC_QUIZ_FONT_BASE__`,
    ]) {
      expect(userVisibleText(sample), sample).not.toMatch(/openmaic/i);
    }
  });
});

describe('the new product name resolves per locale', () => {
  it('shows the Chinese name on Chinese locales and the Latin one elsewhere', () => {
    for (const locale of ['zh-CN', 'zh-TW']) {
      expect(resolveBrand(DEFAULT_BRAND, locale).displayName).toBe('启云课堂');
    }
    for (const locale of ['en-US', 'ja-JP', 'de-DE', 'ar-SA']) {
      expect(resolveBrand(DEFAULT_BRAND, locale).displayName).toBe('CheeyooClassroom');
    }
  });

  it('defaults to the default locale, which is what the server render uses', () => {
    expect(DEFAULT_BRAND.displayName).toBe('启云课堂');
  });
});
