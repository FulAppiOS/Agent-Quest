import type { CSSProperties } from 'react';
import { getActiveTheme } from '../game/themes/registry';
import type { AgentState } from '../types/agent';

interface HeroAvatarProps {
  agent: AgentState;
  /**
   * Numeric pixel size, or 'inherit' to let the parent container drive
   * width/height via CSS (the background-size then scales in percentages
   * of that parent). Use 'inherit' when you want the avatar to respond
   * to a CSS variable, e.g. inside a responsive grid cell.
   */
  size?: number | 'inherit';
  className?: string;
  title?: string;
}

const DEFAULT_SIZE = 24;

export function HeroAvatar({ agent, size = DEFAULT_SIZE, className, title }: HeroAvatarProps) {
  const preview = getActiveTheme().getHeroPreview(agent.heroColor, agent.heroClass);
  const inherit = size === 'inherit';
  const backgroundSize = inherit
    ? `${preview.sheetColumns * 100}% ${preview.sheetRows * 100}%`
    : `${preview.sheetColumns * size}px ${preview.sheetRows * size}px`;
  const sizeStyle: CSSProperties = inherit
    ? { width: '100%', height: '100%' }
    : { width: size, height: size };

  return (
    <div
      className={className}
      title={title ?? agent.heroClass}
      role="img"
      aria-label={`${agent.heroClass} ${agent.name}`}
      style={{
        backgroundImage: `url('${preview.url}')`,
        backgroundSize,
        backgroundPosition: '0 0',
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
        flexShrink: 0,
        ...sizeStyle,
      }}
    />
  );
}
