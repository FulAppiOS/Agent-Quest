import { isXcodeAgent, sourceBadgeLabel } from '../../types/sessionIdentity';
import * as Phaser from 'phaser';
import {
  CONTEXT_LEVEL_COLOR, HERO_COLOR_SPRITE_BASE, HERO_LABEL_COLOR, SOURCE_BADGE_COLOR,
  contextLevel, contextPct, modelBadge, skillShortName,
  type HeroClass, type HeroColor, type AgentActivity, type AgentSource, type AgentState, type ContextUsage,
} from '../../types/agent';
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

/** Subagents render smaller than the session heroes that spawned them. */
const SUBAGENT_SCALE = 0.8;

/** Context-occupancy bar drawn above the name. */
const CONTEXT_BAR_W = 36;
const CONTEXT_BAR_H = 4;

const ACTIVITY_COLOR: Record<AgentActivity, string> = {
  idle:      '#888888',
  thinking:  '#C48BE8',
  reading:   '#88BBFF',
  // Forge/edit = amber orange. Deliberately NOT yellow — gold is reserved for
  // the 'waiting' state so the two are never confused on the hero label.
  editing:   '#FF8C42',
  bash:      '#FF9966',
  git:       '#88E08A',
  debugging: '#FF6B6B',
  reviewing: '#7AE0C8',
};

const WAITING_COLOR = '#FFD700';
const ERROR_COLOR = '#FF4444';
const ERROR_WINDOW_MS = 90 * 1000;
const SKILL_COLOR = '#7BD4C5';
const CHILD_BADGE_COLOR = '#FFD27A';
/** Fixed badge color for the `SUBAGENT` marker — deliberately none of the hero label colors. */
const SUBAGENT_BADGE_COLOR = '#B8C4D6';
/** Subagent name labels keep the parent's color but sit back visually. */
const SUBAGENT_NAME_ALPHA = 0.75;

const HALO_TEXTURE_KEY = 'hero-selection-halo';

function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

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
  readonly heroColor: HeroColor;
  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
  private subagentText: Phaser.GameObjects.Text | null = null;
  private sourceText: Phaser.GameObjects.Text | null = null;
  private source: AgentSource;
  private isSubagent: boolean;
  private sourceBadgeVisible = false;
  private xcodeSession = false;
  private sourceLabel: string | undefined;
  private activityText: Phaser.GameObjects.Text;
  /** Lazily created when a model badge applies (Claude sessions only). */
  private modelText: Phaser.GameObjects.Text | null = null;
  private detailText: Phaser.GameObjects.Text;
  private taskText: Phaser.GameObjects.Text;
  /** Context-occupancy bar (track + fill + percentage), created on the first known sample. */
  private contextTrack: Phaser.GameObjects.Rectangle | null = null;
  private contextFill: Phaser.GameObjects.Rectangle | null = null;
  private contextText: Phaser.GameObjects.Text | null = null;
  private contextPulse: Phaser.Tweens.Tween | null = null;
  private contextValue: ContextUsage | undefined;
  private contextBarsEnabled = true;
  /** `✦ skill` buff tag above the name while a skill's instructions apply. */
  private skillText: Phaser.GameObjects.Text | null = null;
  /** `⚑ N` badge next to the name: live subagents working for this hero. */
  private childBadge: Phaser.GameObjects.Text | null = null;
  private _x: number;
  private _y: number;
  private moveTween: Phaser.Tweens.Tween | null = null;
  private waitingTween: Phaser.Tweens.Tween | null = null;
  private errorTimer: Phaser.Time.TimerEvent | null = null;
  private idleKey: string;
  private runKey: string;
  private facesLeft: boolean;
  private nameOffsetY = 0;
  private subagentOffsetY = 0;
  private contextOffsetY = 0;
  private skillOffsetY = 0;
  private activityOffsetY = 0;
  private detailOffsetY = 0;
  private taskOffsetY = 0;
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
    this.heroColor = heroColor;
    this.source = source;
    this.isSubagent = isSubagent;
    this._x = x;
    this._y = y;

    const theme = getActiveTheme();
    // Map the logical hero color to a sprite base the theme actually ships
    // with. Extra palette entries (teal/orange/green) share the sprite of
    // their base color — only the label (name tag) gets the expanded color,
    // the sprite itself is never recolored.
    const spriteBase = HERO_COLOR_SPRITE_BASE[heroColor];
    const cfg = theme.getHeroConfig(spriteBase, heroClass);
    this.idleKey = cfg.idleKey;
    this.runKey = cfg.runKey;
    this.facesLeft = cfg.facesLeft;

    // Create sprite with idle animation
    this.sprite = scene.add.sprite(x, y, this.idleKey);
    this.applyScale(theme.heroScale);
    // Flip sprites that natively face left so they face right by default
    this.sprite.setFlipX(this.facesLeft);
    if (cfg.tint !== null) this.sprite.setTint(cfg.tint);
    // Tag at construction time so the scene-level background-click
    // detector (VillageScene) can classify pointerdown hits correctly
    // regardless of which code path later wires up interactivity.
    this.sprite.setData('isHero', true);

    this.computeOffsets();

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
    // Subagents: smaller, dimmer italic name in the family (parent) color —
    // the knight (main agent) keeps the bold upright label at full strength.
    this.nameText = addCrispText(scene, x, y + this.nameOffsetY, name, {
      fontSize: isSubagent ? '12px' : '14px',
      color: nameColor,
      fontFamily: 'monospace',
      fontStyle: isSubagent ? 'italic' : 'normal',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);
    if (isSubagent) this.nameText.setAlpha(SUBAGENT_NAME_ALPHA);

    // Subagent badge: only created for spawned subagents — sits just below
    // the name. `setSubagentRole` appends the role (`SUBAGENT · Explore`)
    // once the scene knows it.
    if (isSubagent) {
      this.subagentText = addCrispText(scene, x, y + this.subagentOffsetY, 'SUBAGENT', {
        fontSize: '8px',
        color: SUBAGENT_BADGE_COLOR,
        fontFamily: 'monospace',
        fontStyle: 'bold',
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
  /** Ground contact point — the Y the depth sort keys on. */
  get footY(): number { return this._y + this.sprite.displayHeight * 0.5; }

  private applyScale(scale: number): void {
    this.sprite.setScale(this.isSubagent ? scale * SUBAGENT_SCALE : scale);
  }

  /** Label rows derived from the sprite's current display height. */
  private computeOffsets(): void {
    const halfH = this.sprite.displayHeight / 2;
    this.nameOffsetY = -(halfH + 2);
    // Subagent marker sits ~16px below the name (standard "subtitle" placement,
    // so the name stays the primary anchor for the eye).
    this.subagentOffsetY = this.nameOffsetY + 16;
    // Context bar and skill buff stack upward above the name.
    this.contextOffsetY = this.nameOffsetY - 11;
    this.skillOffsetY = this.nameOffsetY - 22;
    this.activityOffsetY = halfH - 2;
    this.detailOffsetY = halfH + 12;
    this.taskOffsetY = halfH + 26;
  }

  /** Override the default hero scale (e.g. from MapConfig settings). */
  setHeroScale(scale: number): void {
    this.applyScale(scale);
    this.computeOffsets();
    this.layoutAll();
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
    } else if (this.isWaiting) {
      this.activityText.setText('waiting…');
      this.activityText.setColor(WAITING_COLOR);
    } else {
      this.activityText.setText(this.currentActivity);
      this.activityText.setColor(ACTIVITY_COLOR[this.currentActivity]);
    }
    // Text width changed → re-center the activity/model pair on the hero.
    this.layoutActivityAndModel();
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
    const footY = this.footY;
    this.sprite.setDepth(footY + 0.5);
    this.nameText.setDepth(footY + 0.6);
    if (this.subagentText !== null) this.subagentText.setDepth(footY + 0.6);
    if (this.sourceText !== null) this.sourceText.setDepth(footY + 0.6);
    this.activityText.setDepth(footY + 0.6);
    if (this.modelText !== null) this.modelText.setDepth(footY + 0.6);
    this.detailText.setDepth(footY + 0.6);
    this.taskText.setDepth(footY + 0.6);
    if (this.contextTrack !== null) this.contextTrack.setDepth(footY + 0.6);
    if (this.contextFill !== null) this.contextFill.setDepth(footY + 0.61);
    if (this.contextText !== null) this.contextText.setDepth(footY + 0.6);
    if (this.skillText !== null) this.skillText.setDepth(footY + 0.6);
    if (this.childBadge !== null) this.childBadge.setDepth(footY + 0.6);
    if (this.selectionHalo !== null) this.selectionHalo.setDepth(footY + 0.4);
  }

  setSessionIdentity(agent: AgentState): void {
    this.nameText.setText(agent.name);
    this.xcodeSession = isXcodeAgent(agent);
    this.sourceLabel = sourceBadgeLabel(agent);
    this.sourceText?.setText(this.sourceLabel);
    this.setSourceBadgeVisible(this.sourceBadgeVisible);
  }

  /**
   * Show or hide the source badge (`CODEX` / `CLAUDE`). Called by the scene
   * whenever the fleet's provider makeup changes. Lazily creates the Text
   * object on first reveal. When a subagent marker is already present, the
   * two labels sit side-by-side on the subagent row; otherwise the badge sits
   * alone on that row.
   */
  setSourceBadgeVisible(visible: boolean): void {
    visible = visible || this.xcodeSession;
    this.sourceBadgeVisible = visible;
    const justCreated = visible && this.sourceText === null;
    if (justCreated) {
      this.sourceText = addCrispText(
        this.scene,
        this._x,
        this._y + this.subagentOffsetY,
        this.sourceLabel ?? this.source.toUpperCase(),
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

  /**
   * Show the model badge (e.g. `OPUS`, `SONNET`) next to the activity label on
   * the row below the hero. Pass `undefined` to hide/destroy it. Called by the
   * scene whenever the agent's model changes (mid-session switches included).
   */
  setModel(modelId: string | undefined): void {
    const badge = modelBadge(modelId);
    if (badge === null) {
      if (this.modelText !== null) {
        this.modelText.destroy();
        this.modelText = null;
        this.layoutActivityAndModel();
      }
      return;
    }
    if (this.modelText === null) {
      this.modelText = addCrispText(
        this.scene,
        this._x,
        this._y + this.activityOffsetY,
        badge.short,
        {
          fontSize: '11px',
          color: badge.color,
          fontFamily: 'monospace',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 2,
        },
      );
      // New text object: give it the hero's current depth so it renders above
      // buildings even before the next tween tick re-runs updateDepth().
      this.updateDepth();
    } else {
      this.modelText.setText(badge.short);
      this.modelText.setColor(badge.color);
    }
    this.layoutActivityAndModel();
  }

  /**
   * Center the activity label — plus the model badge when present — as a
   * group on the hero's x axis, sharing the activityOffsetY row. A 6 px gap
   * separates the two so they read as "activity · MODEL" without gluing.
   */
  private layoutActivityAndModel(): void {
    const y = this._y + this.activityOffsetY;
    if (this.modelText === null) {
      this.activityText.setOrigin(0.5, 0.5);
      this.activityText.setPosition(this._x, y);
      return;
    }
    const gap = 6;
    const widthA = this.activityText.displayWidth;
    const widthM = this.modelText.displayWidth;
    const leftEdge = this._x - (widthA + gap + widthM) / 2;
    this.activityText.setOrigin(0, 0.5);
    this.activityText.setPosition(leftEdge, y);
    this.modelText.setOrigin(0, 0.5);
    this.modelText.setPosition(leftEdge + widthA + gap, y);
  }

  /**
   * Context-window occupancy. The bar only appears when the window is known
   * (Codex reports it; Claude's is configured or inferred) and the user hasn't
   * hidden context bars. Critical occupancy (≥ 90%) pulses.
   */
  setContext(context: ContextUsage | undefined): void {
    this.contextValue = context;
    this.refreshContextBar();
  }

  setContextBarVisible(visible: boolean): void {
    this.contextBarsEnabled = visible;
    this.refreshContextBar();
  }

  private refreshContextBar(): void {
    const pct = this.contextBarsEnabled ? contextPct(this.contextValue) : null;
    if (pct === null) {
      this.destroyContextBar();
      return;
    }
    const level = contextLevel(pct);
    const color = CONTEXT_LEVEL_COLOR[level];
    if (this.contextTrack === null || this.contextFill === null || this.contextText === null) {
      this.destroyContextBar();
      this.contextTrack = this.scene.add.rectangle(0, 0, CONTEXT_BAR_W, CONTEXT_BAR_H, 0x000000, 0.6).setOrigin(0.5, 0.5);
      this.contextFill = this.scene.add.rectangle(0, 0, 1, CONTEXT_BAR_H - 1, hexToNumber(color), 1).setOrigin(0, 0.5);
      this.contextText = addCrispText(this.scene, 0, 0, '', {
        fontSize: '9px',
        color,
        fontFamily: 'monospace',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0, 0.5);
    }
    const fill = Math.max(1, Math.min(CONTEXT_BAR_W, (CONTEXT_BAR_W * pct) / 100));
    this.contextFill.setSize(fill, CONTEXT_BAR_H - 1);
    this.contextFill.setFillStyle(hexToNumber(color), 1);
    this.contextText.setText(`${Math.round(pct)}%`);
    this.contextText.setColor(color);
    if (level === 'critical') {
      if (this.contextPulse === null) {
        this.contextPulse = this.scene.tweens.add({
          targets: [this.contextFill, this.contextText],
          alpha: { from: 1, to: 0.4 },
          duration: 500,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1,
        });
      }
    } else if (this.contextPulse !== null) {
      this.contextPulse.stop();
      this.contextPulse = null;
      this.contextFill.setAlpha(1);
      this.contextText.setAlpha(1);
    }
    this.layoutContextBar();
    this.updateDepth();
  }

  private destroyContextBar(): void {
    if (this.contextPulse !== null) {
      this.contextPulse.stop();
      this.contextPulse = null;
    }
    this.contextTrack?.destroy();
    this.contextFill?.destroy();
    this.contextText?.destroy();
    this.contextTrack = null;
    this.contextFill = null;
    this.contextText = null;
  }

  private layoutContextBar(): void {
    if (this.contextTrack === null || this.contextFill === null || this.contextText === null) return;
    const y = this._y + this.contextOffsetY;
    this.contextTrack.setPosition(this._x, y);
    this.contextFill.setPosition(this._x - CONTEXT_BAR_W / 2, y);
    this.contextText.setPosition(this._x + CONTEXT_BAR_W / 2 + 3, y);
  }

  /** `✦ brainstorming` buff tag while a skill's instructions apply; `undefined` clears it. */
  setActiveSkill(name: string | undefined): void {
    if (name === undefined || name.length === 0) {
      if (this.skillText !== null) {
        this.skillText.destroy();
        this.skillText = null;
      }
      return;
    }
    const label = `✦ ${skillShortName(name)}`;
    if (this.skillText === null) {
      this.skillText = addCrispText(this.scene, this._x, this._y + this.skillOffsetY, label, {
        fontSize: '9px',
        color: SKILL_COLOR,
        fontFamily: 'monospace',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5);
      this.updateDepth();
    } else {
      this.skillText.setText(label);
      this.skillText.setPosition(this._x, this._y + this.skillOffsetY);
    }
  }

  /**
   * Complete the `SUBAGENT` badge with the role (`SUBAGENT · Explore`). The
   * badge keeps its fixed color: the family is read from the name label,
   * which wears the parent's color.
   */
  setSubagentRole(role: string | undefined): void {
    if (this.subagentText === null) return;
    const label = role !== undefined && role.length > 0 ? `SUBAGENT · ${role}` : 'SUBAGENT';
    // setText is guarded upstream, but skip the layout pass too when nothing changed.
    if (this.subagentText.text === label) return;
    this.subagentText.setText(label);
    this.layoutSubagentAndSource();
  }

  /** `⚑ N` next to the name: how many live subagents work for this hero. 0 hides it. */
  setChildCount(count: number): void {
    if (count <= 0) {
      if (this.childBadge !== null) {
        this.childBadge.destroy();
        this.childBadge = null;
      }
      return;
    }
    const label = `⚑ ${count}`;
    if (this.childBadge === null) {
      this.childBadge = addCrispText(this.scene, this._x, this._y + this.nameOffsetY, label, {
        fontSize: '10px',
        color: CHILD_BADGE_COLOR,
        fontFamily: 'monospace',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0, 0.5);
      this.updateDepth();
    } else {
      this.childBadge.setText(label);
    }
    this.layoutNameRow();
  }

  /** Name centered on the hero; the child badge hangs off its right edge. */
  private layoutNameRow(): void {
    const y = this._y + this.nameOffsetY;
    this.nameText.setPosition(this._x, y);
    if (this.childBadge !== null) {
      this.childBadge.setPosition(this._x + this.nameText.displayWidth / 2 + 4, y);
    }
  }

  /** Re-place every label relative to the current position. */
  private layoutAll(): void {
    this.layoutNameRow();
    this.layoutSubagentAndSource();
    this.layoutActivityAndModel();
    this.layoutContextBar();
    if (this.skillText !== null) this.skillText.setPosition(this._x, this._y + this.skillOffsetY);
    this.detailText.setPosition(this._x, this._y + this.detailOffsetY);
    this.taskText.setPosition(this._x, this._y + this.taskOffsetY);
    if (this.selectionHalo !== null) {
      this.selectionHalo.setPosition(this._x, this._y);
    }
    this.updateDepth();
  }

  /** Update the truncated task line shown below the detail. */
  updateTask(task?: string): void {
    if (task === undefined || task.length === 0) {
      this.taskText.setText('');
      return;
    }
    const single = task.replace(/\s+/g, ' ').trim();
    const text = single.length > TASK_MAX_CHARS
      ? single.slice(0, TASK_MAX_CHARS - 1) + '…'
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
      detail = command.length > 25 ? command.slice(0, 24) + '…' : command;
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
        this.layoutAll();
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
    this.destroyContextBar();
    this.sprite.destroy();
    this.nameText.destroy();
    if (this.subagentText !== null) this.subagentText.destroy();
    if (this.sourceText !== null) this.sourceText.destroy();
    this.activityText.destroy();
    if (this.modelText !== null) this.modelText.destroy();
    if (this.skillText !== null) this.skillText.destroy();
    if (this.childBadge !== null) this.childBadge.destroy();
    this.detailText.destroy();
    this.taskText.destroy();
  }
}
