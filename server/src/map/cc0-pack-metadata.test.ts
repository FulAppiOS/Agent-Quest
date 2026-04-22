import { describe, it, expect } from 'bun:test';
import { applyRules, CC0_PACK_RULES } from './cc0-pack-metadata';
import type { ScannedAsset } from './theme-scanner';

function fakeAsset(relPath: string, w = 64, h = 64): ScannedAsset {
  const segs = relPath.split('/');
  const fileName = segs.pop()!;
  return {
    absPath: '/abs/' + relPath,
    webPath: '/assets/themes/tiny-swords-cc0/' + relPath,
    relPath,
    folderPath: segs,
    fileName,
    fileStem: fileName.replace(/\.png$/, ''),
    imageSize: { width: w, height: h },
  };
}

describe('applyRules', () => {
  it('static Deco fallback: no rule matches, default scale + prop category', () => {
    const deco = applyRules(fakeAsset('Deco/13.png'), CC0_PACK_RULES);
    expect(deco).not.toBeNull();
    expect(deco!.category).toBe('prop');
    expect(deco!.folderPath).toEqual(['Deco']);
    expect(deco!.frameWidth).toBeUndefined();
    expect(deco!.animations).toBeUndefined();
    expect(deco!.defaultScale).toBeGreaterThan(0);
  });

  it('Knights Archer Blue → 8-col 7-row spritesheet, multi-anim', () => {
    const deco = applyRules(
      fakeAsset('Factions/Knights/Troops/Archer/Blue/Archer_Blue.png', 1536, 1344),
      CC0_PACK_RULES,
    );
    expect(deco).not.toBeNull();
    expect(deco!.frameWidth).toBe(192);
    expect(deco!.frameHeight).toBe(192);
    expect(deco!.frameCount).toBe(56);
    const names = deco!.animations!.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['idle', 'walk', 'attack']));
    const idle = deco!.animations!.find((a) => a.name === 'idle')!;
    expect(idle.start).toBe(0);
    expect(idle.end).toBe(7);
  });

  it('Knights Pawn Blue → 6-col 6-row, 36 frames', () => {
    const deco = applyRules(
      fakeAsset('Factions/Knights/Troops/Pawn/Blue/Pawn_Blue.png', 1152, 1152),
      CC0_PACK_RULES,
    );
    expect(deco!.frameCount).toBe(36);
    const idle = deco!.animations!.find((a) => a.name === 'idle')!;
    expect(idle.end).toBe(5);
  });

  it('Goblin TNT Blue → 7-col 3-row, 21 frames', () => {
    const deco = applyRules(
      fakeAsset('Factions/Goblins/Troops/TNT/Blue/TNT_Blue.png', 1344, 576),
      CC0_PACK_RULES,
    );
    expect(deco!.frameCount).toBe(21);
    expect(deco!.animations!.find((a) => a.name === 'idle')!.end).toBe(5);
  });

  it('Goblin Torch → 7×5, 35 frames', () => {
    const deco = applyRules(
      fakeAsset('Factions/Goblins/Troops/Torch/Yellow/Torch_Yellow.png', 1344, 960),
      CC0_PACK_RULES,
    );
    expect(deco!.frameCount).toBe(35);
  });

  it('Effects Explosion → 9×1 single-shot', () => {
    const deco = applyRules(
      fakeAsset('Effects/Explosion/Explosions.png', 1728, 192),
      CC0_PACK_RULES,
    );
    expect(deco!.category).toBe('effect');
    expect(deco!.animations![0]!.start).toBe(0);
    expect(deco!.animations![0]!.end).toBe(8);
    expect(deco!.animations![0]!.repeat).toBe(0);
  });

  it('Effects Fire → 7×1 128px looping', () => {
    const deco = applyRules(
      fakeAsset('Effects/Fire/Fire.png', 896, 128),
      CC0_PACK_RULES,
    );
    expect(deco!.frameWidth).toBe(128);
    expect(deco!.animations![0]!.repeat).toBe(-1);
  });

  it('Knights Buildings → static house', () => {
    const deco = applyRules(
      fakeAsset('Factions/Knights/Buildings/Castle/Castle_Blue.png', 320, 256),
      CC0_PACK_RULES,
    );
    expect(deco!.category).toBe('house');
    expect(deco!.animations).toBeUndefined();
    expect(deco!.frameWidth).toBeUndefined();
  });

  it('Resources/Trees/Tree.png → 4 frames idle-picker, no animation', () => {
    const deco = applyRules(
      fakeAsset('Resources/Trees/Tree.png', 768, 576),
      CC0_PACK_RULES,
    );
    expect(deco!.category).toBe('tree');
    expect(deco!.frameWidth).toBe(192);
    expect(deco!.animations).toBeUndefined();
  });

  it('Resources/Sheep/HappySheep_Idle → 8×1 loop', () => {
    const deco = applyRules(
      fakeAsset('Resources/Sheep/HappySheep_Idle.png', 1024, 128),
      CC0_PACK_RULES,
    );
    expect(deco!.frameWidth).toBe(128);
    expect(deco!.animations![0]!.end).toBe(7);
  });

  it('UI is excluded', () => {
    expect(applyRules(fakeAsset('UI/Pointers/01.png'), CC0_PACK_RULES)).toBeNull();
    expect(applyRules(fakeAsset('UI/Buttons/Button_Blue.png'), CC0_PACK_RULES)).toBeNull();
  });

  it('keys are unique + kebab-cased from path', () => {
    const a = applyRules(fakeAsset('Deco/07.png'), CC0_PACK_RULES)!;
    const b = applyRules(fakeAsset('Resources/Trees/Tree.png', 768, 576), CC0_PACK_RULES)!;
    expect(a.key).not.toBe(b.key);
    expect(a.key).toMatch(/^[a-z0-9-]+$/);
  });

  it('label is human-readable', () => {
    const a = applyRules(fakeAsset('Factions/Goblins/Troops/Barrel/Red/Barrel_Red.png', 768, 768), CC0_PACK_RULES)!;
    expect(a.label.length).toBeGreaterThan(0);
  });

  it('group equals folderPath.join("/")', () => {
    const a = applyRules(fakeAsset('Factions/Knights/Buildings/Castle/Castle_Blue.png', 320, 256), CC0_PACK_RULES)!;
    expect(a.group).toBe('Factions/Knights/Buildings/Castle');
  });
});
