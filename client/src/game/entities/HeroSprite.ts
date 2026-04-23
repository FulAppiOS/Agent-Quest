import * as Phaser from 'phaser';
import { HERO_LABEL_COLOR, SOURCE_BADGE_COLOR, type HeroClass, type HeroColor, type AgentActivity, type AgentSource, type AgentState } from '../../types/agent';
import { getActiveTheme } from '../themes/registry';
import { findRoadPath, type Point } from '../data/road-network';
import { addCrispText } from '../text';

const MOVE_SPEED = 150;
/** Ground distance covered by one full run-cycle. Keeps legs synced to travel. */
const RUN_PIXELS_PER_CYCLE = 60;

/**
 * Label offsets are computed per-instance from the sprite's actual
 * displayHeight so they adapt to whatever scale the active theme uses.
 * The formulas below reproduce the original Tiny Swords values
 * (sprite 96 px → name -50, activity +46, detail +60, task +74).
 */
const TASK_MAX_CHARS = 28;

const ACTIVITY_COLOR: Record<AgentActivity, string> = {
  idle:      '#888888',
  thinking:  '#C48BE8',
  reading:   '#88BBFF',
  editing:   '#FFD27A',
  bash:      '#FF9966',
  git:       '#88E08A',
  debugging: '#FF6B6B',
  reviewing: '#7AE0C8',
};

const WAITING_COLOR = '#FFD700';
const ERROR_COLOR = '#FF4444';
const ERROR_WINDOW_MS = 90 * 1000;

const HALO_TEXTURE_KEY = 'hero-selection-halo';

/**
 * Lazily build a soft radial-gradient texture we can reuse as the selection
 * halo. Cached in Phaser's global TextureManager for the lifetime of the
 * game — scenes share it via the same key. The gradient fades white →
 * transparent so the glow blends with the scene instead of looking like a
 * flat disc.
 */
function ensureHaloTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(HALO_TEXTURE_KEY)) return;
  const size = 128;
  const tex = scene.textures.createCanvas(HALO_TEXTURE_KEY, size, size);
  if (tex === null) return;
  const ctx = tex.getContext();
  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  grad.addColorStop(0.00, 'rgba(255, 255, 255, 0.9)');
  grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.45)');
  grad.addColorStop(0.70, 'rgba(255, 255, 255, 0.12)');
  grad.addColorStop(1.00, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

export class HeroSprite {
  readonly id: string;
  readonly heroClass: HeroClass;
  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
  private subagentText: Phaser.GameObjects.Text | null = null;
  private sourceText: Phaser.GameObjects.Text | null = null;
  private source: AgentSource;
  private isSubagent: boolean;
  private sourceBadgeVisible = false;
  private activityText: Phaser.GameObjects.Text;
  private detailText: Phaser.GameObjects.Text;
  private taskText: Phaser.GameObjects.Text;
  private _x: number;
  private _y: number;
  private moveTween: Phaser.Tweens.Tween | null = null;
  private waitingTween: Phaser.Tweens.Tween | null = null;
  private errorTimer: Phaser.Time.TimerEvent | null = null;
  private idleKey: string;
  private runKey: string;
  private facesLeft: boolean;
  private nameOffsetY: number;
  private subagentOffsetY: number;
  private activityOffsetY: number;
  private detailOffsetY: number;
  private taskOffsetY: number;
  currentActivity: AgentActivity = 'idle';
  private isWaiting = false;
  private isErrorRecent = false;
  private nameBaseColor = '#DDDDDD';
  private selectionTween: Phaser.Tweens.Tween | null = null;
  private selectionHalo: Phaser.GameObjects.Image | null = null;

  /** Grid base position — used for slot repositioning. */
  gridBaseX = 0;
  gridBaseY = 0;

  constructor(
    scene: Phaser.Scene,
    id: string,
    name: string,
    heroClass: HeroClass,
    heroColor: HeroColor,
    x: number,
    y: number,
    isSubagent = false,
    source: AgentSource = 'claude',
  ) {
    this.scene = scene;
    this.id = id;
    this.heroClass = heroClass;
    this.source = source;
    this.isSubagent = isSubagent;
    this._x = x;
    this._y = y;

    const theme = getActiveTheme();
    const cfg = theme.getHeroConfig(heroColor, heroClass);
    this.idleKey = cfg.idleKey;
    this.runKey = cfg.runKey;
    this.facesLeft = cfg.facesLeft;

    // Create sprite with idle animation
    this.sprite = scene.add.sprite(x, y, this.idleKey);
    this.sprite.setScale(theme.heroScale);
    // Flip sprites that natively face left so they face right by default
    this.sprite.setFlipX(this.facesLeft);
    if (cfg.tint !== null) this.sprite.setTint(cfg.tint);
    // Tag at construction time so the scene-level background-click
    // detector (VillageScene) can classify pointerdown hits correctly
    // regardless of which code path later wires up interactivity.
    this.sprite.setData('isHero', true);

    // Label offsets derived from actual sprite height — scale with theme.
    const halfH = this.sprite.displayHeight / 2;
    this.nameOffsetY = -(halfH + 2);
    // Subagent marker sits ~16px below the name (standard "subtitle" placement,
    // so the name stays the primary anchor for the eye).
    this.subagentOffsetY = this.nameOffsetY + 16;
    this.activityOffsetY = halfH - 2;
    this.detailOffsetY = halfH + 12;
    this.taskOffsetY = halfH + 26;

    // Create idle animation if it doesn't exist yet
    const idleAnimKey = `${this.idleKey}-anim`;
    if (!scene.anims.exists(idleAnimKey)) {
      const idleFrameSpec = cfg.idleFrameIndices !== undefined
        ? { frames: cfg.idleFrameIndices }
        : { start: 0, end: cfg.idleFrames - 1 };
      scene.anims.create({
        key: idleAnimKey,
        frames: scene.anims.generateFrameNumbers(this.idleKey, idleFrameSpec),
        frameRate: cfg.idleFrames > 1 ? 8 : 1,
        repeat: -1,
      });
    }

    const runAnimKey = `${this.runKey}-anim`;
    if (!scene.anims.exists(runAnimKey)) {
      // Match frame rate to ground speed so legs don't float or drag.
      const runFrameRate = cfg.runFrames * (MOVE_SPEED / RUN_PIXELS_PER_CYCLE);
      const runFrameSpec = cfg.runFrameIndices !== undefined
        ? { frames: cfg.runFrameIndices }
        : { start: 0, end: cfg.runFrames - 1 };
      scene.anims.create({
        key: runAnimKey,
        frames: scene.anims.generateFrameNumbers(this.runKey, runFrameSpec),
        frameRate: runFrameRate,
        repeat: -1,
      });
    }

    this.sprite.play(idleAnimKey);

    const nameColor = HERO_LABEL_COLOR[heroColor] ?? '#DDDDDD';
    this.nameBaseColor = nameColor;
    this.nameText = addCrispText(scene, x, y + this.nameOffsetY, name, {
      fontSize: '14px',
      color: nameColor,
      fontFamily: 'monospace',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);

    // Subagent marker: only created for spawned subagents — sits just above
    // the name to visually distinguish child heroes from parent sessions.
    if (isSubagent) {
      this.subagentText = addCrispText(scene, x, y + this.subagentOffsetY, 'subagent', {
        fontSize: '9px',
        color: '#9AA4B0',
        fontFamily: 'monospace',
        fontStyle: 'italic',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5);
    }

    // Source badge is created lazily by setSourceBadgeVisible(true) — shown
    // only when the UI is in mixed-provider mode.

    // Activity label below hero
    this.activityText = addCrispText(scene, x, y + this.activityOffsetY, 'idle', {
      fontSize: '12px',
      color: ACTIVITY_COLOR.idle,
      fontFamily: 'monospace',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5);

    // Detail label (file/command) below activity
    this.detailText = addCrispText(scene, x, y + this.detailOffsetY, '', {
      fontSize: '11px',
      color: '#AABBCC',
      fontFamily: 'monospace',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5);

    // Task label (current user prompt) below detail
    this.taskText = addCrispText(scene, x, y + this.taskOffsetY, '', {
      fontSize: '10px',
      color: '#9FB7D4',
      fontFamily: 'monospace',
      fontStyle: 'italic',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5);

    // Set initial Y-based depth
    this.updateDepth();
  }

  get x(): number { return this._x; }
  get y(): number { return this._y; }

  /** Override the default hero scale (e.g. from MapConfig settings). */
  setHeroScale(scale: number): void {
    this.sprite.setScale(scale);
  }

  /** Make the sprite respond to pointerdown with the supplied callback. */
  setInteractiveForSelection(onClick: () => void): void {
    if (!this.sprite.input || !this.sprite.input.enabled) {
      this.sprite.setInteractive({ useHandCursor: true });
    }
    // The `isHero` tag is set in the constructor so it's present even for
    // spawn paths that never call this method.
    this.sprite.on('pointerdown', onClick);
  }

  /**
   * Apply or clear a selection visual: a pulsing blue halo BEHIND the sprite
   * (alpha + scale yoyo ~1s cycle). The sprite itself stays untinted so the
   * character's natural colors are preserved; only the surrounding light
   * pulses. The name text is brightened so the selected hero's label stands
   * out against its neighbors.
   */
  setSelected(selected: boolean): void {
    if (this.selectionTween !== null) {
      this.selectionTween.stop();
      this.selectionTween = null;
    }
    if (this.selectionHalo !== null) {
      this.selectionHalo.destroy();
      this.selectionHalo = null;
    }
    if (selected) {
      ensureHaloTexture(this.scene);
      const diameter = Math.max(this.sprite.displayWidth, this.sprite.displayHeight) * 1.1;
      const halo = this.scene.add.image(this._x, this._y, HALO_TEXTURE_KEY);
      halo.setDisplaySize(diameter, diameter);
      halo.setAlpha(0.35);
      halo.setDepth(this.sprite.depth - 0.1);
      this.selectionHalo = halo;
      // Capture the baseline scale AFTER setDisplaySize so the tween
      // yoyos between this fixed baseline and baseline × peak factor.
      // Using halo.scaleX directly in the tween target would be the
      // same math but reads as if the scale were self-referential.
      const baseScale = halo.scaleX;
      this.selectionTween = this.scene.tweens.add({
        targets: halo,
        alpha: 0.75,
        scaleX: baseScale * 1.25,
        scaleY: baseScale * 1.25,
        duration: 650,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.nameText.setColor('#FFFFFF');
      this.nameText.setStroke('#1E5FA3', 5);
    } else {
      this.nameText.setColor(this.nameBaseColor);
      this.nameText.setStroke('#000000', 3);
    }
  }

  /** Update the displayed activity label and internal state. */
  setActivity(activity: AgentActivity): void {
    this.currentActivity = activity;
    this.refreshActivityVisual();
  }

  /** Apply status-driven overlays (e.g. 'waiting' pulses gold). */
  setStatus(status: AgentState['status']): void {
    const wantsWaiting = status === 'waiting';
    if (wantsWaiting && !this.isWaiting) {
      this.isWaiting = true;
      this.startWaitingPulse();
    } else if (!wantsWaiting && this.isWaiting) {
      this.isWaiting = false;
      this.stopWaitingPulse();
    }
    this.refreshActivityVisual();
  }

  /** Apply recent-error overlay; auto-clears after ERROR_WINDOW_MS from the given timestamp. */
  setErrorTimestamp(ts: number | undefined): void {
    if (this.errorTimer !== null) {
      this.errorTimer.remove();
      this.errorTimer = null;
    }
    if (ts === undefined) {
      this.isErrorRecent = false;
      this.refreshActivityVisual();
      return;
    }
    const age = Date.now() - ts;
    if (age >= ERROR_WINDOW_MS) {
      this.isErrorRecent = false;
      this.refreshActivityVisual();
      return;
    }
    this.isErrorRecent = true;
    this.refreshActivityVisual();
    this.errorTimer = this.scene.time.delayedCall(ERROR_WINDOW_MS - age, () => {
      this.isErrorRecent = false;
      this.errorTimer = null;
      this.refreshActivityVisual();
    });
  }

  private refreshActivityVisual(): void {
    if (this.isErrorRecent) {
      this.activityText.setText('error');
      this.activityText.setColor(ERROR_COLOR);
      return;
    }
    if (this.isWaiting) {
      this.activityText.setText('waiting…');
      this.activityText.setColor(WAITING_COLOR);
      return;
    }
    this.activityText.setText(this.currentActivity);
    this.activityText.setColor(ACTIVITY_COLOR[this.currentActivity]);
  }

  private startWaitingPulse(): void {
    if (this.waitingTween !== null) return;
    this.waitingTween = this.scene.tweens.add({
      targets: this.activityText,
      alpha: { from: 1, to: 0.45 },
      duration: 700,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
  }

  private stopWaitingPulse(): void {
    if (this.waitingTween !== null) {
      this.waitingTween.stop();
      this.waitingTween = null;
    }
    this.activityText.setAlpha(1);
  }

  /** Update depth of sprite and labels based on Y position (Y-sorting). */
  private updateDepth(): void {
    // Sort by the hero's FEET, not its center, so the pivot matches buildings
    // (bottom-anchored, origin 0.5/1) and decorations that sort on their base.
    // Without this, a hero whose feet align with a building's foot would render
    // behind it because his center-y is well above the building's foot-y.
    const footY = this._y + this.sprite.displayHeight * 0.5;
    this.sprite.setDepth(footY + 0.5);
    this.nameText.setDepth(footY + 0.6);
    if (this.subagentText !== null) this.subagentText.setDepth(footY + 0.6);
    if (this.sourceText !== null) this.sourceText.setDepth(footY + 0.6);
    this.activityText.setDepth(footY + 0.6);
    this.detailText.setDepth(footY + 0.6);
    this.taskText.setDepth(footY + 0.6);
    if (this.selectionHalo !== null) this.selectionHalo.setDepth(footY + 0.4);
  }

  /**
   * Show or hide the source badge (`CODEX` / `CLAUDE`). Called by the scene
   * whenever the fleet's provider makeup changes. Lazily creates the Text
   * object on first reveal. When a subagent marker is already present, the
   * two labels sit side-by-side on the subagent row; otherwise the badge sits
   * alone on that row.
   */
  setSourceBadgeVisible(visible: boolean): void {
    this.sourceBadgeVisible = visible;
    const justCreated = visible && this.sourceText === null;
    if (justCreated) {
      this.sourceText = addCrispText(
        this.scene,
        this._x,
        this._y + this.subagentOffsetY,
        this.source.toUpperCase(),
        {
          fontSize: '9px',
          color: SOURCE_BADGE_COLOR[this.source],
          fontFamily: 'monospace',
          stroke: '#000000',
          strokeThickness: 2,
        },
      );
    }
    if (this.sourceText !== null) {
      this.sourceText.setVisible(visible);
    }
    this.layoutSubagentAndSource();
    // A hero parked at its building has no active move tween, so the text
    // would keep its default depth (0) and render behind buildings until the
    // next move. Force a depth sweep so the new badge is visible immediately.
    if (justCreated) this.updateDepth();
  }

  /**
   * Position the subagent marker and source badge on the shared subagent row.
   * When both are visible they sit side-by-side (centered as a pair); when
   * only one is visible it sits centered on its own.
   */
  private layoutSubagentAndSource(): void {
    const y = this._y + this.subagentOffsetY;
    if (this.sourceBadgeVisible && this.isSubagent && this.subagentText !== null && this.sourceText !== null) {
      this.subagentText.setOrigin(1, 0.5);
      this.subagentText.setPosition(this._x - 3, y);
      this.sourceText.setOrigin(0, 0.5);
      this.sourceText.setPosition(this._x + 3, y);
      return;
    }
    if (this.subagentText !== null) {
      this.subagentText.setOrigin(0.5);
      this.subagentText.setPosition(this._x, y);
    }
    if (this.sourceText !== null) {
      this.sourceText.setOrigin(0.5);
      this.sourceText.setPosition(this._x, y);
    }
  }

  /** Update the truncated task line shown below the detail. */
  updateTask(task?: string): void {
    if (task === undefined || task.length === 0) {
      this.taskText.setText('');
      return;
    }
    const single = task.replace(/\s+/g, ' ').trim();
    const text = single.length > TASK_MAX_CHARS
      ? single.slice(0, TASK_MAX_CHARS - 1) + '\u2026'
      : single;
    this.taskText.setText(text);
  }

  /** Update the detail line shown below the activity label. */
  updateDetail(file?: string, command?: string): void {
    let detail = '';
    if (file) {
      // Show only the filename, not the full path
      const parts = file.split('/');
      detail = parts[parts.length - 1] ?? file;
    } else if (command) {
      detail = command.length > 25 ? command.slice(0, 24) + '\u2026' : command;
    }
    this.detailText.setText(detail);
  }

  moveTo(targetX: number, targetY: number, activity: AgentActivity): void {
    this.currentActivity = activity;
    this.refreshActivityVisual();

    // Cancel existing move
    if (this.moveTween !== null) {
      this.moveTween.stop();
      this.moveTween = null;
    }

    const path = findRoadPath({ x: this._x, y: this._y }, { x: targetX, y: targetY });

    // Remove the first point (current position)
    if (path.length > 1) {
      path.shift();
    }

    if (path.length === 0) {
      this.sprite.play(`${this.idleKey}-anim`, true);
      return;
    }

    this.moveAlongPath(path);
  }

  private moveAlongPath(path: Point[]): void {
    if (path.length === 0) {
      this.sprite.play(`${this.idleKey}-anim`, true);
      return;
    }

    const next = path[0]!;
    const remaining = path.slice(1);

    const dx = next.x - this._x;
    const dy = next.y - this._y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 5) {
      this._x = next.x;
      this._y = next.y;
      this.updateDepth();
      this.moveAlongPath(remaining);
      return;
    }

    // Flip based on horizontal direction (invert for sprites that natively face left)
    if (Math.abs(dx) > 5) {
      this.sprite.setFlipX((dx < 0) !== this.facesLeft);
    }

    this.sprite.play(`${this.runKey}-anim`, true);

    const duration = (distance / MOVE_SPEED) * 1000;

    this.moveTween = this.scene.tweens.add({
      targets: { x: this._x, y: this._y },
      x: next.x,
      y: next.y,
      duration,
      ease: 'Linear',
      onUpdate: (_tween, target: { x: number; y: number }) => {
        this._x = target.x;
        this._y = target.y;
        this.sprite.setPosition(this._x, this._y);
        this.nameText.setPosition(this._x, this._y + this.nameOffsetY);
        this.layoutSubagentAndSource();
        this.activityText.setPosition(this._x, this._y + this.activityOffsetY);
        this.detailText.setPosition(this._x, this._y + this.detailOffsetY);
        this.taskText.setPosition(this._x, this._y + this.taskOffsetY);
        if (this.selectionHalo !== null) {
          this.selectionHalo.setPosition(this._x, this._y);
        }
        this.updateDepth();
      },
      onComplete: () => {
        this._x = next.x;
        this._y = next.y;
        this.moveTween = null;
        this.updateDepth();
        this.moveAlongPath(remaining);
      },
    });
  }

  destroy(): void {
    if (this.moveTween !== null) {
      this.moveTween.stop();
    }
    if (this.waitingTween !== null) {
      this.waitingTween.stop();
      this.waitingTween = null;
    }
    if (this.errorTimer !== null) {
      this.errorTimer.remove();
      this.errorTimer = null;
    }
    if (this.selectionTween !== null) {
      this.selectionTween.stop();
      this.selectionTween = null;
    }
    if (this.selectionHalo !== null) {
      this.selectionHalo.destroy();
      this.selectionHalo = null;
    }
    this.sprite.destroy();
    this.nameText.destroy();
    if (this.subagentText !== null) this.subagentText.destroy();
    if (this.sourceText !== null) this.sourceText.destroy();
    this.activityText.destroy();
    this.detailText.destroy();
    this.taskText.destroy();
  }
}
