import { mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { MapConfig } from './types';

const DATA_DIR = resolve(import.meta.dir, '../../data/maps');

const MIN_SLOT = 1;
const MAX_SLOT = 5;

export interface SlotInfo {
  slot: number;
  name: string;
  updatedAt: number | null;
  isEmpty: boolean;
  isActive: boolean;
}

function slotPath(slot: number): string {
  return resolve(DATA_DIR, `slot-${slot}.json`);
}

const ACTIVE_SLOT_PATH = resolve(DATA_DIR, 'active-slot.json');
const TEMPLATE_PATH = resolve(DATA_DIR, 'template.json');

// Legacy paths for migration
const LEGACY_CURRENT = resolve(DATA_DIR, 'current.json');
const LEGACY_BACKUP = resolve(DATA_DIR, 'current.backup.json');

function assertValidSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < MIN_SLOT || slot > MAX_SLOT) {
    throw new Error(`Slot must be an integer between ${MIN_SLOT} and ${MAX_SLOT}, got ${slot}`);
  }
}

export class MapStorage {
  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = this.init();
  }

  private async init(): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await this.migrate();
  }

  /**
   * Migrate from old single-slot system (current.json) to multi-slot.
   * If current.json exists:
   *   - Copy to slot-1.json
   *   - Create active-slot.json pointing to slot 1
   *   - Copy slot-1.json to template.json
   *   - Delete current.json and current.backup.json
   */
  private async migrate(): Promise<void> {
    const legacyFile = Bun.file(LEGACY_CURRENT);
    if (!(await legacyFile.exists())) return;

    const content = await legacyFile.arrayBuffer();

    // Move to slot-1
    await Bun.write(slotPath(1), content);

    // Set active slot to 1
    await Bun.write(ACTIVE_SLOT_PATH, JSON.stringify({ slot: 1 }, null, 2));

    // Copy as template
    await Bun.write(TEMPLATE_PATH, content);

    // Remove legacy files
    try { await unlink(LEGACY_CURRENT); } catch { /* may not exist */ }
    try { await unlink(LEGACY_BACKUP); } catch { /* may not exist */ }
  }

  async loadSlot(slot: number): Promise<MapConfig | null> {
    await this.readyPromise;
    assertValidSlot(slot);
    const file = Bun.file(slotPath(slot));
    if (!(await file.exists())) return null;
    const raw = await file.text();
    return JSON.parse(raw) as MapConfig;
  }

  async saveSlot(slot: number, config: MapConfig): Promise<void> {
    await this.readyPromise;
    assertValidSlot(slot);
    const toWrite: MapConfig = {
      ...config,
      meta: { ...config.meta, updatedAt: Date.now() },
    };
    await Bun.write(slotPath(slot), JSON.stringify(toWrite, null, 2));
  }

  /** Reset a slot by copying the template into it. Throws if no template exists. */
  async resetSlot(slot: number): Promise<void> {
    await this.readyPromise;
    assertValidSlot(slot);
    const template = Bun.file(TEMPLATE_PATH);
    if (await template.exists()) {
      const content = await template.arrayBuffer();
      await Bun.write(slotPath(slot), content);
    } else {
      // No template — just remove the slot file
      try { await unlink(slotPath(slot)); } catch { /* may not exist */ }
    }
  }

  async getActiveSlot(): Promise<number> {
    await this.readyPromise;
    const file = Bun.file(ACTIVE_SLOT_PATH);
    if (!(await file.exists())) return 1;
    const raw = await file.text();
    const parsed = JSON.parse(raw) as { slot: number };
    return parsed.slot;
  }

  async setActiveSlot(slot: number): Promise<void> {
    await this.readyPromise;
    assertValidSlot(slot);
    await Bun.write(ACTIVE_SLOT_PATH, JSON.stringify({ slot }, null, 2));
  }

  /** Load the map from the currently active slot. */
  async loadActive(): Promise<MapConfig | null> {
    const slot = await this.getActiveSlot();
    return this.loadSlot(slot);
  }

  async loadTemplate(): Promise<MapConfig | null> {
    await this.readyPromise;
    const file = Bun.file(TEMPLATE_PATH);
    if (!(await file.exists())) return null;
    const raw = await file.text();
    return JSON.parse(raw) as MapConfig;
  }

  async listSlots(): Promise<SlotInfo[]> {
    await this.readyPromise;
    const activeSlot = await this.getActiveSlot();
    const slots: SlotInfo[] = [];

    for (let s = MIN_SLOT; s <= MAX_SLOT; s++) {
      const file = Bun.file(slotPath(s));
      const exists = await file.exists();
      let name = `Slot ${s}`;
      let updatedAt: number | null = null;

      if (exists) {
        try {
          const raw = await file.text();
          const parsed = JSON.parse(raw) as MapConfig;
          name = parsed.meta?.name ?? name;
          updatedAt = parsed.meta?.updatedAt ?? null;
        } catch {
          // Corrupted file — treat as empty
        }
      }

      slots.push({
        slot: s,
        name: exists ? name : `Slot ${s}`,
        updatedAt: exists ? updatedAt : null,
        isEmpty: !exists,
        isActive: s === activeSlot,
      });
    }

    return slots;
  }
}
