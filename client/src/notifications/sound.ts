/**
 * Tiny notification chime synthesized with the Web Audio API — no audio assets,
 * no dependencies. Each alert category gets a short, recognizable motif so you
 * can tell what happened without looking:
 *   - waiting   → a gentle rising two-note "ready for you" ding
 *   - completed → a soft descending two-note "done" chime
 *   - error     → a low, blunt double buzz
 *
 * The AudioContext is created lazily and reused. Browsers suspend audio until a
 * user gesture; we best-effort `resume()` and swallow failures, so a chime that
 * can't play (e.g. before any interaction) is simply silent rather than throwing.
 */

export type ChimeKind = 'waiting' | 'completed' | 'error';

interface Note {
  /** Frequency in Hz. */
  freq: number;
  /** Start offset from now, in seconds. */
  at: number;
  /** Duration in seconds. */
  dur: number;
  /** Oscillator waveform. */
  type: OscillatorType;
}

const MOTIFS: Record<ChimeKind, Note[]> = {
  waiting: [
    { freq: 660, at: 0,    dur: 0.14, type: 'sine' },
    { freq: 880, at: 0.12, dur: 0.20, type: 'sine' },
  ],
  completed: [
    { freq: 784, at: 0,    dur: 0.14, type: 'sine' },
    { freq: 523, at: 0.12, dur: 0.22, type: 'sine' },
  ],
  error: [
    { freq: 196, at: 0,    dur: 0.16, type: 'square' },
    { freq: 165, at: 0.18, dur: 0.20, type: 'square' },
  ],
};

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor === undefined) return null;
  if (ctx === null) {
    try { ctx = new Ctor(); } catch { return null; }
  }
  return ctx;
}

/**
 * Play the chime for `kind` at `volume` (0..1). No-op (silent) if Web Audio is
 * unavailable, the context can't resume, or volume is ~0.
 */
export function playChime(kind: ChimeKind, volume: number): void {
  if (volume <= 0) return;
  const audio = getContext();
  if (audio === null) return;

  // Resume a suspended context (autoplay policy); ignore if it rejects.
  if (audio.state === 'suspended') {
    void audio.resume().catch(() => { /* stay silent */ });
  }

  const now = audio.currentTime;
  const peak = Math.min(1, volume) * 0.22; // keep well below clipping

  for (const note of MOTIFS[kind]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = note.type;
    osc.frequency.value = note.freq;

    const start = now + note.at;
    const end = start + note.dur;
    // Quick attack, exponential decay — avoids clicks at note edges.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}
