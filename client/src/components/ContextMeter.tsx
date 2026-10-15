import { CONTEXT_LEVEL_COLOR, contextLevel, contextPct, formatTokens, type ContextUsage } from '../types/agent';
import './ContextMeter.css';

interface ContextMeterProps {
  context: ContextUsage | undefined;
  /** `full` (Detail Panel), `mini` (Party Bar row), `micro` (bar only, under an icon). */
  size?: 'full' | 'mini' | 'micro';
}

/**
 * Context-window occupancy bar shared by the React panels. Renders nothing
 * when the window is unknown, so panels don't need to guard for it. The color
 * ramp (green → amber → orange → red) matches the Phaser bar above each hero.
 */
export function ContextMeter({ context, size = 'full' }: ContextMeterProps) {
  const pct = contextPct(context);
  if (pct === null || context === undefined) return null;
  const level = contextLevel(pct);
  const color = CONTEXT_LEVEL_COLOR[level];
  const width = Math.min(100, Math.max(1, pct));
  const rounded = Math.round(pct);
  const title = `${formatTokens(context.used)} / ${formatTokens(context.window ?? 0)} tokens (${rounded}%)`;
  return (
    <span
      className={`ctx-meter ctx-meter--${size} ctx-level-${level}`}
      title={title}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rounded}
      aria-label="Context window usage"
    >
      <span className="ctx-meter-track">
        <span className="ctx-meter-fill" style={{ width: `${width}%`, background: color }} />
      </span>
      {size !== 'micro' && <span className="ctx-meter-pct" style={{ color }}>{rounded}%</span>}
    </span>
  );
}
