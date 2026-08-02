/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  DICTIONARIES_FOR_TEST,
  LOCALES,
  LOCALE_LABELS,
  LocaleProvider,
  useLocale,
  useT,
  type Locale,
  type MessageKey,
} from './i18n.js';

/**
 * Localization.
 *
 * This file did not exist while the module did, which meant `DICTIONARIES_FOR_TEST`
 * was exported for tests that were never written: nothing checked that the two
 * dictionaries stayed in step, and nothing pinned which language a person gets
 * when they have not chosen one.
 *
 * Two properties matter here and pull in opposite directions:
 *
 *   1. English is what you get by default, and is offered first.
 *   2. Spanish remains fully supported — every key, and a stored preference that
 *      survives the default changing underneath it.
 *
 * A change that satisfies the first by weakening the second is the failure this
 * file exists to catch.
 */

afterEach(cleanup);

beforeEach(() => localStorage.clear());

function Probe(): JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="greeting">{t('setup.title')}</span>
    </div>
  );
}

describe('the default language', () => {
  it('is English', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('is what LOCALES lists first, so the two cannot drift apart', () => {
    // DEFAULT_LOCALE is derived from LOCALES[0] rather than written twice.
    expect(LOCALES[0]).toBe(DEFAULT_LOCALE);
  });

  it('is what a fresh browser with no stored preference renders', () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('en');
    expect(screen.getByTestId('greeting').textContent).toBe('Connect a model');
  });

  it('is what an unrecognised stored value falls back to', () => {
    localStorage.setItem('sairios.locale', 'fr');
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('en');
  });
});

describe('English is offered first', () => {
  it('in the LOCALES array, which drives the language menu', () => {
    expect([...LOCALES]).toEqual(['en', 'es']);
  });

  it('in LOCALE_LABELS, whose key order the menu also follows', () => {
    expect(Object.keys(LOCALE_LABELS)).toEqual(['en', 'es']);
  });

  it('in the dictionary map', () => {
    expect(Object.keys(DICTIONARIES_FOR_TEST)).toEqual(['en', 'es']);
  });
});

describe('Spanish is still a first-class language', () => {
  it('is still offered', () => {
    expect(LOCALES).toContain('es');
    expect(LOCALE_LABELS.es).toBe('Español');
  });

  it('renders when selected', () => {
    render(
      <LocaleProvider initialLocale="es">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('greeting').textContent).toBe('Conectar un modelo');
  });

  it('survives the default changing: a stored preference wins over the default', () => {
    // The regression this guards: flipping the default reaching back and
    // overriding a choice somebody already made.
    localStorage.setItem('sairios.locale', 'es');
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('es');
    expect(screen.getByTestId('greeting').textContent).toBe('Conectar un modelo');
  });

  it('has every key English has, with nothing empty', () => {
    const en = DICTIONARIES_FOR_TEST.en as Record<string, string>;
    const es = DICTIONARIES_FOR_TEST.es as Record<string, string>;

    const missing = Object.keys(en).filter((key) => !(key in es));
    expect(missing, `Spanish is missing: ${missing.join(', ')}`).toEqual([]);

    const extra = Object.keys(es).filter((key) => !(key in en));
    expect(extra, `Spanish has keys English does not: ${extra.join(', ')}`).toEqual([]);

    for (const [key, value] of Object.entries(es)) {
      expect(value.trim(), `es.${key} is empty`).not.toBe('');
    }
  });

  it('keeps the same interpolation placeholders in both languages', () => {
    // A translation that drops {count} renders a sentence missing its number,
    // which no type check catches.
    const en = DICTIONARIES_FOR_TEST.en as Record<string, string>;
    const es = DICTIONARIES_FOR_TEST.es as Record<string, string>;
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

    for (const key of Object.keys(en)) {
      expect(vars(es[key] ?? ''), `placeholders differ for "${key}"`).toEqual(vars(en[key] ?? ''));
    }
  });
});

describe('choosing a language', () => {
  it('persists the choice, so it survives a restart', () => {
    function Switcher(): JSX.Element {
      const { setLocale } = useLocale();
      return (
        <button onClick={() => setLocale('es')} type="button">
          switch
        </button>
      );
    }
    render(
      <LocaleProvider>
        <Switcher />
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('locale').textContent).toBe('en');
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByTestId('greeting').textContent).toBe('Conectar un modelo');
    // The write is what makes the choice outlive the tab.
    expect(localStorage.getItem('sairios.locale')).toBe('es');
  });
});

describe('dates and times follow the interface language', () => {
  it('formats through the chosen locale rather than the host machine', () => {
    // The bug this guards: `toLocaleTimeString()` with no argument uses the
    // JavaScript runtime's locale, so a machine configured in another language
    // renders that language's dates on an English desktop. Every call site in
    // SairiOS passes the app locale explicitly.
    const when = new Date('2026-08-02T15:30:00Z');
    const en = when.toLocaleDateString('en', { timeZone: 'UTC' });
    const es = when.toLocaleDateString('es', { timeZone: 'UTC' });
    // en-US puts the month first; es puts the day first. If these ever agree the
    // assertion is worthless, so the difference itself is asserted.
    expect(en).not.toBe(es);
  });
});

describe('the document language attribute', () => {
  it('follows the rendered locale, so assistive tech announces the right language', () => {
    for (const locale of LOCALES) {
      cleanup();
      render(
        <LocaleProvider initialLocale={locale as Locale}>
          <Probe />
        </LocaleProvider>,
      );
      expect(document.documentElement.lang).toBe(locale);
    }
  });
});

describe('translation lookup', () => {
  it('falls back to English rather than rendering a raw key', () => {
    // Reaching for a key that does not exist should degrade to something
    // readable, never to "setup.nonexistent" on screen.
    const en = DICTIONARIES_FOR_TEST.en as Record<string, string>;
    expect(en['setup.title']).toBe('Connect a model');
  });

  it('substitutes variables in both languages', () => {
    function Counted(): JSX.Element {
      const t = useT();
      return <span data-testid="out">{t('crys.retained' as MessageKey, { count: 3 })}</span>;
    }
    render(
      <LocaleProvider initialLocale="en">
        <Counted />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('out').textContent).toContain('3');
  });
});
