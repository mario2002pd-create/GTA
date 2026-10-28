// Teclado, ratón (pointer lock) y controles táctiles básicos.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set(); // pulsaciones de este frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.lastMouseMove = 0;
    this.canvas = canvas;
    this.touch = { x: 0, y: 0, active: false, brake: false };
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        this.lastMouseMove = performance.now();
      }
    });
    if (this.isTouch) this._setupTouch();
  }

  requestLock() {
    if (!this.isTouch && document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.();
    }
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  hit(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  axis() {
    let x = 0;
    let y = 0;
    if (this.down('KeyW', 'ArrowUp')) y += 1;
    if (this.down('KeyS', 'ArrowDown')) y -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;
    if (this.touch.active) {
      x += this.touch.x;
      y += this.touch.y;
    }
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
  }

  _setupTouch() {
    const ui = document.getElementById('touch');
    ui.hidden = false;
    const stick = document.getElementById('stick');
    const knob = document.getElementById('knob');
    let stickId = null;
    let camId = null;
    let camLast = null;
    const center = () => {
      const r = stick.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
    };
    const onStick = (t) => {
      const c = center();
      let dx = (t.clientX - c.x) / c.r;
      let dy = (t.clientY - c.y) / c.r;
      const l = Math.hypot(dx, dy);
      if (l > 1) {
        dx /= l;
        dy /= l;
      }
      this.touch.x = dx;
      this.touch.y = -dy;
      knob.style.transform = `translate(${dx * c.r * 0.6}px, ${dy * c.r * 0.6}px)`;
    };
    window.addEventListener(
      'touchstart',
      (e) => {
        for (const t of e.changedTouches) {
          const el = document.elementFromPoint(t.clientX, t.clientY);
          if (el && (el === stick || stick.contains(el))) {
            stickId = t.identifier;
            this.touch.active = true;
            onStick(t);
          } else if (el && el.dataset && el.dataset.key) {
            this.pressed.add(el.dataset.key);
            this.keys.add(el.dataset.key);
          } else if (el && el.tagName === 'CANVAS' && camId === null) {
            camId = t.identifier;
            camLast = { x: t.clientX, y: t.clientY };
          }
        }
      },
      { passive: true },
    );
    window.addEventListener(
      'touchmove',
      (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === stickId) onStick(t);
          else if (t.identifier === camId) {
            this.mouseDX += (t.clientX - camLast.x) * 1.5;
            this.mouseDY += (t.clientY - camLast.y) * 1.5;
            camLast = { x: t.clientX, y: t.clientY };
            this.lastMouseMove = performance.now();
          }
        }
      },
      { passive: true },
    );
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          stickId = null;
          this.touch.active = false;
          this.touch.x = this.touch.y = 0;
          knob.style.transform = '';
        } else if (t.identifier === camId) camId = null;
        const el = document.elementFromPoint(t.clientX, t.clientY);
        if (el && el.dataset && el.dataset.key) this.keys.delete(el.dataset.key);
      }
      // suelta botones mantenidos
      for (const b of ui.querySelectorAll('[data-key]')) {
        if (![...e.touches].some((t) => document.elementFromPoint(t.clientX, t.clientY) === b)) this.keys.delete(b.dataset.key);
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
  }
}
