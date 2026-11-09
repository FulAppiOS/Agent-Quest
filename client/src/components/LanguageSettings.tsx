import { useRef, useState, type ChangeEvent } from 'react';
import {
  englishTemplate, getCustomLocale, installCustomLocale, localeOptions, parseCustomLocale,
  removeCustomLocale, setLocale, useI18n, type CustomLocaleReport, type LocaleId,
} from '../i18n';
import './LanguageSettings.css';

const ERROR_KEYS: Record<string, string> = {
  'invalid-json': 'language.errorInvalidJson',
  'not-object': 'language.errorNotObject',
  'no-strings': 'language.errorNoStrings',
};

/**
 * Language section of the Settings panel: pick a built-in locale, or load a
 * translated copy of the English template as a custom locale.
 */
export function LanguageSettings() {
  const { t, locale } = useI18n();
  const [report, setReport] = useState<CustomLocaleReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const custom = getCustomLocale();

  const onSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    setLocale(e.target.value as LocaleId);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    setError(null);
    setReport(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError(t('language.errorRead'));
      return;
    }
    try {
      const parsed = parseCustomLocale(text);
      installCustomLocale(parsed.locale);
      setReport(parsed.report);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(t(ERROR_KEYS[code] ?? 'language.errorInvalidJson'));
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([englishTemplate()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agent-quest.en.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onRemove = () => {
    removeCustomLocale();
    setReport(null);
    setError(null);
  };

  return (
    <>
      <div className="settings-section-label">{t('language.title')}</div>
      <div className="settings-row">
        <span className="settings-toggle-label">{t('language.label')}</span>
        <select className="settings-select" value={locale} onChange={onSelect} aria-label={t('language.label')}>
          {localeOptions().map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.id === 'custom' ? `${t('language.custom')}: ${opt.name}` : opt.name}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-muted">{t('language.hint')}</p>
      <div className="settings-row language-actions">
        <button className="settings-btn" onClick={() => fileRef.current?.click()}>{t('language.upload')}</button>
        <button className="settings-btn" onClick={downloadTemplate}>{t('language.downloadTemplate')}</button>
        {custom !== null && (
          <button className="settings-btn" onClick={onRemove}>{t('language.removeCustom')}</button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="language-file"
          onChange={(e) => { void onFile(e); }}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
      <p className="settings-muted">{t('language.uploadHint')}</p>
      {error !== null && <p className="settings-warn">{error}</p>}
      {report !== null && (
        <p className="settings-muted language-report">
          {t('language.reportLoaded', { name: report.name, matched: report.matched, total: report.total })}
          {report.missing.length > 0 && <> {t('language.reportMissing', { count: report.missing.length })}</>}
          {report.unknown.length > 0 && <> {t('language.reportUnknown', { count: report.unknown.length })}</>}
        </p>
      )}
    </>
  );
}
