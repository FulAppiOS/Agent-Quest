import {
  HERO_CLASSES,
  HERO_COLORS,
  type AgentState,
  type HeroClass,
  type HeroColor,
} from './types/agent';

export interface HeroLook {
  heroClass: HeroClass;
  heroColor: HeroColor;
}

export type HeroLookMap = Record<string, HeroLook>;

/** Stable identity: same source + cwd + display name keeps the same look
 * across sessions. Session ids change every chat. */
export function heroLookKey(agent: Pick<AgentState, 'source' | 'cwd' | 'name'>): string {
  return `${agent.source}\t${agent.cwd}\t${agent.name}`;
}

export function isHeroClass(v: unknown): v is HeroClass {
  return typeof v === 'string' && (HERO_CLASSES as readonly string[]).includes(v);
}

export function isHeroColor(v: unknown): v is HeroColor {
  return typeof v === 'string' && (HERO_COLORS as readonly string[]).includes(v);
}

export function applyHeroLook(agent: AgentState, look: HeroLook | undefined): AgentState {
  if (look === undefined) return agent;
  if (agent.heroClass === look.heroClass && agent.heroColor === look.heroColor) return agent;
  return { ...agent, heroClass: look.heroClass, heroColor: look.heroColor };
}

export function parseHeroLooks(raw: string | null): HeroLookMap {
  if (raw === null) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  if (obj === null || typeof obj !== 'object') return {};
  const looksRaw = (obj as Record<string, unknown>).looks;
  if (looksRaw === null || typeof looksRaw !== 'object' || Array.isArray(looksRaw)) return {};

  const out: HeroLookMap = {};
  for (const [key, value] of Object.entries(looksRaw as Record<string, unknown>)) {
    if (key.length === 0) continue;
    if (value === null || typeof value !== 'object') continue;
    const rec = value as Record<string, unknown>;
    if (!isHeroClass(rec.heroClass) || !isHeroColor(rec.heroColor)) continue;
    out[key] = { heroClass: rec.heroClass, heroColor: rec.heroColor };
  }
  return out;
}

export function serializeHeroLooks(looks: HeroLookMap): string {
  return JSON.stringify({ v: 1, looks });
}
