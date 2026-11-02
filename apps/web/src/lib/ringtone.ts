// Incoming-job ringtone, synthesized with Web Audio (no audio file to download or cache).
// Browsers only let a page make sound after the user has interacted with it, so the audio context
// is created on the first tap anywhere; riders always tap "Go online" before an offer can arrive.

let ctx: AudioContext | null = null;

function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

/** Call once at startup: arms audio on the first user gesture. */
export function armRingtone() {
  const once = () => {
    unlock();
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

/** One "ring-ring": two short bursts of a warbling two-tone, like a phone. */
function ringOnce(ac: AudioContext, at: number) {
  const out = ac.createGain();
  out.gain.value = 0.0001;
  out.connect(ac.destination);

  for (const freq of [480, 620]) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // 20 Hz warble gives the classic ringer flutter.
    const lfo = ac.createOscillator();
    const lfoGain = ac.createGain();
    lfo.frequency.value = 20;
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(out);
    osc.start(at);
    lfo.start(at);
    osc.stop(at + 1.3);
    lfo.stop(at + 1.3);
  }

  // Two bursts: 0–0.5 s and 0.75–1.25 s, with quick fades so there are no clicks.
  const g = out.gain;
  for (const start of [at, at + 0.75]) {
    g.setValueAtTime(0.0001, start);
    g.exponentialRampToValueAtTime(0.35, start + 0.03);
    g.setValueAtTime(0.35, start + 0.45);
    g.exponentialRampToValueAtTime(0.0001, start + 0.5);
  }
}

/** Rings (and vibrates) every 3 s until the returned function is called. */
export function startRingtone(): () => void {
  unlock();
  const ac = ctx;
  let stopped = false;
  const ring = () => {
    if (stopped) return;
    if (ac && ac.state === 'running') ringOnce(ac, ac.currentTime + 0.05);
    navigator.vibrate?.([500, 250, 500]);
  };
  ring();
  const id = setInterval(ring, 3000);
  return () => {
    stopped = true;
    clearInterval(id);
    navigator.vibrate?.(0);
  };
}
