import { sfx } from './audio';
import { buildScene, HORIZON, SCENE_H, SCENE_W, THEMES, type Theme } from './scene';

export type Phase = 'menu' | 'playing' | 'paused' | 'over';

export interface Hud {
  score: number;
  combo: number;
  wave: number;
  health: number;
  ammo: number;
  mag: number;
  reloading: number; // 0..1
  cover: number; // 0..100
  inCover: boolean;
  scoped: boolean;
  zoom: number;
  remaining: number;
  themeName: string;
  banner: string;
  accuracy: number;
}

type EType = 'soldier' | 'sniper' | 'drone' | 'tank';

interface Enemy {
  id: number;
  type: EType;
  x: number;
  d: number;
  alt: number;
  vx: number;
  hp: number;
  maxHp: number;
  t: number;
  fireIn: number;
  aim: number; // telegraph progress 0..1
  aiming: boolean;
  dead: boolean;
  deathT: number;
  hitFlash: number;
  facing: number;
  phase: number;
  shots: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  grav: number;
  kind: 'spark' | 'smoke' | 'debris' | 'ring';
  rot?: number;
  vr?: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  vy: number;
  size: number;
}

interface Tracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  incoming: boolean;
}

const MAG = 7;
const RELOAD_TIME = 1.75;
const CYCLE_TIME = 0.72;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Game {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  dpr = 1;

  phase: Phase = 'menu';
  onHud: (h: Hud) => void = () => {};
  onGameOver: (score: number, wave: number) => void = () => {};
  onPhase: (p: Phase) => void = () => {};

  // camera
  camX = 0;
  camTop = 0;
  vs = 1;
  viewW = 0;
  viewH = 0;

  // aim
  chx = 0;
  chy = 0;
  zoom = 1;
  targetZoom = 1;
  scoped = false;
  zoomLevel = 2.6;
  swayT = 0;

  // player
  score = 0;
  wave = 0;
  health = 100;
  ammo = MAG;
  reloadT = 0;
  cycleT = 0;
  cover = 100;
  coverHeld = false;
  coverAmt = 0;
  combo = 1;
  comboT = 0;
  shotsFired = 0;
  shotsHit = 0;

  // world
  theme: Theme = THEMES[0];
  scene: HTMLCanvasElement | null = null;
  enemies: Enemy[] = [];
  particles: Particle[] = [];
  popups: Popup[] = [];
  tracers: Tracer[] = [];
  nextId = 1;

  // wave
  toSpawn = 0;
  spawnT = 0;
  spawnGap = 1.6;
  maxAlive = 4;
  banner = '';
  bannerT = 0;

  // fx
  shake = 0;
  shakeT = 0;
  flash = 0;
  hurtFlash = 0;
  muzzle = 0;
  recoil = 0;
  hitMarker = 0;
  timeScale = 1;
  hitStop = 0;
  killGlow = 0;

  // input
  ptrDown = false;
  lastPtr = { x: 0, y: 0 };
  touchMode = false;
  keys: Record<string, boolean> = {};
  fireQueued = false;

  private raf = 0;
  private lastTime = 0;
  private hudT = 0;
  idleT = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    this.bind();
    this.buildTheme(0);
    this.camX = SCENE_W / 2 - this.viewW / 2;
    this.camTop = HORIZON - this.viewH * 0.42;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unbind();
  }

  // ---------------------------------------------------------------- input
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) {
      if (e.code === 'KeyC') e.preventDefault();
      return;
    }
    this.keys[e.code] = true;
    if (e.code === 'Space') {
      e.preventDefault();
      this.fire();
    }
    if (e.code === 'KeyR') this.reload();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyF') this.toggleScope();
    if (e.code === 'KeyC') {
      e.preventDefault();
      this.coverHeld = true;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') this.togglePause();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
    if (e.code === 'KeyC') this.coverHeld = false;
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.phase !== 'playing') return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.ptrDown = true;
    this.touchMode = e.pointerType !== 'mouse';
    const r = this.canvas.getBoundingClientRect();
    this.lastPtr = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.pointerType === 'mouse') {
      this.chx = this.lastPtr.x;
      this.chy = this.lastPtr.y;
      if (e.button === 2) this.toggleScope();
      else this.fire();
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.phase !== 'playing') return;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (e.pointerType === 'mouse') {
      this.touchMode = false;
      const s = this.scoped ? 0.45 : 1;
      if (s === 1) {
        this.chx = x;
        this.chy = y;
      } else {
        this.chx = clamp(this.chx + (x - this.lastPtr.x) * s, 0, this.W);
        this.chy = clamp(this.chy + (y - this.lastPtr.y) * s, 0, this.H);
      }
    } else if (this.ptrDown) {
      this.touchMode = true;
      const s = (this.scoped ? 0.85 : 1.5) * (this.W < 700 ? 1.15 : 1);
      this.chx = clamp(this.chx + (x - this.lastPtr.x) * s, this.W * 0.06, this.W * 0.94);
      this.chy = clamp(this.chy + (y - this.lastPtr.y) * s, this.H * 0.08, this.H * 0.8);
    }
    this.lastPtr = { x, y };
  };

  private onPointerUp = (e: PointerEvent) => {
    this.ptrDown = false;
    this.canvas.releasePointerCapture?.(e.pointerId);
  };

  private onWheel = (e: WheelEvent) => {
    if (this.phase !== 'playing') return;
    e.preventDefault();
    if (e.deltaY < 0) {
      this.scoped = true;
      this.zoomLevel = clamp(this.zoomLevel + 0.8, 2, 6);
    } else if (this.scoped && this.zoomLevel > 2.1) {
      this.zoomLevel = clamp(this.zoomLevel - 0.8, 2, 6);
    } else {
      this.scoped = false;
    }
    this.targetZoom = this.scoped ? this.zoomLevel : 1;
  };

  private onCtx = (e: Event) => e.preventDefault();

  private onVisibility = () => {
    if (document.hidden && this.phase === 'playing') this.setPhase('paused');
  };

  private bind() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onCtx);
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private unbind() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onCtx);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    this.W = Math.max(320, rect.width);
    this.H = Math.max(240, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const fit = Math.min(this.H / 640, this.W / 780);
    this.vs = Math.max(fit, this.H / 1000, this.W / 2500);
    this.viewW = this.W / this.vs;
    this.viewH = this.H / this.vs;
    this.camX = clamp(this.camX, 0, SCENE_W - this.viewW);
    this.camTop = clamp(this.camTop, 0, SCENE_H - this.viewH);
    if (this.chx === 0 && this.chy === 0) {
      this.chx = this.W / 2;
      this.chy = this.H * 0.45;
    }
    this.chx = clamp(this.chx, 0, this.W);
    this.chy = clamp(this.chy, 0, this.H);
  };

  // ---------------------------------------------------------------- api
  setPhase(p: Phase) {
    this.phase = p;
    this.onPhase(p);
  }

  start() {
    sfx.resume();
    this.score = 0;
    this.health = 100;
    this.wave = 0;
    this.combo = 1;
    this.comboT = 0;
    this.ammo = MAG;
    this.reloadT = 0;
    this.cycleT = 0;
    this.cover = 100;
    this.coverAmt = 0;
    this.coverHeld = false;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.enemies = [];
    this.particles = [];
    this.popups = [];
    this.tracers = [];
    this.scoped = false;
    this.targetZoom = 1;
    this.zoom = 1;
    this.chx = this.W / 2;
    this.chy = this.H * 0.45;
    this.camX = SCENE_W / 2 - this.viewW / 2;
    this.camTop = HORIZON - this.viewH * 0.42;
    this.setPhase('playing');
    this.nextWave();
  }

  togglePause() {
    if (this.phase === 'playing') this.setPhase('paused');
    else if (this.phase === 'paused') this.setPhase('playing');
  }

  resumeGame() {
    if (this.phase === 'paused') this.setPhase('playing');
  }

  toggleScope() {
    if (this.phase !== 'playing' || this.coverAmt > 0.4) return;
    this.scoped = !this.scoped;
    this.targetZoom = this.scoped ? this.zoomLevel : 1;
    sfx.zoom(this.scoped);
  }

  setCover(on: boolean) {
    this.coverHeld = on;
  }

  reload() {
    if (this.phase !== 'playing') return;
    if (this.reloadT > 0 || this.ammo >= MAG) return;
    this.reloadT = RELOAD_TIME;
    sfx.reloadClick();
  }

  // ---------------------------------------------------------------- world
  buildTheme(i: number) {
    this.theme = THEMES[i % THEMES.length];
    this.scene = buildScene(this.theme, 9871 + i * 7919);
  }

  nextWave() {
    this.wave++;
    this.buildTheme(this.wave - 1);
    const w = this.wave;
    this.toSpawn = 4 + Math.floor(w * 1.7);
    this.spawnGap = Math.max(0.55, 1.9 - w * 0.11);
    this.maxAlive = Math.min(9, 3 + Math.floor(w / 1.5));
    this.spawnT = 0.5;
    this.enemies = [];
    this.banner = `الموجة ${w} — ${this.theme.name}`;
    this.bannerT = 2.6;
    this.health = Math.min(100, this.health + (w > 1 ? 22 : 0));
    this.ammo = MAG;
    this.reloadT = 0;
    if (w > 1) {
      this.score += 250 * (w - 1);
      sfx.waveClear();
    }
  }

  private pickType(): EType {
    const w = this.wave;
    const r = Math.random();
    if (w <= 1) return 'soldier';
    if (w === 2) return r < 0.72 ? 'soldier' : 'sniper';
    if (w === 3) return r < 0.55 ? 'soldier' : r < 0.78 ? 'sniper' : 'drone';
    if (r < 0.42) return 'soldier';
    if (r < 0.62) return 'sniper';
    if (r < 0.83) return 'drone';
    return 'tank';
  }

  spawnEnemy() {
    const type = this.pickType();
    const center = this.camX + this.viewW / 2;
    let x: number;
    if (Math.random() < 0.6) {
      // keep the action on-screen so the loop stays hot
      x = this.camX + this.viewW * (0.1 + Math.random() * 0.8);
    } else {
      const spread = this.viewW * (0.55 + Math.random() * 0.85);
      x = center + (Math.random() < 0.5 ? -1 : 1) * spread;
    }
    x = clamp(x, 80, SCENE_W - 80);
    let d: number;
    switch (type) {
      case 'sniper':
        d = 0.12 + Math.random() * 0.3;
        break;
      case 'drone':
        d = 0.4 + Math.random() * 0.4;
        break;
      case 'tank':
        d = 0.3 + Math.random() * 0.32;
        break;
      default:
        d = 0.32 + Math.random() * 0.55;
    }
    const hp = type === 'tank' ? 5 : type === 'drone' ? 2 : 1;
    const e: Enemy = {
      id: this.nextId++,
      type,
      x,
      d,
      alt: type === 'drone' ? 140 + Math.random() * 130 : 0,
      vx: type === 'soldier' ? (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 30)
        : type === 'drone' ? (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 60)
        : type === 'tank' ? (Math.random() < 0.5 ? -1 : 1) * 14
        : 0,
      hp,
      maxHp: hp,
      t: 0,
      fireIn: type === 'sniper' ? 2.6 + Math.random() * 2 : type === 'tank' ? 3.4 : 1.8 + Math.random() * 2.4,
      aim: 0,
      aiming: false,
      dead: false,
      deathT: 0,
      hitFlash: 0,
      facing: 1,
      phase: Math.random() * 10,
      shots: 0,
    };
    this.enemies.push(e);
  }

  // ---------------------------------------------------------------- projection
  sx(sceneX: number) {
    return (sceneX - this.camX) * this.vs;
  }
  sy(sceneY: number) {
    return (sceneY - this.camTop) * this.vs;
  }
  groundY(d: number) {
    return HORIZON + 16 + Math.pow(d, 1.55) * 258;
  }
  escale(e: Enemy) {
    const base = 0.3 + Math.pow(e.d, 1.4) * 1.9;
    return base * this.vs;
  }
  epos(e: Enemy) {
    return { x: this.sx(e.x), y: this.sy(this.groundY(e.d)) - e.alt * this.vs * (0.3 + e.d) };
  }

  // hitbox in unzoomed screen space
  boxes(e: Enemy) {
    const p = this.epos(e);
    const s = this.escale(e);
    if (e.type === 'tank') {
      return {
        body: { x: p.x - 62 * s, y: p.y - 46 * s, w: 124 * s, h: 46 * s },
        head: { x: p.x - 16 * s, y: p.y - 70 * s, w: 34 * s, h: 22 * s },
      };
    }
    if (e.type === 'drone') {
      return {
        body: { x: p.x - 34 * s, y: p.y - 16 * s, w: 68 * s, h: 26 * s },
        head: { x: p.x - 11 * s, y: p.y - 10 * s, w: 22 * s, h: 16 * s },
      };
    }
    return {
      body: { x: p.x - 15 * s, y: p.y - 52 * s, w: 30 * s, h: 52 * s },
      head: { x: p.x - 9 * s, y: p.y - 68 * s, w: 18 * s, h: 17 * s },
    };
  }

  // ---------------------------------------------------------------- shooting
  fire() {
    if (this.phase !== 'playing') return;
    if (this.coverAmt > 0.35) return;
    if (this.reloadT > 0 || this.cycleT > 0) return;
    if (this.ammo <= 0) {
      sfx.dryFire();
      this.reload();
      return;
    }
    this.ammo--;
    this.cycleT = CYCLE_TIME;
    this.shotsFired++;
    sfx.shot();
    this.muzzle = 1;
    this.recoil = 1;
    this.addShake(this.scoped ? 7 : 12, 0.28);
    this.flash = 0.5;

    const cx = this.chx;
    const cy = this.chy;
    // spread when not scoped / while moving
    const spread = (this.scoped ? 2 : 10) * (this.ptrDown && this.touchMode ? 1.3 : 1);
    const ax = cx + (Math.random() - 0.5) * spread;
    const ay = cy + (Math.random() - 0.5) * spread;
    const pad = this.touchMode ? 9 : 4; // small aim assist, bigger on touch

    const candidates = this.enemies.filter((e) => !e.dead).sort((a, b) => b.d - a.d);
    let hitEnemy: Enemy | null = null;
    let head = false;
    const inside = (bx: number, by: number, bw: number, bh: number, p: number) =>
      ax > bx - p && ax < bx + bw + p && ay > by - p && ay < by + bh + p;
    for (const e of candidates) {
      const b = this.boxes(e);
      const inHead = inside(b.head.x, b.head.y, b.head.w, b.head.h, pad * 0.45);
      const inBody = inside(b.body.x, b.body.y, b.body.w, b.body.h, pad);
      if (inHead || inBody) {
        hitEnemy = e;
        head = inHead;
        break;
      }
    }

    if (hitEnemy) {
      this.shotsHit++;
      this.damage(hitEnemy, head);
    } else {
      this.combo = 1;
      this.comboT = 0;
      this.dustPuff(ax, ay);
      this.tracers.push({ x1: this.W * 0.82, y1: this.H * 1.02, x2: ax, y2: ay, life: 0.12, incoming: false });
    }
  }

  private damage(e: Enemy, head: boolean) {
    const p = this.epos(e);
    const s = this.escale(e);
    this.tracers.push({ x1: this.W * 0.82, y1: this.H * 1.02, x2: p.x, y2: p.y - 30 * s, life: 0.1, incoming: false });
    e.hitFlash = 1;
    this.hitMarker = 1;
    const dmg = head ? (e.type === 'tank' ? 3 : 99) : e.type === 'tank' ? 1 : 1;
    e.hp -= dmg;
    this.sparks(p.x, p.y - (e.type === 'tank' ? 26 : head ? 60 : 34) * s, head ? '#ff5a3c' : '#ffb545', head ? 26 : 14);

    if (e.hp <= 0) {
      this.kill(e, head);
    } else {
      sfx.hit();
      this.addShake(3, 0.12);
      this.popups.push({
        x: p.x,
        y: p.y - 50 * s,
        text: 'إصابة',
        color: '#ffd479',
        life: 0.7,
        vy: -50,
        size: 16,
      });
    }
  }

  private kill(e: Enemy, head: boolean) {
    e.dead = true;
    e.deathT = 0;
    const p = this.epos(e);
    const s = this.escale(e);
    const base = e.type === 'tank' ? 400 : e.type === 'drone' ? 180 : e.type === 'sniper' ? 220 : 100;
    const distBonus = Math.round((1 - e.d) * 120);
    const mult = head ? 2.5 : 1;
    const gained = Math.round((base + distBonus) * mult * this.combo);
    this.score += gained;
    this.combo = Math.min(5, this.combo + 1);
    this.comboT = 3.4;
    this.killGlow = 1;

    if (e.type === 'tank' || e.type === 'drone') {
      sfx.explode();
      this.explosion(p.x, p.y - 20 * s, e.type === 'tank' ? 1.4 : 0.8);
      this.addShake(e.type === 'tank' ? 26 : 14, 0.5);
    } else if (head) {
      sfx.headshot();
      this.addShake(9, 0.3);
      this.hitStop = 0.07;
      this.timeScale = 0.3;
    } else {
      sfx.hit();
      this.addShake(5, 0.2);
    }
    this.sparks(p.x, p.y - 40 * s, '#ff8a3c', 22);
    this.popups.push({
      x: p.x,
      y: p.y - 62 * s,
      text: `${head ? 'إصابة رأس! ' : ''}+${gained}${this.combo > 1 ? ` ×${this.combo}` : ''}`,
      color: head ? '#ff6b4a' : '#ffe08a',
      life: 1.3,
      vy: -70,
      size: head ? 26 : 20,
    });
  }

  // ---------------------------------------------------------------- fx helpers
  addShake(mag: number, t: number) {
    this.shake = Math.max(this.shake, mag);
    this.shakeT = Math.max(this.shakeT, t);
  }

  sparks(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 260;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0.3 + Math.random() * 0.5,
        max: 0.8,
        size: 1.5 + Math.random() * 3,
        color,
        grav: 480,
        kind: 'spark',
      });
    }
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.3, max: 0.3, size: 6, color: '#fff2c4', grav: 0, kind: 'ring' });
  }

  dustPuff(x: number, y: number) {
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 20 + Math.random() * 90;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.6,
        max: 1,
        size: 4 + Math.random() * 12,
        color: 'rgba(210,196,166,0.55)',
        grav: -20,
        kind: 'smoke',
      });
    }
  }

  explosion(x: number, y: number, scale: number) {
    for (let i = 0; i < 40 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 420) * scale;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 100,
        life: 0.35 + Math.random() * 0.7,
        max: 1.05,
        size: (2 + Math.random() * 6) * scale,
        color: Math.random() < 0.5 ? '#ffd24a' : Math.random() < 0.6 ? '#ff7a22' : '#ff3d1f',
        grav: 500,
        kind: 'spark',
      });
    }
    for (let i = 0; i < 22 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * 60 * scale,
        vy: Math.sin(a) * 60 * scale - 60,
        life: 0.8 + Math.random() * 1.2,
        max: 2,
        size: (14 + Math.random() * 26) * scale,
        color: 'rgba(50,42,38,0.5)',
        grav: -40,
        kind: 'smoke',
      });
    }
    for (let i = 0; i < 10 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * (100 + Math.random() * 260),
        vy: -Math.random() * 320,
        life: 0.8 + Math.random() * 0.6,
        max: 1.4,
        size: (3 + Math.random() * 7) * scale,
        color: '#3a3530',
        grav: 700,
        kind: 'debris',
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 14,
      });
    }
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 30 * scale, color: '#ffd88a', grav: 0, kind: 'ring' });
    this.flash = Math.max(this.flash, 0.5 * scale);
  }

  hurt(amount: number, fromX: number, fromY: number) {
    this.health -= amount;
    this.hurtFlash = 1;
    this.addShake(16, 0.4);
    sfx.hurt();
    this.combo = 1;
    this.tracers.push({ x1: fromX, y1: fromY, x2: this.W / 2, y2: this.H * 0.6, life: 0.14, incoming: true });
    if (this.health <= 0) {
      this.health = 0;
      this.gameOver();
    }
  }

  gameOver() {
    if (this.phase === 'over') return;
    this.setPhase('over');
    sfx.gameOver();
    this.explosion(this.W / 2, this.H * 0.7, 1.2);
    this.addShake(30, 0.8);
    this.onGameOver(Math.round(this.score), this.wave);
  }

  // ---------------------------------------------------------------- update
  private update(dt: number) {
    if (this.phase === 'over') {
      this.stepFx(dt);
      return;
    }
    if (this.phase !== 'playing') return;

    // time scale recovery
    this.timeScale = lerp(this.timeScale, 1, dt * 3.5);
    if (this.timeScale > 0.985) this.timeScale = 1;

    // aim / camera
    this.zoom = lerp(this.zoom, this.targetZoom, dt * 11);
    if (this.scoped) {
      // scoped aiming works like a precision joystick: reticle re-centres, camera pans
      this.chx = lerp(this.chx, this.W / 2, dt * 6);
      this.chy = lerp(this.chy, this.H * 0.45, dt * 6);
    }
    const dz = this.scoped ? 0.02 : 0.3;
    const nx = (this.chx / this.W - 0.5) * 2;
    const ny = (this.chy / this.H - 0.5) * 2;
    const panSpeed = (this.scoped ? 260 : 620) / Math.max(1, this.zoom * 0.55);
    if (Math.abs(nx) > dz) this.camX += Math.sign(nx) * (Math.abs(nx) - dz) / (1 - dz) * panSpeed * dt;
    if (Math.abs(ny) > 0.42) this.camTop += Math.sign(ny) * (Math.abs(ny) - 0.42) / 0.58 * panSpeed * 0.42 * dt;
    // keyboard pan
    const kp = panSpeed * 1.1 * dt;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.camX -= kp;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) this.camX += kp;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) this.camTop -= kp * 0.5;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) this.camTop += kp * 0.5;

    this.camX = clamp(this.camX, 0, SCENE_W - this.viewW);
    const lo = Math.max(0, HORIZON - this.viewH * 0.68);
    const hi = Math.max(lo, Math.min(SCENE_H - this.viewH, HORIZON - this.viewH * 0.2));
    this.camTop = clamp(this.camTop, lo, hi);

    // breathing sway when scoped
    this.swayT += dt;
    if (this.scoped) {
      this.camX += Math.sin(this.swayT * 1.3) * 4.2 * dt * (this.coverAmt > 0.2 ? 0 : 1);
      this.camTop += Math.cos(this.swayT * 0.9) * 3.0 * dt;
    }

    // cover
    const wantCover = this.coverHeld && this.cover > 0;
    this.coverAmt = lerp(this.coverAmt, wantCover ? 1 : 0, dt * 9);
    if (wantCover) {
      this.cover = Math.max(0, this.cover - 34 * dt);
      if (this.scoped) {
        this.scoped = false;
        this.targetZoom = 1;
      }
    } else {
      this.cover = Math.min(100, this.cover + 17 * dt);
    }

    // weapon timers
    if (this.cycleT > 0) this.cycleT = Math.max(0, this.cycleT - dt);
    if (this.reloadT > 0) {
      const before = this.reloadT;
      this.reloadT = Math.max(0, this.reloadT - dt * (this.coverAmt > 0.5 ? 1.55 : 1));
      if (before > RELOAD_TIME * 0.5 && this.reloadT <= RELOAD_TIME * 0.5) sfx.reloadClick();
      if (this.reloadT === 0) {
        this.ammo = MAG;
        sfx.reloadClick();
      }
    } else if (this.ammo === 0) {
      this.reload();
    }

    // combo decay
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 1;
    }

    // spawns
    if (this.toSpawn > 0) {
      this.spawnT -= dt;
      const alive = this.enemies.filter((e) => !e.dead).length;
      if (this.spawnT <= 0 && alive < this.maxAlive) {
        this.spawnEnemy();
        this.toSpawn--;
        this.spawnT = this.spawnGap * (0.7 + Math.random() * 0.6);
      }
    } else if (this.enemies.every((e) => e.dead)) {
      this.nextWave();
    }

    // enemies
    for (const e of this.enemies) {
      e.t += dt;
      if (e.dead) {
        e.deathT += dt;
        continue;
      }
      e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
      // movement
      e.x += e.vx * dt;
      if (e.x < 60 || e.x > SCENE_W - 60) e.vx *= -1;
      e.x = clamp(e.x, 60, SCENE_W - 60);
      e.facing = e.vx >= 0 ? 1 : -1;
      if (e.type === 'drone') e.alt += Math.sin(e.t * 1.6 + e.phase) * 22 * dt;

      // firing logic
      const visible = this.isVisible(e);
      e.fireIn -= dt * (visible ? 1 : 0.35);
      if (e.fireIn <= 0 && !e.aiming) {
        e.aiming = true;
        e.aim = 0;
        if (e.type === 'sniper') sfx.alarm();
      }
      if (e.aiming) {
        const telegraph = e.type === 'sniper' ? 1.5 : e.type === 'tank' ? 1.7 : e.type === 'drone' ? 0.9 : 1.15;
        e.aim += dt / telegraph;
        if (e.aim >= 1) {
          e.aiming = false;
          e.aim = 0;
          e.shots++;
          const cool =
            e.type === 'sniper' ? 4.2 : e.type === 'tank' ? 4.6 : e.type === 'drone' ? 2.1 : 2.9;
          e.fireIn = cool * (0.8 + Math.random() * 0.5) * Math.max(0.55, 1 - this.wave * 0.03);
          this.enemyShoot(e);
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead || e.deathT < 4);

    this.stepFx(dt);
  }

  private stepFx(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      if (p.kind === 'smoke') {
        p.vx *= 1 - dt * 1.4;
        p.size += dt * 26;
      }
      if (p.kind === 'debris' && p.vr !== undefined) p.rot = (p.rot || 0) + p.vr * dt;
    }
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const p of this.popups) {
      p.life -= dt;
      p.y += p.vy * dt;
      p.vy *= 1 - dt * 2.2;
    }
    this.popups = this.popups.filter((p) => p.life > 0);

    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.shake *= 1 - dt * 4.5;
    } else this.shake = 0;
    this.flash = Math.max(0, this.flash - dt * 3.4);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.5);
    this.muzzle = Math.max(0, this.muzzle - dt * 9);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.hitMarker = Math.max(0, this.hitMarker - dt * 3.2);
    this.killGlow = Math.max(0, this.killGlow - dt * 2);
    if (this.bannerT > 0) this.bannerT -= dt;
  }

  private isVisible(e: Enemy) {
    const p = this.epos(e);
    return p.x > -120 && p.x < this.W + 120;
  }

  private enemyShoot(e: Enemy) {
    const p = this.epos(e);
    const s = this.escale(e);
    sfx.enemyShot();
    this.sparks(p.x + 14 * s * e.facing, p.y - 34 * s, '#ffd06a', 6);
    const inCover = this.coverAmt > 0.55;
    const dmgTable: Record<EType, number> = { soldier: 7, sniper: 20, drone: 6, tank: 20 };
    let dmg = dmgTable[e.type] * (1 + this.wave * 0.045);
    if (e.type === 'drone') dmg *= 1;
    const missChance = e.type === 'sniper' ? 0.12 : 0.3;
    if (inCover) {
      this.popups.push({ x: this.W / 2, y: this.H * 0.62, text: 'محتمي', color: '#7ce0a0', life: 0.6, vy: -40, size: 18 });
      return;
    }
    if (Math.random() < missChance) {
      this.tracers.push({ x1: p.x, y1: p.y - 34 * s, x2: this.W * (0.3 + Math.random() * 0.4), y2: this.H * 1.1, life: 0.12, incoming: true });
      this.addShake(4, 0.15);
      return;
    }
    this.hurt(Math.round(dmg), p.x, p.y - 34 * s);
  }

  // ---------------------------------------------------------------- render
  private render() {
    const g = this.ctx;
    const W = this.W;
    const H = this.H;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = this.theme.sky[0];
    g.fillRect(0, 0, W, H);

    const sh = this.shake;
    const ox = (Math.random() - 0.5) * sh;
    const oy = (Math.random() - 0.5) * sh;
    const coverDrop = this.coverAmt * H * 0.16;

    g.save();
    g.translate(ox, oy + coverDrop);

    // zoom about crosshair
    g.save();
    g.translate(this.chx, this.chy);
    g.scale(this.zoom, this.zoom);
    g.translate(-this.chx, -this.chy);

    // background
    if (this.scene) {
      g.imageSmoothingEnabled = true;
      const srcW = Math.min(this.viewW, SCENE_W);
      const srcH = Math.min(this.viewH, SCENE_H);
      g.drawImage(this.scene, clamp(this.camX, 0, SCENE_W - srcW), clamp(this.camTop, 0, SCENE_H - srcH), srcW, srcH, 0, 0, W, H);
    }

    // enemies sorted far -> near
    const list = [...this.enemies].sort((a, b) => a.d - b.d);
    for (const e of list) this.drawEnemy(g, e);

    // particles
    this.drawParticles(g);

    // tracers
    for (const t of this.tracers) {
      const a = clamp(t.life * 8, 0, 1);
      g.strokeStyle = t.incoming ? `rgba(255,90,60,${a})` : `rgba(255,230,160,${a})`;
      g.lineWidth = t.incoming ? 2.5 : 2;
      g.beginPath();
      g.moveTo(t.x1, t.y1);
      g.lineTo(t.x2, t.y2);
      g.stroke();
    }

    // popups
    for (const p of this.popups) {
      const a = clamp(p.life * 1.6, 0, 1);
      g.globalAlpha = a;
      g.font = `900 ${p.size}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.color;
      g.fillText(p.text, p.x, p.y);
      g.globalAlpha = 1;
    }

    g.restore(); // end zoom

    // foreground: cover ledge / sandbags (rises as the player ducks)
    if (this.zoom <= 1.3 || this.coverAmt > 0.2) {
      g.save();
      g.translate(0, -coverDrop * 1.55);
      this.drawForeground(g);
      g.restore();
    }
    g.restore(); // end shake

    // scope / hud overlays (not shaken)
    if (this.phase === 'playing' || this.phase === 'paused') {
      if (this.zoom > 1.15) this.drawScopeOverlay(g);
      else this.drawCrosshair(g);
    }

    this.drawThreatArrows(g);
    this.drawWeapon(g);

    // hit marker
    if (this.hitMarker > 0) {
      const a = this.hitMarker;
      g.strokeStyle = `rgba(255,240,200,${a})`;
      g.lineWidth = 3;
      const r0 = 10 + (1 - a) * 12;
      const r1 = r0 + 10;
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        g.beginPath();
        g.moveTo(this.chx + dx * r0, this.chy + dy * r0);
        g.lineTo(this.chx + dx * r1, this.chy + dy * r1);
        g.stroke();
      }
    }

    // muzzle flash light
    if (this.flash > 0.01) {
      g.fillStyle = `rgba(255,225,170,${this.flash * 0.35})`;
      g.fillRect(0, 0, W, H);
    }
    // damage vignette
    if (this.hurtFlash > 0.01) {
      const rg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.22, W / 2, H / 2, Math.max(W, H) * 0.72);
      rg.addColorStop(0, 'rgba(180,0,0,0)');
      rg.addColorStop(1, `rgba(170,10,10,${0.75 * this.hurtFlash})`);
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
    }
    // low health pulse
    if (this.health < 35 && this.phase === 'playing') {
      const pulse = (Math.sin(performance.now() / 260) * 0.5 + 0.5) * 0.35;
      const rg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      rg.addColorStop(0, 'rgba(120,0,0,0)');
      rg.addColorStop(1, `rgba(140,0,0,${pulse})`);
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
    }
    // kill glow
    if (this.killGlow > 0.01) {
      g.fillStyle = `rgba(255,180,80,${this.killGlow * 0.08})`;
      g.fillRect(0, 0, W, H);
    }

    // banner
    if (this.bannerT > 0 && this.phase === 'playing') {
      const a = clamp(this.bannerT, 0, 1) * clamp((2.6 - this.bannerT) * 4, 0, 1);
      g.globalAlpha = a;
      g.textAlign = 'center';
      g.font = '900 clamp(20px, 4vw, 40px) system-ui, sans-serif';
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, H * 0.16, W, 66);
      g.fillStyle = this.theme.accent;
      g.font = '900 32px system-ui, sans-serif';
      g.fillText(this.banner, W / 2, H * 0.16 + 44);
      g.globalAlpha = 1;
    }

    // vignette
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.38, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  private drawParticles(g: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.kind === 'smoke') {
        g.globalAlpha = a * 0.55;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
      } else if (p.kind === 'ring') {
        g.globalAlpha = a;
        g.strokeStyle = p.color;
        g.lineWidth = 3 * a;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1.6 - a) * 2.2, 0, Math.PI * 2);
        g.stroke();
      } else if (p.kind === 'debris') {
        g.globalAlpha = a;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot || 0);
        g.fillStyle = p.color;
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        g.restore();
      } else {
        g.globalAlpha = a;
        g.fillStyle = p.color;
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------- entities
  private drawEnemy(g: CanvasRenderingContext2D, e: Enemy) {
    const p = this.epos(e);
    if (p.x < -260 || p.x > this.W + 260) return;
    const s = this.escale(e);
    const dead = e.dead;
    const dt = e.deathT;
    g.save();
    g.translate(p.x, p.y);
    if (dead) {
      const fall = clamp(dt * 3.2, 0, 1);
      g.globalAlpha = clamp(1 - (dt - 1.6) / 1.5, 0, 1);
      if (e.type !== 'tank' && e.type !== 'drone') {
        g.rotate(fall * 1.5 * e.facing);
      } else {
        g.translate(0, fall * 6 * s);
      }
    }
    if (e.hitFlash > 0) {
      g.shadowColor = 'rgba(255,120,60,0.9)';
      g.shadowBlur = 22 * e.hitFlash;
    }

    if (e.type === 'soldier' || e.type === 'sniper') this.drawSoldier(g, e, s, dead);
    else if (e.type === 'drone') this.drawDrone(g, e, s, dead);
    else this.drawTank(g, e, s, dead);

    g.restore();

    if (!dead) {
      // aiming telegraph
      if (e.aiming) {
        const a = e.aim;
        const rad = (e.type === 'tank' ? 40 : 26) * s + 16;
        g.strokeStyle = `rgba(255,60,50,${0.35 + a * 0.6})`;
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(p.x, p.y - 34 * s, rad * (1.35 - a * 0.35), -Math.PI / 2, -Math.PI / 2 + a * Math.PI * 2);
        g.stroke();
        if (e.type === 'sniper') {
          const gl = (Math.sin(e.t * 26) * 0.5 + 0.5) * a;
          g.fillStyle = `rgba(255,${120 - gl * 80},80,${0.5 + gl * 0.5})`;
          g.beginPath();
          g.arc(p.x + 8 * s, p.y - 52 * s, 4 + gl * 4, 0, Math.PI * 2);
          g.fill();
        }
      }
      // health bar for tough units
      if (e.maxHp > 1 && e.hp < e.maxHp) {
        const w = 54 * s;
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(p.x - w / 2, p.y - (e.type === 'tank' ? 82 : 40) * s, w, 6);
        g.fillStyle = '#ff6a4a';
        g.fillRect(p.x - w / 2, p.y - (e.type === 'tank' ? 82 : 40) * s, w * (e.hp / e.maxHp), 6);
      }
    }
  }

  private drawSoldier(g: CanvasRenderingContext2D, e: Enemy, s: number, dead: boolean) {
    const dark = this.theme.night;
    const uniform = e.type === 'sniper' ? (dark ? '#2c3a2c' : '#4a5b39') : dark ? '#31404f' : '#6b6448';
    const skin = '#c99a6e';
    const walk = e.type === 'soldier' && !dead ? Math.sin(e.t * 7) : 0;
    g.scale(e.facing, 1);
    // shadow
    g.globalAlpha *= 1;
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.ellipse(0, 0, 18 * s, 5 * s, 0, 0, Math.PI * 2);
    g.fill();
    // legs
    g.strokeStyle = uniform;
    g.lineWidth = 7 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, -22 * s);
    g.lineTo(walk * 8 * s, -1 * s);
    g.moveTo(0, -22 * s);
    g.lineTo(-walk * 8 * s, -1 * s);
    g.stroke();
    // torso
    g.fillStyle = uniform;
    g.beginPath();
    g.roundRect(-11 * s, -50 * s, 22 * s, 30 * s, 5 * s);
    g.fill();
    // vest
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(-11 * s, -44 * s, 22 * s, 12 * s);
    // arms + weapon
    g.strokeStyle = uniform;
    g.lineWidth = 5.5 * s;
    g.beginPath();
    g.moveTo(-4 * s, -45 * s);
    g.lineTo(16 * s, -38 * s);
    g.stroke();
    g.strokeStyle = '#2a2a2a';
    g.lineWidth = 3.6 * s;
    g.beginPath();
    if (e.type === 'sniper') {
      g.moveTo(4 * s, -40 * s);
      g.lineTo(34 * s, -44 * s);
    } else {
      g.moveTo(4 * s, -38 * s);
      g.lineTo(26 * s, -40 * s);
    }
    g.stroke();
    // head
    g.fillStyle = skin;
    g.beginPath();
    g.arc(1 * s, -58 * s, 7.5 * s, 0, Math.PI * 2);
    g.fill();
    // helmet
    g.fillStyle = e.type === 'sniper' ? '#3d4a33' : '#57543c';
    g.beginPath();
    g.arc(1 * s, -60 * s, 8.6 * s, Math.PI, 0);
    g.fill();
    g.fillRect(-7.6 * s, -61 * s, 16 * s, 3.4 * s);
    if (e.hitFlash > 0) {
      g.fillStyle = `rgba(255,150,90,${e.hitFlash * 0.7})`;
      g.fillRect(-14 * s, -70 * s, 28 * s, 70 * s);
    }
  }

  private drawDrone(g: CanvasRenderingContext2D, e: Enemy, s: number, dead: boolean) {
    const blur = dead ? 0 : (e.t * 40) % (Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath();
    g.ellipse(0, 20 * s, 22 * s, 5 * s, 0, 0, Math.PI * 2);
    g.fill();
    // arms
    g.strokeStyle = '#39404a';
    g.lineWidth = 4 * s;
    g.beginPath();
    g.moveTo(-26 * s, -8 * s);
    g.lineTo(26 * s, -8 * s);
    g.moveTo(-22 * s, 4 * s);
    g.lineTo(22 * s, 4 * s);
    g.stroke();
    // rotors
    g.strokeStyle = 'rgba(190,200,215,0.55)';
    g.lineWidth = 2 * s;
    for (const rx of [-26, 26]) {
      for (const ry of [-8, 4]) {
        g.beginPath();
        g.ellipse(rx * s, ry * s - 4 * s, 13 * s, 3 * s, blur, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // body
    g.fillStyle = '#4b5361';
    g.beginPath();
    g.roundRect(-15 * s, -12 * s, 30 * s, 20 * s, 5 * s);
    g.fill();
    g.fillStyle = '#232830';
    g.beginPath();
    g.arc(0, 6 * s, 6.5 * s, 0, Math.PI * 2);
    g.fill();
    // blinking light
    const blink = Math.sin(e.t * 8) > 0 ? 1 : 0.2;
    g.fillStyle = `rgba(255,70,60,${blink})`;
    g.beginPath();
    g.arc(11 * s, -12 * s, 3 * s, 0, Math.PI * 2);
    g.fill();
  }

  private drawTank(g: CanvasRenderingContext2D, e: Enemy, s: number, dead: boolean) {
    const body = dead ? '#2c2a26' : this.theme.night ? '#39423a' : this.theme.id === 'jungle' ? '#4a5c3c' : '#8a7f5e';
    const dark = dead ? '#1c1a18' : 'rgba(0,0,0,0.35)';
    g.scale(e.facing, 1);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(0, 2 * s, 62 * s, 8 * s, 0, 0, Math.PI * 2);
    g.fill();
    // tracks
    g.fillStyle = '#2f2c28';
    g.beginPath();
    g.roundRect(-58 * s, -20 * s, 116 * s, 20 * s, 8 * s);
    g.fill();
    g.fillStyle = '#4a453e';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(-46 * s + i * 18 * s, -10 * s, 6.5 * s, 0, Math.PI * 2);
      g.fill();
    }
    // hull
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-56 * s, -20 * s);
    g.lineTo(-48 * s, -38 * s);
    g.lineTo(48 * s, -38 * s);
    g.lineTo(58 * s, -20 * s);
    g.closePath();
    g.fill();
    g.fillStyle = dark;
    g.fillRect(-48 * s, -26 * s, 96 * s, 4 * s);
    // turret
    g.fillStyle = body;
    g.beginPath();
    g.roundRect(-24 * s, -58 * s, 48 * s, 22 * s, 6 * s);
    g.fill();
    // hatch weakspot
    g.fillStyle = dead ? '#191715' : '#a8905f';
    g.beginPath();
    g.arc(0, -60 * s, 9 * s, Math.PI, 0);
    g.fill();
    g.strokeStyle = 'rgba(255,90,60,0.7)';
    g.lineWidth = 1.6 * s;
    if (!dead) {
      g.beginPath();
      g.arc(0, -60 * s, 11 * s, Math.PI, 0);
      g.stroke();
    }
    // barrel
    g.fillStyle = '#5b5548';
    g.fillRect(20 * s, -52 * s, 62 * s, 7 * s);
    g.fillRect(74 * s, -55 * s, 12 * s, 13 * s);
    if (dead) {
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(-58 * s, -58 * s, 120 * s, 58 * s);
    }
  }

  // ------------------------------------------------------------- overlays
  private drawForeground(g: CanvasRenderingContext2D) {
    const W = this.W;
    const H = this.H;
    const y = H * 0.86 - this.coverAmt * H * 0.1;
    const bottom = H * 1.8;
    // ledge
    g.fillStyle = this.theme.night ? '#0f1420' : '#3c3529';
    g.beginPath();
    g.moveTo(0, bottom);
    g.lineTo(0, y + 30);
    g.quadraticCurveTo(W * 0.25, y - 6, W * 0.55, y + 16);
    g.quadraticCurveTo(W * 0.8, y + 36, W, y - 4);
    g.lineTo(W, bottom);
    g.closePath();
    g.fill();
    // sandbags
    g.fillStyle = this.theme.night ? '#1b2130' : '#6b6046';
    for (let i = 0; i < 9; i++) {
      const bx = (i / 8) * W;
      const by = y + 18 + Math.sin(i * 1.7) * 10;
      g.beginPath();
      g.ellipse(bx, by, W * 0.085, 22, Math.sin(i) * 0.12, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, y + 36, W, H);
  }

  private drawCrosshair(g: CanvasRenderingContext2D) {
    const x = this.chx;
    const y = this.chy;
    const spread = 12 + (this.cycleT / CYCLE_TIME) * 18 + (this.reloadT > 0 ? 16 : 0);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.moveTo(x + dx * spread, y + dy * spread);
      g.lineTo(x + dx * (spread + 11), y + dy * (spread + 11));
    }
    g.stroke();
    g.fillStyle = 'rgba(255,90,60,0.95)';
    g.fillRect(x - 1.5, y - 1.5, 3, 3);
    // range readout
    g.font = '600 11px ui-monospace, monospace';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.textAlign = 'left';
    g.fillText(`${Math.round(200 + (1 - clamp((y / this.H), 0, 1)) * 900)}m`, x + spread + 16, y - 8);
  }

  private drawScopeOverlay(g: CanvasRenderingContext2D) {
    const W = this.W;
    const H = this.H;
    const x = this.chx;
    const y = this.chy;
    const r = Math.min(W, H) * 0.46;
    g.save();
    // black mask outside circle
    g.beginPath();
    g.rect(0, 0, W, H);
    g.arc(x, y, r, 0, Math.PI * 2, true);
    g.fillStyle = '#05070a';
    g.fill();
    // lens shading
    const lens = g.createRadialGradient(x, y, r * 0.4, x, y, r);
    lens.addColorStop(0, 'rgba(0,0,0,0)');
    lens.addColorStop(0.85, 'rgba(0,0,0,0.35)');
    lens.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = lens;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    // ring
    g.strokeStyle = 'rgba(0,0,0,0.95)';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(x, y, r + 5, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(180,190,200,0.25)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, r - 2, 0, Math.PI * 2);
    g.stroke();
    // reticle
    g.strokeStyle = 'rgba(20,25,20,0.9)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x - r, y);
    g.lineTo(x - 16, y);
    g.moveTo(x + 16, y);
    g.lineTo(x + r, y);
    g.moveTo(x, y - r);
    g.lineTo(x, y - 16);
    g.moveTo(x, y + 16);
    g.lineTo(x, y + r);
    g.stroke();
    // mil dots
    g.fillStyle = 'rgba(20,25,20,0.9)';
    for (let i = 1; i <= 5; i++) {
      const d = i * (r / 6);
      g.beginPath();
      g.arc(x, y + d, 2.4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(x - d, y, 2.4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(x + d, y, 2.4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(200,40,30,0.95)';
    g.beginPath();
    g.arc(x, y, 2.4, 0, Math.PI * 2);
    g.fill();
    // scope info
    g.font = '700 13px ui-monospace, monospace';
    g.fillStyle = 'rgba(120,220,150,0.8)';
    g.textAlign = 'center';
    g.fillText(`${this.zoomLevel.toFixed(1)}x`, x, y - r * 0.72);
    g.fillText(`WIND 0.3 R`, x, y + r * 0.78);
    g.restore();
  }

  private drawThreatArrows(g: CanvasRenderingContext2D) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const p = this.epos(e);
      if (p.x >= 0 && p.x <= this.W) continue;
      const left = p.x < 0;
      const x = left ? 30 : this.W - 30;
      const yy = clamp(p.y, this.H * 0.18, this.H * 0.72);
      const danger = e.aiming;
      const a = danger ? 0.45 + e.aim * 0.55 : 0.3;
      const sc = danger ? 1 + e.aim * 0.35 : 0.7;
      g.save();
      g.translate(x, yy);
      g.rotate(left ? Math.PI : 0);
      g.scale(sc, sc);
      g.fillStyle = danger ? `rgba(255,60,50,${a})` : `rgba(255,220,140,${a})`;
      g.beginPath();
      g.moveTo(16, 0);
      g.lineTo(-10, -13);
      g.lineTo(-10, 13);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  private drawWeapon(g: CanvasRenderingContext2D) {
    if (this.zoom > 1.35 || this.phase !== 'playing') return;
    const W = this.W;
    const H = this.H;
    const k = this.recoil;
    const scale = Math.min(1.25, Math.max(0.7, W / 1100));
    g.save();
    g.translate(W * 0.72 + k * 26, H * 1.0 + k * 34 + this.coverAmt * H * 0.25);
    g.rotate(-0.22 + k * 0.16);
    g.scale(scale, scale);

    // stock / body
    g.fillStyle = '#4c4636';
    g.beginPath();
    g.roundRect(-60, -50, 340, 52, 12);
    g.fill();
    g.fillStyle = '#3b3629';
    g.beginPath();
    g.roundRect(80, -66, 150, 22, 8);
    g.fill();
    // barrel
    g.fillStyle = '#2b2b2b';
    g.fillRect(250, -46, 220, 18);
    g.fillStyle = '#1f1f1f';
    g.fillRect(430, -52, 46, 30);
    // scope
    g.fillStyle = '#232323';
    g.beginPath();
    g.roundRect(120, -104, 170, 34, 12);
    g.fill();
    g.fillStyle = '#111';
    g.beginPath();
    g.ellipse(300, -87, 16, 24, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(120,60,160,0.55)';
    g.beginPath();
    g.ellipse(300, -87, 10, 17, 0, 0, Math.PI * 2);
    g.fill();
    // mag
    g.fillStyle = '#3a3a35';
    g.beginPath();
    g.roundRect(60, 0, 46, 46, 6);
    g.fill();
    // hand
    g.fillStyle = '#b98b60';
    g.beginPath();
    g.roundRect(-10, -34, 76, 60, 20);
    g.fill();
    g.fillStyle = '#8a6a4a';
    g.beginPath();
    g.roundRect(-30, -20, 60, 70, 18);
    g.fill();

    // muzzle flash
    if (this.muzzle > 0.05) {
      const m = this.muzzle;
      g.save();
      g.translate(478, -37);
      g.globalAlpha = m;
      g.fillStyle = '#fff0b8';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const rr = i % 2 === 0 ? 54 * m : 20 * m;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.7);
      }
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,160,60,0.7)';
      g.beginPath();
      g.arc(0, 0, 34 * m, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.restore();
  }

  // ---------------------------------------------------------------- loop
  private emitHud(force = false) {
    this.hudT -= 1;
    if (!force && this.hudT > 0) return;
    this.hudT = 4;
    const alive = this.enemies.filter((e) => !e.dead).length;
    this.onHud({
      score: Math.round(this.score),
      combo: this.combo,
      wave: this.wave,
      health: Math.round(this.health),
      ammo: this.ammo,
      mag: MAG,
      reloading: this.reloadT > 0 ? 1 - this.reloadT / RELOAD_TIME : 0,
      cover: Math.round(this.cover),
      inCover: this.coverAmt > 0.4,
      scoped: this.scoped,
      zoom: this.zoomLevel,
      remaining: alive + this.toSpawn,
      themeName: this.theme.name,
      banner: this.banner,
      accuracy: this.shotsFired ? Math.round((this.shotsHit / this.shotsFired) * 100) : 100,
    });
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.05) dt = 0.05;

    if (this.phase === 'menu') {
      // slow cinematic drift behind the menu
      this.idleT += dt;
      this.camX = clamp(
        SCENE_W / 2 - this.viewW / 2 + Math.sin(this.idleT * 0.12) * (SCENE_W * 0.16),
        0,
        SCENE_W - this.viewW,
      );
      this.camTop = HORIZON - this.viewH * 0.42 + Math.sin(this.idleT * 0.09) * 22;
      this.chx = this.W / 2;
      this.chy = this.H * 0.45;
      this.zoom = 1;
    } else if (this.hitStop > 0) {
      this.hitStop -= dt;
    } else {
      this.update(dt * this.timeScale);
    }
    this.render();
    this.emitHud();
  };
}
