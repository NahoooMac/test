import * as THREE from 'three';

export type VehicleKind = 'motorcycle' | 'bicycle' | 'scooter';

const ACCENT = 0x2563eb;
const BLUE = 0x3b82f6;
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

const TEAL = 0x1e40af;

function buildScooter(): THREE.Group {
  const g = new THREE.Group();
  const mat = (color: number, shininess = 80) =>
    new THREE.MeshPhongMaterial({ color, shininess });

  // Body / main cowl — wider, rounder than motorcycle
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.7), mat(TEAL));
  body.position.set(0, 0.35, 0);
  g.add(body);

  // Front fairing / leg shield
  const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.35, 0.12), mat(TEAL, 90));
  fairing.position.set(0, 0.42, 0.35);
  g.add(fairing);

  // Flat footboard
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.4), mat(DARK, 40));
  floor.position.set(0, 0.22, 0.05);
  g.add(floor);

  // Seat — long, flat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.45), mat(DARK));
  seat.position.set(0, 0.5, -0.1);
  g.add(seat);

  // Handlebars
  const chromeMat = mat(CHROME, 120);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 8), chromeMat);
  bar.position.set(0, 0.62, 0.38);
  bar.rotation.z = Math.PI / 2;
  g.add(bar);

  // Front fork column
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), chromeMat);
  col.position.set(0, 0.5, 0.42);
  g.add(col);

  // Wheels — smaller than motorcycle
  const wheelMat = mat(DARK, 30);
  const wheelGeo = new THREE.TorusGeometry(0.13, 0.05, 10, 20);
  const fw = new THREE.Mesh(wheelGeo, wheelMat);
  fw.position.set(0, 0.13, 0.45);
  fw.rotation.y = Math.PI / 2;
  g.add(fw);
  const rw = new THREE.Mesh(wheelGeo, wheelMat);
  rw.position.set(0, 0.13, -0.35);
  rw.rotation.y = Math.PI / 2;
  g.add(rw);

  // Headlight
  const hl = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshPhongMaterial({ color: 0xffff99, emissive: 0xffff44, emissiveIntensity: 0.6 }),
  );
  hl.position.set(0, 0.55, 0.46);
  g.add(hl);

  // Tail light
  const tl = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.04, 0.03),
    new THREE.MeshPhongMaterial({ color: 0xff3333, emissive: 0xff0000, emissiveIntensity: 0.4 }),
  );
  tl.position.set(0, 0.38, -0.37);
  g.add(tl);

  // Delivery box
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.32), mat(TEAL, 60));
  box.position.set(0, 0.58, -0.38);
  g.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.34), mat(WHITE));
  lid.position.set(0, 0.76, -0.38);
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
  const model = kind === 'bicycle' ? buildBicycle() : kind === 'scooter' ? buildScooter() : buildMotorcycle();
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

const NAVY = 0x1e293b;
const SKIN = 0x8d5524;

interface RiderPose {
  seat: [number, number];
  bar: [number, number];
  peg: [number, number];
}

const POSES: Record<VehicleKind, RiderPose> = {
  motorcycle: { seat: [0.53, -0.02], bar: [0.58, 0.46], peg: [0.24, 0.12] },
  scooter: { seat: [0.54, -0.08], bar: [0.62, 0.36], peg: [0.25, 0.1] },
  bicycle: { seat: [0.64, -0.15], bar: [0.58, 0.3], peg: [0.2, 0.0] },
};

function limb(
  g: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(dir.length() - radius * 2, 0.01), 4, 8),
    material,
  );
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.add(mesh);
}

function buildRider(kind: VehicleKind): THREE.Group {
  const g = new THREE.Group();
  const p = POSES[kind];
  const jacket = new THREE.MeshPhongMaterial({ color: ACCENT, shininess: 40 });
  const pants = new THREE.MeshPhongMaterial({ color: NAVY, shininess: 20 });
  const helmet = new THREE.MeshPhongMaterial({ color: NAVY, shininess: 120 });
  const skin = new THREE.MeshPhongMaterial({ color: SKIN, shininess: 10 });
  const v = (y: number, z: number, x = 0) => new THREE.Vector3(x, y, z);

  const hip = v(p.seat[0] + 0.06, p.seat[1]);
  const shoulder = v(p.seat[0] + 0.42, p.seat[1] + 0.14);
  limb(g, hip, shoulder, 0.13, jacket);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), skin);
  neck.position.copy(shoulder).add(v(0.07, 0.03));
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 16), helmet);
  head.position.copy(shoulder).add(v(0.17, 0.05));
  g.add(head);
  const stripe = new THREE.Mesh(
    new THREE.TorusGeometry(0.126, 0.012, 6, 32, Math.PI),
    new THREE.MeshPhongMaterial({ color: ACCENT, shininess: 80 }),
  );
  stripe.position.copy(head.position);
  stripe.rotation.y = Math.PI / 2;
  g.add(stripe);
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 12, 8, -Math.PI / 3, (Math.PI * 2) / 3, Math.PI / 3, Math.PI / 3),
    new THREE.MeshPhongMaterial({ color: 0x0b1220, shininess: 200 }),
  );
  visor.position.copy(head.position).add(v(0, 0.035));
  g.add(visor);

  for (const side of [-1, 1]) {
    const x = side * 0.13;
    const sh = shoulder.clone().setX(x);
    const hand = v(p.bar[0], p.bar[1], side * 0.17);
    const elbow = sh.clone().lerp(hand, 0.5).add(v(-0.06, 0, side * 0.03));
    limb(g, sh, elbow, 0.045, jacket);
    limb(g, elbow, hand, 0.04, skin);

    const h = hip.clone().setX(side * 0.08);
    const knee = v(p.seat[0] - 0.02, p.seat[1] + 0.26, side * 0.13);
    const foot = v(p.peg[0], p.peg[1], side * 0.13);
    limb(g, h, knee, 0.06, pants);
    limb(g, knee, foot, 0.05, pants);
  }
  return g;
}

let heroRenderer: THREE.WebGLRenderer | null = null;
let heroScene: THREE.Scene | null = null;
const heroCache = new Map<string, string>();

function ensureHeroScene() {
  if (heroScene) return heroScene;
  heroScene = new THREE.Scene();
  heroScene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-4, 6, 4);
  heroScene.add(key);
  const rim = new THREE.DirectionalLight(0xdbeafe, 0.8);
  rim.position.set(3, 3, -5);
  heroScene.add(rim);
  return heroScene;
}

/** Side three-quarter render of a vehicle with its rider, for illustrations. Null without WebGL. */
export function renderVehicleHero(
  kind: VehicleKind,
  width = 360,
  height = 260,
  withRider = true,
): string | null {
  const key = `${kind}-${width}x${height}-${withRider ? 'r' : 'v'}`;
  const cached = heroCache.get(key);
  if (cached) return cached;
  try {
    const scene = ensureHeroScene();
    if (!heroRenderer) {
      heroRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      heroRenderer.setPixelRatio(2);
      heroRenderer.setClearColor(0x000000, 0);
    }
    heroRenderer.setSize(width, height);
    const cam = new THREE.PerspectiveCamera(26, width / height, 0.1, 100);
    if (withRider) {
      cam.position.set(-3.7, 1.25, 1.2);
      cam.lookAt(0, 0.6, 0.04);
    } else {
      cam.position.set(-2.25, 0.78, 0.8);
      cam.lookAt(0, 0.36, 0.04);
    }

    const group = new THREE.Group();
    group.add(kind === 'bicycle' ? buildBicycle() : kind === 'scooter' ? buildScooter() : buildMotorcycle());
    if (withRider) group.add(buildRider(kind));
    scene.add(group);
    heroRenderer.render(scene, cam);
    const url = heroRenderer.domElement.toDataURL('image/png');
    scene.remove(group);
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    });
    heroCache.set(key, url);
    return url;
  } catch {
    return null;
  }
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
