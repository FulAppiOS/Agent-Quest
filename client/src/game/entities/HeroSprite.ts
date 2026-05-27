import * as Phaser from 'phaser';
import { HERO_COLOR_SPRITE_BASE, HERO_LABEL_COLOR, type HeroClass, type HeroColor, type AgentActivity, type AgentSource, type AgentState } from '../../types/agent';
import { getActiveTheme } from '../themes/registry';
import { findRoadPath, type Point } from '../data/road-network';
import { addCrispText } from '../text';
import { truncateLabel } from '../../utils/truncateLabel';
import { computeSpriteScale } from './hero-scale';

const MOVE_SPEED = 150;
/** Ground distance covered by one full run-cycle. Keeps legs synced to travel. */
const RUN_PIXELS_PER_CYCLE = 60;

/** Truncation caps — short so labels stay inside the sprite's visual footprint. */
const NAME_MAX_CHARS = 18;
const TASK_MAX_CHARS = 44;
const ACTIVITY_MSG_MAX_CHARS = 44;

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

const LABEL_BG = 'rgba(0,0,0,0.65)';
const LABEL_PAD = { x: 4, y: 2 };
const BUBBLE_TASK_COLOR = '#3D1F00';   // user command — dark brown, dominant
const BUBBLE_MSG_COLOR = '#8C6A4A';   // system feedback — mid brown, recessive
const INDEX_COLOR = '#F5E6C8';

const HALO_TEXTURE_KEY = 'hero-selection-halo';

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

/**
 * On-sprite label IA (issue #16):
 *
 *   [N]                      ← indexText (top-right of sprite, matches PartyBar number)
 *   [task line]              ← taskText (above head, yellow, user prompt)
 *   [activity message]       ← activityMsgText (below taskText, gray, last Activity Feed message)
 *   [SPRITE]
 *   [hero name]              ← nameText (below feet, 2 lines, color reflects activity)
 *   [name line 2]
 *
 * Everything else (subagent marker, source/model badge, separate activity word
 * label) lives in PartyBar — that's the single place to look for per-hero
 * metadata so the canvas stays uncluttered.
 */
export class HeroSprite {
  readonly id: string;
  readonly heroClass: HeroClass;
  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Sprite;
  private source: AgentSource;
  private isSubagent: boolean;
  private nameText: Phaser.GameObjects.Text;
  private taskText: Phaser.GameObjects.Text;
  private activityMsgText: Phaser.GameObjects.Text;
  private bubbleBg: Phaser.GameObjects.Graphics;
  private indexText: Phaser.GameObjects.Text;
  private _x: number;
  private _y: number;
  private moveTween: Phaser.Tweens.Tween | null = null;
  private waitingTween: Phaser.Tweens.Tween | null = null;
  private errorTimer: Phaser.Time.TimerEvent | null = null;
  private idleKey: string;
  private runKey: string;
  private facesLeft: boolean;
  private nameOffsetY: number;
  private taskOffsetY: number;
  private activityMsgOffsetY: number;
  private indexOffsetX: number;
  private indexOffsetY: number;
  currentActivity: AgentActivity = 'idle';
  private isWaiting = false;
  private isErrorRecent = false;
  private nameBaseColor = '#DDDDDD';
  private selectionTween: Phaser.Tweens.Tween | null = null;
  private selectionHalo: Phaser.GameObjects.Image | null = null;
  private wanderTimer: Phaser.Time.TimerEvent | null = null;

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
    const spriteBase = HERO_COLOR_SPRITE_BASE[heroColor];
    const cfg = theme.getHeroConfig(spriteBase, heroClass);
    this.idleKey = cfg.idleKey;
    this.runKey = cfg.runKey;
    this.facesLeft = cfg.facesLeft;

    this.sprite = scene.add.sprite(x, y, this.idleKey);
    this.sprite.setScale(computeSpriteScale(theme.heroScale, isSubagent));
    this.sprite.setFlipX(this.facesLeft);
    if (cfg.tint !== null) this.sprite.setTint(cfg.tint);
    this.sprite.setData('isHero', true);

    const halfH = this.sprite.displayHeight / 2;
    const halfW = this.sprite.displayWidth / 2;

    // Above-head bubble — sits right at the head so the bubble's tail looks
    // like it grows out of the sprite. The gap between sprite and bubble was
    // ~16 px before; pulling it in to ~2 px reads as direct speech.
    this.activityMsgOffsetY = -(halfH - 24);
    this.taskOffsetY = this.activityMsgOffsetY - 13;

    // Below-feet name (2 lines). Tiny Swords CC0 sprites have ~8 px of
    // transparent padding below the character's feet inside the frame, so
    // the visual foot line is well above the frame's mathematical bottom.
    this.nameOffsetY = halfH - 24;

    // Index marker — top-left of the sprite, snug against the head.
    this.indexOffsetX = -(halfW - 38);
    this.indexOffsetY = -(halfH - 28);

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

    // Hero name — below feet, wraps to 2 lines for long display names.
    this.nameText = addCrispText(scene, x, y + this.nameOffsetY, truncateLabel(name, NAME_MAX_CHARS), {
      fontSize: '11px',
      color: nameColor,
      fontFamily: "'Fira Code', monospace",
      backgroundColor: LABEL_BG,
      padding: LABEL_PAD,
      align: 'center',
    }).setOrigin(0.5, 0);

    // Speech bubble — Graphics plate (rounded rect + tail) holds both text lines.
    // The plate is sized in `updateBubble()` after the texts have rasterized so
    // its width tracks the widest line.
    this.bubbleBg = scene.add.graphics();
    this.bubbleBg.setVisible(false);

    this.taskText = addCrispText(scene, x, y + this.taskOffsetY, '', {
      fontSize: '11px',
      fontStyle: 'bold',
      color: BUBBLE_TASK_COLOR,
      fontFamily: "'Fira Code', monospace",
      align: 'center',
      wordWrap: { width: 140 },
    }).setOrigin(0.5, 1).setVisible(false);

    this.activityMsgText = addCrispText(scene, x, y + this.activityMsgOffsetY, '', {
      fontSize: '9px',
      color: BUBBLE_MSG_COLOR,
      fontFamily: "'Fira Code', monospace",
      align: 'center',
      wordWrap: { width: 140 },
    }).setOrigin(0.5, 1).setVisible(false);

    // Index marker — sits to the left of the name on the same row. `setOrigin(1, 0)`
    // anchors its right edge to the position so it grows leftward; the actual x is
    // sprite-left-edge minus a 2px gap.
    this.indexText = addCrispText(scene, x + this.indexOffsetX, y + this.indexOffsetY, '', {
      fontSize: '10px',
      color: INDEX_COLOR,
      fontFamily: "'Fira Code', monospace",
      backgroundColor: 'rgba(0,0,0,0.8)',
      padding: { x: 3, y: 1 },
      align: 'center',
    }).setOrigin(1, 0).setVisible(false);

    this.setBubbleAlpha(1.0);
    this.updateDepth();
  }

  private setBubbleAlpha(alpha: number): void {
    this.bubbleBg.setAlpha(alpha);
    this.taskText.setAlpha(alpha);
    this.activityMsgText.setAlpha(alpha);
  }

  get x(): number { return this._x; }
  get y(): number { return this._y; }

  setHeroScale(scale: number): void {
    this.sprite.setScale(computeSpriteScale(scale, this.isSubagent));
  }

  /** Teleport sprite + every label to (x, y). */
  teleportTo(x: number, y: number): void {
    this._x = x;
    this._y = y;
    this.sprite.setPosition(x, y);
    this.nameText.setPosition(x, y + this.nameOffsetY);
    this.taskText.setPosition(x, y + this.taskOffsetY);
    this.activityMsgText.setPosition(x, y + this.activityMsgOffsetY);
    this.indexText.setPosition(x + this.indexOffsetX, y + this.indexOffsetY);
    this.updateBubble();
    if (this.selectionHalo !== null) {
      this.selectionHalo.setPosition(x, y);
    }
    this.updateDepth();
  }

  getIsSubagent(): boolean {
    return this.isSubagent;
  }

  setInteractiveForSelection(onClick: () => void): void {
    if (!this.sprite.input || !this.sprite.input.enabled) {
      this.sprite.setInteractive({ useHandCursor: true });
    }
    this.sprite.on('pointerdown', onClick);
  }

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
      this.setBubbleAlpha(1.0);
    } else {
      this.refreshNameColor();
      this.setBubbleAlpha(1.0);
    }
  }

  /** Reflect activity / waiting / error state in the name color (single visual signal). */
  private refreshNameColor(): void {
    if (this.isErrorRecent) {
      this.nameText.setColor(ERROR_COLOR);
    } else if (this.isWaiting) {
      this.nameText.setColor(WAITING_COLOR);
    } else {
      this.nameText.setColor(ACTIVITY_COLOR[this.currentActivity] ?? this.nameBaseColor);
    }
  }

  setActivity(activity: AgentActivity): void {
    const wasIdle = this.currentActivity === 'idle';
    this.currentActivity = activity;
    this.refreshNameColor();
    if (activity === 'idle' && !wasIdle) {
      this.startIdleWander();
    } else if (activity !== 'idle' && wasIdle) {
      this.stopIdleWander();
    }
  }

  setStatus(status: AgentState['status']): void {
    const wantsWaiting = status === 'waiting';
    if (wantsWaiting && !this.isWaiting) {
      this.isWaiting = true;
      this.startWaitingPulse();
    } else if (!wantsWaiting && this.isWaiting) {
      this.isWaiting = false;
      this.stopWaitingPulse();
    }
    if (status === 'completed') {
      this.stopIdleWander();
      this.playCompletionVFX();
    }
    this.refreshNameColor();
  }

  private playCompletionVFX(): void {
    const emitter = this.scene.add.particles(this._x, this._y - 10, 'px', {
      speed: { min: 30, max: 80 },
      scale: { start: 2, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xFFD700, 0xFFA500, 0xFFFF00],
      lifespan: 800,
      quantity: 12,
      emitting: false,
    });
    emitter.explode(12);
    emitter.setDepth(this.sprite.depth + 1);
    this.scene.time.delayedCall(1000, () => emitter.destroy());
  }

  private startIdleWander(): void {
    if (this.wanderTimer !== null) return;
    this.scheduleNextWander();
  }

  private stopIdleWander(): void {
    if (this.wanderTimer !== null) {
      this.wanderTimer.remove();
      this.wanderTimer = null;
    }
  }

  private scheduleNextWander(): void {
    const delay = Phaser.Math.Between(3000, 7000);
    this.wanderTimer = this.scene.time.delayedCall(delay, () => {
      this.wanderTimer = null;
      if (this.currentActivity !== 'idle' || this.moveTween !== null) return;
      const offsetX = Phaser.Math.Between(-12, 12);
      const offsetY = Phaser.Math.Between(-8, 8);
      this.wanderTo(this.gridBaseX + offsetX, this.gridBaseY + offsetY);
    });
  }

  private wanderTo(targetX: number, targetY: number): void {
    const dx = targetX - this._x;
    const dy = targetY - this._y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < 3) { this.scheduleNextWander(); return; }
    if (Math.abs(dx) > 3) this.sprite.setFlipX((dx < 0) !== this.facesLeft);
    this.sprite.play(`${this.runKey}-anim`, true);
    const duration = (distance / 60) * 1000;
    this.moveTween = this.scene.tweens.add({
      targets: { x: this._x, y: this._y },
      x: targetX,
      y: targetY,
      duration,
      ease: 'Linear',
      onUpdate: (_tween, target: { x: number; y: number }) => {
        this._x = target.x;
        this._y = target.y;
        this.sprite.setPosition(this._x, this._y);
        this.nameText.setPosition(this._x, this._y + this.nameOffsetY);
        this.taskText.setPosition(this._x, this._y + this.taskOffsetY);
        this.activityMsgText.setPosition(this._x, this._y + this.activityMsgOffsetY);
        this.indexText.setPosition(this._x + this.indexOffsetX, this._y + this.indexOffsetY);
        this.updateBubble();
        if (this.selectionHalo !== null) this.selectionHalo.setPosition(this._x, this._y);
        this.updateDepth();
      },
      onComplete: () => {
        this.moveTween = null;
        this.sprite.play(`${this.idleKey}-anim`, true);
        this.scheduleNextWander();
      },
    });
  }

  setErrorTimestamp(ts: number | undefined): void {
    if (this.errorTimer !== null) {
      this.errorTimer.remove();
      this.errorTimer = null;
    }
    if (ts === undefined) {
      this.isErrorRecent = false;
      this.refreshNameColor();
      return;
    }
    const age = Date.now() - ts;
    if (age >= ERROR_WINDOW_MS) {
      this.isErrorRecent = false;
      this.refreshNameColor();
      return;
    }
    this.isErrorRecent = true;
    this.refreshNameColor();
    this.errorTimer = this.scene.time.delayedCall(ERROR_WINDOW_MS - age, () => {
      this.isErrorRecent = false;
      this.errorTimer = null;
      this.refreshNameColor();
    });
  }

  private startWaitingPulse(): void {
    if (this.waitingTween !== null) return;
    this.waitingTween = this.scene.tweens.add({
      targets: this.nameText,
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
    this.nameText.setAlpha(1);
  }

  private updateDepth(): void {
    const footY = this._y + this.sprite.displayHeight * 0.5;
    this.sprite.setDepth(footY + 0.5);
    // Labels render above buildings (buildings sort by their foot-y too,
    // so footY + 1 puts hero labels in front of any building at the same row).
    this.nameText.setDepth(footY + 1.1);
    this.bubbleBg.setDepth(footY + 1.0);
    this.taskText.setDepth(footY + 1.1);
    this.activityMsgText.setDepth(footY + 1.1);
    this.indexText.setDepth(footY + 1.2);
    if (this.selectionHalo !== null) this.selectionHalo.setDepth(footY + 0.4);
  }

  /**
   * Redraw the speech-bubble plate behind taskText + activityMsgText, sized
   * to whichever lines are currently visible. Called on every text/visibility
   * change. Hides the plate when both lines are empty.
   */
  private updateBubble(): void {
    const taskVisible = this.taskText.visible && this.taskText.text.length > 0;
    const msgVisible = this.activityMsgText.visible && this.activityMsgText.text.length > 0;
    this.bubbleBg.clear();
    if (!taskVisible && !msgVisible) {
      this.bubbleBg.setVisible(false);
      return;
    }
    const padX = 6;
    const padY = 4;

    // Derive plate bounds from the actual text positions + display sizes.
    // Both texts use origin (0.5, 1) — their anchor is bottom-center, so:
    //   textTop    = text.y - text.displayHeight
    //   textBottom = text.y
    const texts: Phaser.GameObjects.Text[] = [];
    if (taskVisible) texts.push(this.taskText);
    if (msgVisible) texts.push(this.activityMsgText);

    let minTop = Infinity;
    let maxBottom = -Infinity;
    let maxWidth = 0;
    for (const t of texts) {
      const tTop = t.y - t.displayHeight;
      const tBottom = t.y;
      if (tTop < minTop) minTop = tTop;
      if (tBottom > maxBottom) maxBottom = tBottom;
      if (t.displayWidth > maxWidth) maxWidth = t.displayWidth;
    }

    const w = maxWidth + padX * 2;
    const top = minTop - padY;
    const bottom = maxBottom + padY;
    const h = bottom - top;
    const cx = this._x;
    const left = cx - w / 2;

    // Parchment-style speech bubble: warm cream fill + dark brown border.
    this.bubbleBg.fillStyle(0xF5E0B0, 0.92);
    this.bubbleBg.fillRoundedRect(left, top, w, h, 9);
    this.bubbleBg.lineStyle(2, 0x8B5E3C, 0.9);
    this.bubbleBg.strokeRoundedRect(left, top, w, h, 9);

    // Tail — triangle pointing down toward the sprite's head.
    const tailW = 10;
    const tailH = 8;
    // Fill tail with parchment color first, then draw border edges.
    this.bubbleBg.fillStyle(0xF5E0B0, 0.92);
    this.bubbleBg.beginPath();
    this.bubbleBg.moveTo(cx - tailW / 2, bottom);
    this.bubbleBg.lineTo(cx + tailW / 2, bottom);
    this.bubbleBg.lineTo(cx, bottom + tailH);
    this.bubbleBg.closePath();
    this.bubbleBg.fillPath();
    // Border on the two exposed tail edges (left-diagonal + right-diagonal).
    this.bubbleBg.lineStyle(2, 0x8B5E3C, 0.9);
    this.bubbleBg.beginPath();
    this.bubbleBg.moveTo(cx - tailW / 2, bottom);
    this.bubbleBg.lineTo(cx, bottom + tailH);
    this.bubbleBg.lineTo(cx + tailW / 2, bottom);
    this.bubbleBg.strokePath();
    this.bubbleBg.setVisible(true);
  }

  /** Source / model badges and subagent markers live in PartyBar now — these are no-ops kept for caller compatibility. */
  setSourceBadgeVisible(_visible: boolean): void {
    // intentionally empty
  }

  setModel(_modelId: string | undefined): void {
    // intentionally empty
  }

  /** Update the hero name label. */
  updateName(name: string): void {
    const truncated = truncateLabel(name, NAME_MAX_CHARS);
    if (this.nameText.text === truncated) return;
    this.nameText.setText(truncated);
  }

  /** Update the task line of the head bubble (user's last prompt). Pass undefined/empty to hide. */
  updateTask(task?: string): void {
    if (task === undefined || task.length === 0) {
      this.taskText.setText('');
      this.taskText.setVisible(false);
    } else {
      this.taskText.setText(truncateLabel(task, TASK_MAX_CHARS));
      this.taskText.setVisible(true);
    }
    this.updateBubble();
  }

  /** Update the activity-feed message line (last tool call / message). Pass undefined/empty to hide. */
  updateDetail(file?: string, command?: string): void {
    let detail = '';
    if (command !== undefined && command.length > 0) {
      detail = truncateLabel(command, ACTIVITY_MSG_MAX_CHARS);
    } else if (file !== undefined && file.length > 0) {
      const parts = file.split('/');
      detail = parts[parts.length - 1] ?? file;
    }
    if (detail.length === 0) {
      this.activityMsgText.setText('');
      this.activityMsgText.setVisible(false);
    } else {
      this.activityMsgText.setText(detail);
      this.activityMsgText.setVisible(true);
    }
    this.updateBubble();
  }

  /** Set the party index marker. Pass undefined to hide. */
  setIndex(index: number | undefined): void {
    if (index === undefined) {
      this.indexText.setVisible(false);
      return;
    }
    this.indexText.setText(String(index));
    this.indexText.setVisible(true);
  }

  moveTo(targetX: number, targetY: number, activity: AgentActivity): void {
    this.currentActivity = activity;
    this.refreshNameColor();

    if (this.moveTween !== null) {
      this.moveTween.stop();
      this.moveTween = null;
    }

    const path = findRoadPath({ x: this._x, y: this._y }, { x: targetX, y: targetY });

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
        this.taskText.setPosition(this._x, this._y + this.taskOffsetY);
        this.activityMsgText.setPosition(this._x, this._y + this.activityMsgOffsetY);
        this.indexText.setPosition(this._x + this.indexOffsetX, this._y + this.indexOffsetY);
        this.updateBubble();
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
    this.stopIdleWander();
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
    this.bubbleBg.destroy();
    this.taskText.destroy();
    this.activityMsgText.destroy();
    this.indexText.destroy();
  }
}
