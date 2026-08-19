// Tiny WebAudio synth for punchy game SFX (no assets needed)
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  resume() {
    this.ensure();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  private noiseBuffer(ctx: AudioContext, dur: number) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'lowpass') {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, dur);
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  private tone(freq: number, dur: number, gain = 0.2, type: OscillatorType = 'sine', slideTo?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  shot() {
    this.noise(0.28, 1800, 0.8, 0.85);
    this.tone(180, 0.22, 0.5, 'square', 42);
    this.noise(0.7, 500, 0.4, 0.18);
  }

  dryFire() {
    this.tone(900, 0.05, 0.12, 'square', 300);
  }

  reloadClick() {
    this.tone(420, 0.07, 0.14, 'square', 200);
    this.noise(0.08, 3000, 1, 0.14, 'highpass');
  }

  hit() {
    this.tone(1300, 0.07, 0.22, 'triangle', 800);
  }

  headshot() {
    this.tone(1750, 0.09, 0.26, 'square', 1100);
    this.tone(2400, 0.14, 0.14, 'sine', 1600);
  }

  explode() {
    this.noise(0.75, 320, 0.6, 0.9);
    this.tone(90, 0.6, 0.5, 'sawtooth', 28);
  }

  enemyShot() {
    this.noise(0.16, 900, 0.8, 0.3);
  }

  hurt() {
    this.tone(160, 0.3, 0.35, 'sawtooth', 60);
    this.noise(0.3, 400, 0.6, 0.25);
  }

  zoom(on: boolean) {
    this.tone(on ? 700 : 420, 0.1, 0.1, 'sine', on ? 1000 : 300);
  }

  waveClear() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.22, 0.2, 'triangle'), i * 95));
  }

  gameOver() {
    const notes = [500, 400, 320, 200];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.4, 0.24, 'sawtooth', n * 0.6), i * 160));
  }

  ui() {
    this.tone(660, 0.06, 0.12, 'square', 880);
  }

  alarm() {
    this.tone(880, 0.12, 0.12, 'square', 660);
  }
}

export const sfx = new Sfx();
