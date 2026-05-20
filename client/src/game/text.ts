import * as Phaser from 'phaser';

// Multiplier applied to the backing canvas of every in-world Text. Higher =
// crisper under upscale (camera zoom 1.5x + browser cmd+ which raises DPR),
// at the cost of VRAM. Floor of 4 keeps labels readable even when starting
// at DPR=1; the *2.5 factor leaves headroom for one or two cmd+ steps before
// we have to re-render. Recomputed on every DPR change (see watchDpr below).
function computeTextRes(): number {
  return Math.max(4, Math.ceil(window.devicePixelRatio * 2.5));
}

let currentTextRes = computeTextRes();

// Registry of every Text created via addCrispText. Used by the DPR watcher
// to re-render existing labels at the new resolution — without this, cmd+
// after page load leaves textures stuck at the original resolution and the
// browser upscales them with a blur.
const crispTexts = new Set<Phaser.GameObjects.Text>();

/**
 * Add a Text game object that stays readable under `pixelArt: true`.
 *
 * The game config enables `pixelArt`, which forces NEAREST filtering on
 * every WebGL texture so sprite art stays crisp. Text textures inherit the
 * same NEAREST sampling — that's correct for pixel-style fonts (Pixelify
 * Sans, Cinzel) at scale, because LINEAR sampling would bilinearly smear
 * the rasterized canvas and read as "blurry" against the painterly tile
 * background. The wrapped updateText re-applies NEAREST after every
 * canvasToTexture() re-upload (setText / setColor / setStyle all route
 * through it and reset the GL min/mag filters).
 *
 * Sub-pixel snapping is handled at the game level (`config.ts` enables
 * `roundPixels: true`), not per-Text — Phaser 4 removed the per-object
 * `setRoundPixels` method.
 */
export function addCrispText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string | string[],
  style: Phaser.Types.GameObjects.Text.TextStyle,
): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, { resolution: currentTextRes, ...style });
  const reapplyFilter = () => t.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  reapplyFilter();
  const original = t.updateText.bind(t);
  t.updateText = () => {
    const r = original();
    reapplyFilter();
    return r;
  };
  crispTexts.add(t);
  t.once(Phaser.GameObjects.Events.DESTROY, () => crispTexts.delete(t));
  return t;
}

/**
 * Re-render every registered crisp Text at the current DPR. Phaser's Text
 * caches its backing canvas at the resolution it was created with, so we
 * have to set the new resolution on each style and force an updateText().
 */
function refreshAllCrispText(): void {
  const next = computeTextRes();
  if (next === currentTextRes) return;
  currentTextRes = next;
  for (const t of crispTexts) {
    t.style.resolution = next;
    t.updateText();
  }
}

// Watch for DPR changes (cmd+ / cmd-, moving window between Retina and
// non-Retina displays). matchMedia is the only reliable signal — a plain
// `resize` listener also fires on DPR change but also on every viewport
// resize, which would re-render every label far too often.
function watchDpr(): void {
  const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const onChange = () => {
    refreshAllCrispText();
    watchDpr();
  };
  mql.addEventListener('change', onChange, { once: true });
}

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  watchDpr();
}
