import { editorStore, useEditorStore } from '../state/editor-store';
import { useI18n } from '../../i18n';

/**
 * Non-blocking banner that appears at the top of the editor when one or
 * more textures failed to load during boot. The editor stays fully usable
 * — the banner just tells the user which *kind* of assets are missing and
 * points to a restore command. Dismissible per session.
 */
export function AssetWarningBanner() {
  const { t } = useI18n();
  const errors = useEditorStore((s) => s.assetErrors);
  const dismissed = useEditorStore((s) => s.assetErrorsDismissed);

  if (errors === null || dismissed) return null;

  const MAX_SAMPLES = 4;
  const samples = errors.samples.slice(0, MAX_SAMPLES);
  const overflow = errors.total - samples.length;

  return (
    <div className="editor-asset-banner" role="alert">
      <div className="editor-asset-banner-head">
        <span className="editor-asset-banner-icon" aria-hidden>⚠</span>
        <span className="editor-asset-banner-title">
          {t('editor.assets.failed', { count: errors.total })}
        </span>
        <button
          className="editor-asset-banner-dismiss"
          type="button"
          onClick={() => editorStore.dismissAssetErrors()}
          aria-label={t('common.dismiss')}
        >
          ×
        </button>
      </div>
      <div className="editor-asset-banner-body">
        <ul className="editor-asset-banner-cats">
          {errors.categories.map((c) => (
            <li key={c.id}>
              <strong>{c.label}:</strong> {c.count}
            </li>
          ))}
        </ul>
        <details className="editor-asset-banner-details">
          <summary>{t('editor.assets.showMissing')}</summary>
          <ul>
            {samples.map((p) => (
              <li key={p}><code>{p}</code></li>
            ))}
            {overflow > 0 && <li>{t('editor.assets.andMore', { count: overflow })}</li>}
          </ul>
          <p className="editor-asset-banner-hint">
            {t('editor.assets.restorePrefix')}<code>git checkout -- client/public/assets/themes/tiny-swords-cc0/</code>{t('editor.assets.restoreSuffix')}
          </p>
        </details>
      </div>
    </div>
  );
}
