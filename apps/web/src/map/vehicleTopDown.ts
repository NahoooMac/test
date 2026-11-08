// Top-down 3D map icons for the three vehicles (motorcycle, scooter, bicycle), each with a
// helmeted rider and the blue delivery box, seen from above at a slight tilt so the depth reads.
// Rendered once per vehicle and direction (16 directions) to a PNG data URL and cached, so a map
// with many riders costs a handful of renders. Loaded lazily: three.js is only fetched by maps that
// show riders.
import * as THREE from 'three';

export type TopDownKind = 'motorcycle' | 'bicycle' | 'scooter';

const BRAND = 0x2563eb;
const BRAND_DARK = 0x1d4ed8;
const BRAND_LIGHT = 0x60a5fa;
const WHITE = 0xf8fafc;
const TIRE = 0x111827;
const METAL = 0x9ca3af;
const SEAT = 0x1f2937;
const JACKET = 0x2563eb;
const GLOVE = 0x0f172a;
const VISOR = 0x0b1220;
const LIGHT = 0xfff3b0;

const mat = (color: number, rough = 0.55, metal = 0.05, emissive = 0x000000) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive });

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, r = 0) {
  // Slightly rounded box: a box with bevelled look via a scaled sphere would cost more; small
  // radius-free boxes read well at icon size.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.x = r;
  return mesh;
}

function capsule(radius: number, length: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), m);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  return mesh;
}

/** Wheel lying along the vehicle (axle sideways), visible from above as a dark rounded strip. */
function wheel(radius: number, width: number, z: number) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 20), mat(TIRE, 0.9));
  tire.rotation.z = Math.PI / 2;
  g.add(tire);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width * 1.08, 14), mat(METAL, 0.3, 0.6));
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  g.position.set(0, radius, z);
  return g;
}

/** Seated (or standing) rider: jacket, arms reaching to the bars, white helmet with dark visor. */
function rider(seatY: number, seatZ: number, barZ: number, lean = 0.35, slim = 1) {
  const g = new THREE.Group();
  const torso = capsule(0.13 * slim, 0.22, mat(JACKET, 0.6), 0, seatY + 0.22, seatZ + 0.04, lean);
  g.add(torso);
  const shoulders = box(0.38 * slim, 0.08, 0.12, mat(BRAND_DARK, 0.6), 0, seatY + 0.36, seatZ + 0.1);
  g.add(shoulders);
  for (const side of [-1, 1]) {
    const dz = barZ - (seatZ + 0.1);
    const arm = capsule(0.045, Math.hypot(dz, 0.12) * 0.8, mat(JACKET, 0.6), side * 0.17 * slim, seatY + 0.3, seatZ + 0.1 + dz / 2, Math.PI / 2 - 0.35);
    g.add(arm);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat(GLOVE, 0.7));
    glove.position.set(side * 0.18 * slim, seatY + 0.25, barZ);
    g.add(glove);
  }
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), mat(WHITE, 0.25, 0.1));
  helmet.position.set(0, seatY + 0.5, seatZ + 0.18);
  helmet.scale.set(1, 0.95, 1.12);
  g.add(helmet);
  const stripe = box(0.05, 0.02, 0.26, mat(BRAND, 0.4), 0, seatY + 0.63, seatZ + 0.17);
  g.add(stripe);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), mat(VISOR, 0.15, 0.3));
  visor.position.set(0, seatY + 0.49, seatZ + 0.25);
  visor.rotation.x = Math.PI / 2;
  g.add(visor);
  return g;
}

/** Branded delivery box: blue with a white lid band and a white dot (the brand pin). */
function deliveryBox(w: number, h: number, d: number, y: number, z: number) {
  const g = new THREE.Group();
  g.add(box(w, h, d, mat(BRAND, 0.45), 0, y, z));
  g.add(box(w * 1.02, h * 0.12, d * 1.02, mat(WHITE, 0.4), 0, y + h * 0.3, z));
  const dot = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.16, w * 0.16, 0.01, 18), mat(WHITE, 0.4));
  dot.position.set(0, y + h / 2 + 0.006, z);
  g.add(dot);
  return g;
}

function headlight(y: number, z: number) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(LIGHT, 0.2, 0, 0xffe066));
  m.position.set(0, y, z);
  return m;
}

function buildMotorcycle() {
  const g = new THREE.Group();
  g.add(wheel(0.17, 0.12, 0.56), wheel(0.17, 0.14, -0.5));
  g.add(box(0.26, 0.2, 0.92, mat(BRAND, 0.35, 0.15), 0, 0.36, 0.02));
  g.add(box(0.27, 0.06, 0.5, mat(WHITE, 0.35), 0, 0.47, 0.18)); // tank stripe
  g.add(box(0.22, 0.07, 0.42, mat(SEAT, 0.8), 0, 0.5, -0.18));
  g.add(box(0.52, 0.035, 0.035, mat(METAL, 0.3, 0.7), 0, 0.62, 0.42)); // handlebar
  for (const s of [-1, 1]) g.add(box(0.07, 0.02, 0.05, mat(SEAT, 0.5), s * 0.28, 0.67, 0.44)); // mirrors
  g.add(headlight(0.44, 0.52));
  g.add(deliveryBox(0.34, 0.3, 0.32, 0.66, -0.52));
  g.add(rider(0.5, -0.12, 0.42));
  return g;
}

function buildScooter() {
  const g = new THREE.Group();
  g.add(wheel(0.12, 0.1, 0.5), wheel(0.12, 0.12, -0.44));
  g.add(box(0.2, 0.06, 0.86, mat(SEAT, 0.7), 0, 0.17, 0.02)); // deck
  g.add(box(0.21, 0.02, 0.6, mat(BRAND_LIGHT, 0.5), 0, 0.21, -0.02)); // grip tape accent
  g.add(box(0.05, 0.62, 0.05, mat(METAL, 0.3, 0.6), 0, 0.48, 0.46, -0.18)); // stem
  g.add(box(0.46, 0.035, 0.035, mat(SEAT, 0.5), 0, 0.78, 0.52));
  g.add(box(0.06, 0.32, 0.06, mat(METAL, 0.3, 0.6), 0, 0.36, -0.2)); // seat post
  g.add(box(0.2, 0.06, 0.24, mat(SEAT, 0.8), 0, 0.53, -0.2));
  g.add(headlight(0.66, 0.53));
  g.add(deliveryBox(0.3, 0.26, 0.28, 0.4, -0.5));
  g.add(rider(0.53, -0.16, 0.52, 0.2, 0.92));
  return g;
}

function buildBicycle() {
  const g = new THREE.Group();
  const frame = mat(BRAND, 0.4, 0.3);
  // Thin wheels: rings seen edge-on from above.
  for (const z of [0.5, -0.46]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 24), mat(TIRE, 0.9));
    ring.rotation.y = Math.PI / 2;
    ring.position.set(0, 0.2, z);
    g.add(ring);
  }
  g.add(box(0.04, 0.04, 0.84, frame, 0, 0.42, 0.02)); // top tube
  g.add(box(0.04, 0.36, 0.04, frame, 0, 0.3, -0.18)); // seat tube
  g.add(box(0.04, 0.3, 0.04, frame, 0, 0.36, 0.44, -0.2)); // head tube / fork
  g.add(box(0.44, 0.03, 0.03, mat(SEAT, 0.5), 0, 0.6, 0.46)); // bars
  g.add(box(0.13, 0.05, 0.2, mat(SEAT, 0.8), 0, 0.5, -0.2)); // saddle
  g.add(headlight(0.5, 0.52));
  const r = rider(0.5, -0.15, 0.46, 0.55, 0.9);
  g.add(r);
  // Delivery backpack on the rider's back.
  g.add(deliveryBox(0.32, 0.3, 0.2, 0.86, -0.32));
  return g;
}

const BUILD: Record<TopDownKind, () => THREE.Group> = {
  motorcycle: buildMotorcycle,
  scooter: buildScooter,
  bicycle: buildBicycle,
};

/** Rendered at 2× for sharp icons on phones. */
const PX = 160;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let shadow: THREE.Mesh | null = null;
const cache = new Map<string, string>();

function setup() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(PX, PX);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb7d9, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-2, 6, 3);
  scene.add(sun);
  // Soft ground shadow (a radial gradient on a plane), so the vehicle sits on the map.
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(15,23,42,0.45)');
  grad.addColorStop(1, 'rgba(15,23,42,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 1.7),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  scene.add(shadow);
  // Looking down from behind at ~70°: +Z (the vehicle's front) points up the screen.
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 3.75, -1.38);
  camera.lookAt(0, 0.3, 0.02);
}

const STEP = Math.PI / 8;

/**
 * PNG data URL of the vehicle pointing along `heading` (radians, 0 = north/up, clockwise), or
 * null when WebGL is unavailable (callers keep their 2D fallback).
 */
export function renderTopDownIcon(kind: TopDownKind, heading = 0): string | null {
  const q = ((Math.round(heading / STEP) % 16) + 16) % 16;
  const key = `${kind}:${q}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    setup();
  } catch {
    return null;
  }
  const model = BUILD[kind]();
  // Screen right is -X for this camera, so a clockwise heading turns the model by -heading.
  model.rotation.y = -q * STEP;
  shadow!.rotation.z = -q * STEP;
  scene!.add(model);
  renderer!.render(scene!, camera!);
  // A thin white outline keeps the icon readable over busy map tiles.
  const out = document.createElement('canvas');
  out.width = out.height = PX;
  const ctx = out.getContext('2d')!;
  ctx.filter = 'drop-shadow(0 0 1.5px #ffffff) drop-shadow(0 0 1px #ffffff)';
  ctx.drawImage(renderer!.domElement, 0, 0);
  const url = out.toDataURL('image/png');
  scene!.remove(model);
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  cache.set(key, url);
  return url;
}
