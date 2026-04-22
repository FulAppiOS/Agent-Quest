import * as Phaser from 'phaser';

// Renders text to a backing canvas at this multiplier, so the GPU has a
// high-resolution texture to sample from even when the camera zooms out to
// 0.35 on Retina. Centralised here so every in-world label shares the same
// DPI budget.
const TEXT_RES = Math.ceil(window.devicePixelRatio / 0.35);

/**
 * Add a Text game object that stays readable under `pixelArt: true`.
 *
 * The game config enables `pixelArt`, which forces NEAREST filtering on
 * every WebGL texture so sprite art stays crisp. Text objects render to
 * an internal canvas and upload it as a texture — with NEAREST that canvas
 * gets visibly aliased whenever the camera zooms or sub-pixel positions
 * the label.
 *
 * Simply calling `setFilter(LINEAR)` once at construction is not enough:
 * every `setText` / `setColor` / `setStyle` routes through `updateText()`,
 * which calls `canvasToTexture(...)` and resets the GL min/mag filter back
 * to NEAREST. We therefore wrap `updateText` so the LINEAR filter is
 * re-applied after every internal re-upload. Sprite textures are untouched.
 */
export function addCrispText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string | string[],
  style: Phaser.Types.GameObjects.Text.TextStyle,
): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, { resolution: TEXT_RES, ...style });
  const reapplyFilter = () => t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  reapplyFilter();
  const original = t.updateText.bind(t);
  t.updateText = () => {
    const r = original();
    reapplyFilter();
    return r;
  };
  return t;
}
