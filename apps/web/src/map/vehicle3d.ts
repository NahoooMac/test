import * as THREE from 'three';

export type VehicleKind = 'motorcycle' | 'bicycle';

const ACCENT = 0x0e6b4a;
const BLUE = 0x2563eb;
const WHITE = 0xffffff;
const DARK = 0x15171a;
const CHROME = 0xaaaaaa;

function buildMotorcycle(): THREE.Group {
  const g = new THREE.Group();
  const mat = (color: number, shininess = 80) =>
    new THREE.MeshPhongMaterial({ color, shininess });

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.9), mat(ACCENT));
  body.position.set(0, 0.35, 0);
  g.add(body);

  // Seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.35), mat(DARK));
  seat.position.set(0, 0.49, -0.05);
  g.add(seat);

  // Fuel tank
  const tank = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    mat(ACCENT, 100),
  );
  tank.position.set(0, 0.46, 0.2);
  tank.scale.set(1, 0.6, 1.5);
  g.add(tank);

  // Front fork
  const forkMat = mat(CHROME, 120);
  const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), forkMat);
  fork.position.set(0, 0.35, 0.48);
  fork.rotation.x = -0.25;
  g.add(fork);

  // Handlebars
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8), forkMat);
  bar.position.set(0, 0.58, 0.48);
  bar.rotation.z = Math.PI / 2;
  g.add(bar);

  // Wheels
  const wheelMat = mat(DARK, 30);
  const wheelGeo = new THREE.TorusGeometry(0.16, 0.045, 10, 20);
  const fw = new THREE.Mesh(wheelGeo, wheelMat);
  fw.position.set(0, 0.16, 0.5);
  fw.rotation.y = Math.PI / 2;
  g.add(fw);
  const rw = new THREE.Mesh(wheelGeo, wheelMat);
  rw.position.set(0, 0.16, -0.38);
  rw.rotation.y = Math.PI / 2;
  g.add(rw);

  // Headlight
  const hl = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshPhongMaterial({ color: 0xffff99, emissive: 0xffff44, emissiveIntensity: 0.6 }),
  );
  hl.position.set(0, 0.48, 0.6);
  g.add(hl);

  // Exhaust
  const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.55, 8), forkMat);
  exh.position.set(0.14, 0.22, -0.1);
  exh.rotation.x = Math.PI / 2;
  g.add(exh);

  // Delivery box
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.32), mat(ACCENT, 60));
  box.position.set(0, 0.58, -0.4);
  g.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.34), mat(WHITE));
  lid.position.set(0, 0.76, -0.4);
  g.add(lid);

  return g;
}

function buildBicycle(): THREE.Group {
  const g = new THREE.Group();
  const mat = (color: number, shininess = 80) =>
    new THREE.MeshPhongMaterial({ color, shininess });

  const frameMat = mat(BLUE);
  const tube = (len: number) => new THREE.CylinderGeometry(0.02, 0.02, len, 8);

  // Down tube
  const dt = new THREE.Mesh(tube(0.6), frameMat);
  dt.position.set(0, 0.32, 0.05);
  dt.rotation.x = -0.5;
  g.add(dt);

  // Seat tube
  const st = new THREE.Mesh(tube(0.45), frameMat);
  st.position.set(0, 0.37, -0.15);
  g.add(st);

  // Top tube
  const tt = new THREE.Mesh(tube(0.48), frameMat);
  tt.position.set(0, 0.52, 0.05);
  tt.rotation.x = Math.PI / 2;
  g.add(tt);

  // Chain stay
  const cs = new THREE.Mesh(tube(0.4), frameMat);
  cs.position.set(0, 0.2, -0.15);
  cs.rotation.x = Math.PI / 2;
  g.add(cs);

  // Seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.2), mat(DARK));
  seat.position.set(0, 0.62, -0.15);
  g.add(seat);

  // Handlebars
  const chromeMat = mat(CHROME, 120);
  const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 8), chromeMat);
  hb.position.set(0, 0.58, 0.32);
  hb.rotation.z = Math.PI / 2;
  g.add(hb);

  // Head tube
  const ht = new THREE.Mesh(tube(0.15), chromeMat);
  ht.position.set(0, 0.5, 0.32);
  g.add(ht);

  // Wheels
  const wheelMat = mat(DARK, 30);
  const wheelGeo = new THREE.TorusGeometry(0.18, 0.028, 10, 20);
  const spokeMat = mat(CHROME, 100);
  const spokeGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.32, 4);

  for (const zPos of [0.4, -0.32]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(0, 0.18, zPos);
    wheel.rotation.y = Math.PI / 2;
    g.add(wheel);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(spokeGeo, spokeMat);
      spoke.position.set(0, 0.18, zPos);
      spoke.rotation.y = Math.PI / 2;
      spoke.rotation.x = (i * Math.PI) / 4;
      g.add(spoke);
    }
  }

  // Pedals / cranks
  const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8), chromeMat);
  crank.position.set(0, 0.2, 0);
  crank.rotation.z = Math.PI / 2;
  g.add(crank);

  // Delivery basket
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.26), mat(BLUE, 60));
  basket.position.set(0, 0.48, -0.35);
  g.add(basket);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.025, 0.28), mat(WHITE));
  lid.position.set(0, 0.62, -0.35);
  g.add(lid);

  return g;
}

// Off-screen renderer singleton (shared across all markers).
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

const SIZE = 96;
const cache = new Map<string, string>();

function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(2);
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(4, 8, 6);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-3, 4, -4);
  scene.add(fill);

  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 2.2, 2.5);
  camera.lookAt(0, 0.25, 0);
}

export function render3DVehicleIcon(kind: VehicleKind, heading = 0): string {
  const key = `${kind}-${Math.round(heading * 100)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  ensureRenderer();
  const model = kind === 'bicycle' ? buildBicycle() : buildMotorcycle();
  model.rotation.y = heading;
  scene!.add(model);
  renderer!.render(scene!, camera!);
  const dataUrl = renderer!.domElement.toDataURL('image/png');
  scene!.remove(model);

  // Dispose geometries and materials from the model
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) child.material.dispose();
    }
  });

  cache.set(key, dataUrl);
  return dataUrl;
}

export function buildVehiclePlacemarkHtml(kind: VehicleKind, heading = 0): string {
  const src = render3DVehicleIcon(kind, heading);
  const size = SIZE;
  const half = size / 2;
  return (
    `<div style="position:absolute;left:-${half}px;top:-${half}px;width:${size}px;height:${size}px;` +
    `filter:drop-shadow(0 4px 8px rgba(0,0,0,.45))">` +
    `<img src="${src}" width="${size}" height="${size}" style="display:block" />` +
    `</div>`
  );
}
