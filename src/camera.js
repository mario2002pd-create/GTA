import * as THREE from 'three';
import { clamp, angleDiff } from './geo.js';

// Cámara en tercera persona con órbita por ratón, seguimiento del coche y
// colisión 2D con fachadas para no atravesar edificios en calles estrechas.
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI;
    this.pitch = 0.32;
    this.dist = 6;
    this.shake = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.first = true;
  }

  update(dt, target, input, grid, inCar) {
    const m = input.consumeMouse();
    this.yaw -= m.x * 0.0028;
    this.pitch = clamp(this.pitch + m.y * 0.0022, -0.1, 1.2);
    const idle = performance.now() - input.lastMouseMove > 1400;
    if (inCar) {
      const sp = Math.abs(target.forwardSpeed);
      // se coloca detrás del coche cuando el ratón está quieto
      if (idle && sp > 2) {
        const behind = target.forwardSpeed >= 0 ? target.heading + Math.PI : target.heading;
        this.yaw += angleDiff(this.yaw, behind) * Math.min(1, dt * 2.5);
        this.pitch += (0.28 - this.pitch) * Math.min(1, dt * 1.5);
      }
    }
    const wantDist = inCar ? 8.5 + Math.min(4, Math.abs(target.forwardSpeed || 0) * 0.1) : 5.2;
    this.dist += (wantDist - this.dist) * Math.min(1, dt * 3);
    const tx = target.x;
    const tz = target.z;
    const ty = (inCar ? 1.6 : 1.7) + (target.y || 0);
    const horiz = Math.cos(this.pitch) * this.dist;
    let cx = tx + Math.sin(this.yaw) * horiz;
    let cz = tz + Math.cos(this.yaw) * horiz;
    let cy = ty + Math.sin(this.pitch) * this.dist + 0.6;

    // Si una fachada se interpone, acercamos la cámara
    const t = grid.raycast(tx, tz, cx, cz, 1 | 2, true);
    if (t < 1) {
      const k = Math.max(0.25, t - 0.6 / Math.max(1, horiz));
      cx = tx + (cx - tx) * k;
      cz = tz + (cz - tz) * k;
      cy = ty + (cy - ty) * Math.max(k, 0.6) + (1 - k) * 2.5;
    }
    const desired = new THREE.Vector3(cx, cy, cz);
    if (this.first) {
      this.pos.copy(desired);
      this.first = false;
    } else {
      this.pos.lerp(desired, Math.min(1, dt * (t < 1 ? 20 : 10)));
    }
    this.look.set(tx, ty, tz);
    this.camera.position.copy(this.pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      const s = this.shake * 0.3;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.look);
  }

  // Dirección "adelante" de la cámara en el plano (para caminar)
  forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }
}
