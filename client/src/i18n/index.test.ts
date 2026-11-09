import { beforeEach, describe, expect, test } from 'bun:test';
import {
  englishTemplate, getLocale, hasMessage, installCustomLocale, localeOptions, parseCustomLocale,
  removeCustomLocale, setLocale, subscribe, t,
} from './index';

beforeEach(() => {
  removeCustomLocale();
  setLocale('en');
});

describe('t()', () => {
  test('English is the default locale', () => {
    expect(getLocale()).toBe('en');
    expect(t('language.title')).toBe('Language');
    expect(t('activity.reading')).toBe('reading');
  });

  test('switching to Korean swaps every string and notifies subscribers', () => {
    let notified = 0;
    const unsubscribe = subscribe(() => { notified += 1; });
    setLocale('ko');
    unsubscribe();
    expect(notified).toBe(1);
    expect(getLocale()).toBe('ko');
    expect(t('language.title')).toBe('언어');
    expect(t('activity.reading')).toBe('읽는 중');
    expect(t('building.library.name')).toBe('도서관');
  });

  test('interpolates placeholders and picks plural variants from count', () => {
    expect(t('boot.missingHeadline', { count: 1 })).toBe('Bundled asset pack is missing 1 file.');
    expect(t('boot.missingHeadline', { count: 3 })).toBe('Bundled asset pack is missing 3 files.');
    setLocale('ko');
    expect(t('boot.missingHeadline', { count: 1 })).toBe('번들된 에셋 팩에서 파일 1개가 누락되었습니다.');
    expect(t('language.reportLoaded', { name: 'X', matched: 2, total: 5 })).toBe('“X” 불러옴: 전체 5개 중 2개 번역됨.');
  });

  test('unknown keys render as the key itself', () => {
    expect(t('nope.missing')).toBe('nope.missing');
    expect(hasMessage('nope.missing')).toBe(false);
    expect(hasMessage('common.close')).toBe(true);
  });
});

describe('custom locale', () => {
  test('a translated template becomes a selectable locale and falls back to English', () => {
    const template = JSON.parse(englishTemplate()) as Record<string, unknown>;
    expect(Object.keys(template)).toContain('common');

    const file = JSON.stringify({
      meta: { name: 'Deutsch', code: 'de' },
      language: { title: 'Sprache' },
      common: { close: 'Schließen' },
      bogus: { key: 'ignored' },
    });
    const { locale, report } = parseCustomLocale(file);
    expect(report.name).toBe('Deutsch');
    expect(report.matched).toBe(2);
    expect(report.unknown).toEqual(['bogus.key']);
    expect(report.missing.length).toBe(report.total - 2);

    installCustomLocale(locale);
    expect(getLocale()).toBe('custom');
    expect(localeOptions().map((o) => o.id)).toEqual(['en', 'ko', 'custom']);
    expect(localeOptions()[2]?.name).toBe('Deutsch');
    expect(t('language.title')).toBe('Sprache');
    expect(t('common.close')).toBe('Schließen');
    // Missing key → English fallback.
    expect(t('language.label')).toBe('Interface language');

    removeCustomLocale();
    expect(getLocale()).toBe('en');
    expect(localeOptions().map((o) => o.id)).toEqual(['en', 'ko']);
  });

  test('accepts already-flattened dotted keys', () => {
    const { report } = parseCustomLocale(JSON.stringify({ 'language.title': 'Idioma' }));
    expect(report.matched).toBe(1);
    expect(report.name).toBe('Custom');
  });

  test('rejects bad input with error codes', () => {
    expect(() => parseCustomLocale('not json')).toThrow('invalid-json');
    expect(() => parseCustomLocale('[1,2]')).toThrow('not-object');
    expect(() => parseCustomLocale('{"x":{"y":"z"}}')).toThrow('no-strings');
  });

  test('cannot select custom when none is installed', () => {
    setLocale('custom');
    expect(getLocale()).toBe('en');
  });
});
