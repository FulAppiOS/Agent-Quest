import * as Phaser from 'phaser';
import { getActiveTheme } from '../themes/registry';

export type NpcUnit = 'pawn' | 'warrior' | 'archer' | 'tnt' | 'torch';
export type NpcColor = 'blue' | 'red' | 'black' | 'yellow' | 'purple';

/** Baseline NPC:Hero scale ratio under the default theme (0.28 / 0.50).
 * NpcSprite multiplies this by the active theme's heroScale so NPCs stay
 * visually smaller than heroes regardless of which theme is selected. */
const NPC_TO_HERO_RATIO = 0.56;
const NPC_SPEED = 42; // slightly slower than heroes — they're leisurely villagers
/** Ground distance covered by one full run-cycle. Keeps legs synced to travel. */
const RUN_PIXELS_PER_CYCLE = 22;

/**
 * A lightweight wandering villager. Lives inside a circular area and
 * picks a new random target when it finishes the previous walk or pause.
 * Uses the purple sprite sheets from Tiny Swords.
 */
export class NpcSprite {
  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Sprite;
  private homeX: number;
  private homeY: number;
  private radius: number;
  private _x: number;
  private _y: number;
  private idleKey: string;
  private runKey: string;
  private facesLeft: boolean;
  private tween: Phaser.Tweens.Tween | null = null;
  private nextTimer: Phaser.Time.TimerEvent | null = null;
  private rng: () => number;
  private destroyed = false;

  constructor(
    scene: Phaser.Scene,
    unit: NpcUnit,
    color: NpcColor,
    homeX: number,
    homeY: number,
    radius: number,
    rngSeed: number,
    scale?: number,
  ) {
    this.scene = scene;
    this.homeX = homeX;
    this.homeY = homeY;
    this.radius = radius;

    // Deterministic per-NPC rng
    let s = rngSeed | 0;
    this.rng = () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // pick a random starting point inside the circle
    const a = this.rng() * Math.PI * 2;
    const r = Math.sqrt(this.rng()) * radius * 0.7;
    this._x = homeX + Math.cos(a) * r;
    this._y = homeY + Math.sin(a) * r;

    const theme = getActiveTheme();
    const cfg = theme.getHeroConfig(color, unit);
    this.idleKey = cfg.idleKey;
    this.runKey = cfg.runKey;
    this.facesLeft = cfg.facesLeft;

    this.sprite = scene.add.sprite(this._x, this._y, this.idleKey);
    this.sprite.setScale(scale ?? theme.heroScale * NPC_TO_HERO_RATIO);
    this.sprite.setFlipX(this.facesLeft);
    this.sprite.setAlpha(0.95);
    if (cfg.tint !== null) this.sprite.setTint(cfg.tint);

    const idleAnim = `${this.idleKey}-anim`;
    if (!scene.anims.exists(idleAnim)) {
      const idleFrameSpec = cfg.idleFrameIndices !== undefined
        ? { frames: cfg.idleFrameIndices }
        : { start: 0, end: cfg.idleFrames - 1 };
      scene.anims.create({
        key: idleAnim,
        frames: scene.anims.generateFrameNumbers(this.idleKey, idleFrameSpec),
        frameRate: cfg.idleFrames > 1 ? 8 : 1,
        repeat: -1,
      });
    }
    const runAnim = `${this.runKey}-anim`;
    if (!scene.anims.exists(runAnim)) {
      // Match frame rate to ground speed so legs don't float/drag.
      const runFrameRate = cfg.runFrames * (NPC_SPEED / RUN_PIXELS_PER_CYCLE);
      const runFrameSpec = cfg.runFrameIndices !== undefined
        ? { frames: cfg.runFrameIndices }
        : { start: 0, end: cfg.runFrames - 1 };
      scene.anims.create({
        key: runAnim,
        frames: scene.anims.generateFrameNumbers(this.runKey, runFrameSpec),
        frameRate: runFrameRate,
        repeat: -1,
      });
    }

    this.sprite.play(idleAnim);
    this.sprite.setDepth(this._y + this.sprite.displayHeight * 0.5 + 0.5);

    this.scheduleNext(this.rng() * 1500 + 500);
  }

  private scheduleNext(delay: number): void {
    if (this.destroyed) return;
    this.nextTimer = this.scene.time.delayedCall(delay, () => this.pickTarget());
  }

  private pickTarget(): void {
    if (this.destroyed) return;
    // 30% chance to just stand still (talk, contemplate)
    if (this.rng() < 0.3) {
      this.sprite.play(`${this.idleKey}-anim`, true);
      this.scheduleNext(1500 + this.rng() * 3000);
      return;
    }
    const a = this.rng() * Math.PI * 2;
    const r = Math.sqrt(this.rng()) * this.radius;
    const targetX = this.homeX + Math.cos(a) * r;
    const targetY = this.homeY + Math.sin(a) * r;

    const dx = targetX - this._x;
    const dy = targetY - this._y;
    const distance = Math.hypot(dx, dy);
    if (distance < 5) {
      this.scheduleNext(1000);
      return;
    }

    if (Math.abs(dx) > 3) this.sprite.setFlipX((dx < 0) !== this.facesLeft);
    this.sprite.play(`${this.runKey}-anim`, true);

    const duration = (distance / NPC_SPEED) * 1000;
    this.tween = this.scene.tweens.add({
      targets: { x: this._x, y: this._y },
      x: targetX,
      y: targetY,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: (_t, target: { x: number; y: number }) => {
        this._x = target.x;
        this._y = target.y;
        this.sprite.setPosition(this._x, this._y);
        this.sprite.setDepth(this._y + this.sprite.displayHeight * 0.5 + 0.5);
      },
      onComplete: () => {
        this.tween = null;
        if (this.destroyed) return;
        this.sprite.play(`${this.idleKey}-anim`, true);
        this.scheduleNext(800 + this.rng() * 2500);
      },
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.tween) { this.tween.stop(); this.tween = null; }
    if (this.nextTimer) { this.nextTimer.destroy(); this.nextTimer = null; }
    this.sprite.destroy();
  }
}
