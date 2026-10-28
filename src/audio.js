// Sonido sintetizado con WebAudio (sin archivos externos): motor, sirena,
// golpes y avisos. Se activa tras la primera interacción del usuario.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(c.destination);

    this.engine = c.createOscillator();
    this.engine.type = 'sawtooth';
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    this.engine.connect(lp).connect(this.engineGain).connect(this.master);
    this.engine.start();

    this.siren = c.createOscillator();
    this.siren.type = 'triangle';
    this.sirenGain = c.createGain();
    this.sirenGain.gain.value = 0;
    this.siren.connect(this.sirenGain).connect(this.master);
    this.siren.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.35;
  }

  update(t, { engineOn, speed, sirenLevel }) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.engine.frequency.setTargetAtTime(55 + speed * 4.5, now, 0.05);
    this.engineGain.gain.setTargetAtTime(engineOn ? 0.12 : 0, now, 0.1);
    const f = Math.sin(t * 2.6) > 0 ? 760 : 980;
    this.siren.frequency.setTargetAtTime(f, now, 0.04);
    this.sirenGain.gain.setTargetAtTime(Math.min(0.08, sirenLevel * 0.08), now, 0.2);
  }

  beep(freq = 880, dur = 0.12, type = 'square', vol = 0.15) {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.setTargetAtTime(0, c.currentTime + dur * 0.6, dur * 0.3);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(c.currentTime + dur * 2);
  }

  bump(force) {
    if (!this.ctx || force < 2) return;
    const c = this.ctx;
    const len = 0.15;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const s = c.createBufferSource();
    s.buffer = buf;
    const g = c.createGain();
    g.gain.value = Math.min(0.5, force / 25);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    s.connect(lp).connect(g).connect(this.master);
    s.start();
  }

  boing() {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(900, c.currentTime + 0.25);
    g.gain.value = 0.2;
    g.gain.setTargetAtTime(0, c.currentTime + 0.2, 0.08);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(c.currentTime + 0.6);
  }

  success() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f, 0.14, 'triangle', 0.18), i * 110));
  }

  fail() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this.beep(f, 0.2, 'sawtooth', 0.12), i * 160));
  }
}
