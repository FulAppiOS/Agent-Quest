export function makeDecorationId(): string {
  return `dec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makePathId(): string {
  return `path-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeNpcId(): string {
  return `npc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
