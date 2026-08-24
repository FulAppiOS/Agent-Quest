import {
  HERO_CLASSES,
  HERO_COLORS,
  HERO_LABEL_COLOR,
  type AgentState,
  type HeroClass,
  type HeroColor,
} from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import './HeroLookPicker.css';

interface HeroLookPickerProps {
  agent: AgentState;
  isCustom: boolean;
  onChange: (look: { heroClass: HeroClass; heroColor: HeroColor }) => void;
  onReset: () => void;
}

const CLASS_LABEL: Record<HeroClass, string> = {
  warrior: 'Warrior',
  archer: 'Archer',
  pawn: 'Pawn',
};

export function HeroLookPicker({ agent, isCustom, onChange, onReset }: HeroLookPickerProps) {
  return (
    <div className="hero-look-picker">
      <div className="hero-look-picker-head">
        <span className="hero-look-picker-label">Appearance</span>
        {isCustom && (
          <button type="button" className="hero-look-reset" onClick={onReset}>
            Reset
          </button>
        )}
      </div>

      <div className="hero-look-classes" role="group" aria-label="Hero class">
        {HERO_CLASSES.map((cls) => {
          const selected = agent.heroClass === cls;
          const preview = { ...agent, heroClass: cls };
          return (
            <button
              key={cls}
              type="button"
              className={`hero-look-class ${selected ? 'selected' : ''}`}
              aria-pressed={selected}
              aria-label={CLASS_LABEL[cls]}
              onClick={() => onChange({ heroClass: cls, heroColor: agent.heroColor })}
            >
              <HeroAvatar agent={preview} size={36} title={CLASS_LABEL[cls]} />
              <span>{CLASS_LABEL[cls]}</span>
            </button>
          );
        })}
      </div>

      <div className="hero-look-colors" role="group" aria-label="Hero color">
        {HERO_COLORS.map((color) => {
          const selected = agent.heroColor === color;
          return (
            <button
              key={color}
              type="button"
              className={`hero-look-swatch ${selected ? 'selected' : ''}`}
              style={{ background: HERO_LABEL_COLOR[color] }}
              aria-pressed={selected}
              aria-label={color}
              title={color}
              onClick={() => onChange({ heroClass: agent.heroClass, heroColor: color })}
            />
          );
        })}
      </div>
    </div>
  );
}
