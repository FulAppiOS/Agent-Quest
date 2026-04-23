import { getActiveTheme } from '../game/themes/registry';
import type { AgentState } from '../types/agent';

interface HeroAvatarProps {
  agent: AgentState;
  size?: number;
  className?: string;
  title?: string;
}

const DEFAULT_SIZE = 24;

export function HeroAvatar({ agent, size = DEFAULT_SIZE, className, title }: HeroAvatarProps) {
  const preview = getActiveTheme().getHeroPreview(agent.heroColor, agent.heroClass);
  const bgWidth = preview.sheetColumns * size;
  const bgHeight = preview.sheetRows * size;

  return (
    <div
      className={className}
      title={title ?? agent.heroClass}
      role="img"
      aria-label={`${agent.heroClass} ${agent.name}`}
      style={{
        backgroundImage: `url('${preview.url}')`,
        backgroundSize: `${bgWidth}px ${bgHeight}px`,
        backgroundPosition: '0 0',
        backgroundRepeat: 'no-repeat',
        width: size,
        height: size,
        imageRendering: 'pixelated',
        flexShrink: 0,
      }}
    />
  );
}
