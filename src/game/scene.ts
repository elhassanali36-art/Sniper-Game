// Procedural battlefield backdrops rendered once to an offscreen canvas.
export const SCENE_W = 2800;
export const SCENE_H = 1100;
export const HORIZON = 470;

export interface Theme {
  id: string;
  name: string;
  sky: [string, string, string];
  sun: string;
  haze: string;
  mountain: [string, string];
  build: [string, string];
  ground: [string, string];
  accent: string;
  night: boolean;
  foliage?: string;
  water?: string;
}

export const THEMES: Theme[] = [
  {
    id: 'desert',
    name: 'مدينة الصحراء',
    sky: ['#8fb6d8', '#d9c9a3', '#efdcb4'],
    sun: 'rgba(255,239,196,0.95)',
    haze: 'rgba(226,205,160,0.55)',
    mountain: ['#9d8a6e', '#7d6c53'],
    build: ['#c8b28a', '#8d7a5c'],
    ground: ['#c3ab80', '#8a7551'],
    accent: '#e8b562',
    night: false,
  },
  {
    id: 'harbor',
    name: 'الميناء',
    sky: ['#5fa8d8', '#9fd0ea', '#dff0f7'],
    sun: 'rgba(255,255,235,0.95)',
    haze: 'rgba(190,220,235,0.5)',
    mountain: ['#7d94a6', '#5e7385'],
    build: ['#7d8b95', '#4c5a66'],
    ground: ['#8e9aa2', '#5b666e'],
    accent: '#ff8b3d',
    night: false,
    water: '#2f6f96',
  },
  {
    id: 'jungle',
    name: 'الأدغال',
    sky: ['#8ec5e6', '#bcd9d2', '#dfe9cf'],
    sun: 'rgba(255,255,220,0.8)',
    haze: 'rgba(180,205,170,0.5)',
    mountain: ['#5d7d63', '#415c49'],
    build: ['#4e6b4a', '#33492f'],
    ground: ['#5b7a45', '#33482a'],
    accent: '#9fe870',
    night: false,
    foliage: '#2e4a2b',
  },
  {
    id: 'night',
    name: 'غارة ليلية',
    sky: ['#050b1c', '#0d1a33', '#1c2d4d'],
    sun: 'rgba(180,200,255,0.35)',
    haze: 'rgba(30,50,90,0.6)',
    mountain: ['#152238', '#0d1729'],
    build: ['#1b2740', '#101827'],
    ground: ['#1a2233', '#0b101a'],
    accent: '#ffcf5c',
    night: true,
  },
];

function rnd(seed: { v: number }) {
  seed.v = (seed.v * 1664525 + 1013904223) % 4294967296;
  return seed.v / 4294967296;
}

export function buildScene(theme: Theme, seedNum: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SCENE_W;
  c.height = SCENE_H;
  const g = c.getContext('2d')!;
  const seed = { v: seedNum >>> 0 || 12345 };
  const R = () => rnd(seed);

  // ---- sky
  const sky = g.createLinearGradient(0, 0, 0, HORIZON + 40);
  sky.addColorStop(0, theme.sky[0]);
  sky.addColorStop(0.6, theme.sky[1]);
  sky.addColorStop(1, theme.sky[2]);
  g.fillStyle = sky;
  g.fillRect(0, 0, SCENE_W, HORIZON + 40);

  // stars for night
  if (theme.night) {
    for (let i = 0; i < 260; i++) {
      const x = R() * SCENE_W;
      const y = R() * (HORIZON - 120);
      const a = 0.25 + R() * 0.7;
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fillRect(x, y, 1.6, 1.6);
    }
  }

  // sun / moon
  const sunX = SCENE_W * (0.22 + R() * 0.55);
  const sunY = HORIZON - 190 - R() * 90;
  const glow = g.createRadialGradient(sunX, sunY, 8, sunX, sunY, 340);
  glow.addColorStop(0, theme.sun);
  glow.addColorStop(0.25, theme.night ? 'rgba(160,190,255,0.15)' : 'rgba(255,235,180,0.35)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(sunX - 340, sunY - 340, 680, 680);
  g.beginPath();
  g.arc(sunX, sunY, theme.night ? 34 : 52, 0, Math.PI * 2);
  g.fillStyle = theme.night ? 'rgba(226,235,255,0.9)' : 'rgba(255,252,230,0.95)';
  g.fill();

  // clouds
  for (let i = 0; i < 22; i++) {
    const x = R() * SCENE_W;
    const y = 40 + R() * (HORIZON - 200);
    const w = 140 + R() * 320;
    const h = 22 + R() * 40;
    g.fillStyle = theme.night ? 'rgba(140,160,200,0.10)' : 'rgba(255,255,255,0.30)';
    g.beginPath();
    g.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    g.fill();
  }

  // ---- mountain layers
  for (let layer = 0; layer < 2; layer++) {
    const base = HORIZON - (layer === 0 ? 10 : 26);
    const amp = layer === 0 ? 90 : 150;
    g.beginPath();
    g.moveTo(0, base);
    let x = 0;
    let y = base - amp * 0.5;
    while (x < SCENE_W) {
      const nx = x + 90 + R() * 190;
      const ny = base - (0.25 + R() * 0.85) * amp;
      g.lineTo((x + nx) / 2, Math.min(y, ny) - R() * 25);
      g.lineTo(nx, ny);
      x = nx;
      y = ny;
    }
    g.lineTo(SCENE_W, base);
    g.lineTo(SCENE_W, HORIZON + 60);
    g.lineTo(0, HORIZON + 60);
    g.closePath();
    g.fillStyle = theme.mountain[layer];
    g.fill();
  }

  // ---- distant skyline / structures
  const struct = (x: number, w: number, h: number, shade: string, depthTint: number) => {
    g.fillStyle = shade;
    g.fillRect(x, HORIZON - h, w, h + 30);
    // windows / panels
    const cols = Math.max(1, Math.floor(w / 26));
    const rows = Math.max(1, Math.floor(h / 30));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (R() < 0.42) continue;
        const wx = x + 8 + i * 26;
        const wy = HORIZON - h + 12 + j * 30;
        if (wy > HORIZON - 8) continue;
        g.fillStyle = theme.night
          ? R() < 0.35
            ? 'rgba(255,205,120,0.85)'
            : 'rgba(20,30,50,0.9)'
          : `rgba(30,30,35,${0.18 + depthTint * 0.25})`;
        g.fillRect(wx, wy, 13, 17);
      }
    }
  };

  let bx = -60;
  while (bx < SCENE_W) {
    const w = 60 + R() * 140;
    const h = 60 + R() * 230;
    struct(bx, w, h, R() < 0.5 ? theme.build[0] : theme.build[1], R());
    // roof detail
    if (R() < 0.4) {
      g.fillStyle = theme.build[1];
      g.fillRect(bx + w * 0.3, HORIZON - h - 18, 12, 18);
    }
    // dome (desert)
    if (theme.id === 'desert' && R() < 0.18) {
      g.beginPath();
      g.arc(bx + w / 2, HORIZON - h, w * 0.36, Math.PI, 0);
      g.fillStyle = '#d9c69c';
      g.fill();
    }
    // cranes (harbor)
    if (theme.id === 'harbor' && R() < 0.3) {
      g.strokeStyle = '#c96a2a';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(bx + 10, HORIZON);
      g.lineTo(bx + 10, HORIZON - h - 110);
      g.lineTo(bx + 130, HORIZON - h - 70);
      g.stroke();
    }
    bx += w + 10 + R() * 60;
  }

  // jungle canopy silhouettes
  if (theme.foliage) {
    for (let i = 0; i < 60; i++) {
      const x = R() * SCENE_W;
      const h = 100 + R() * 220;
      g.fillStyle = theme.foliage;
      g.fillRect(x, HORIZON - h * 0.4, 8, h * 0.4);
      for (let l = 0; l < 5; l++) {
        g.beginPath();
        g.ellipse(x + 4, HORIZON - h * 0.4 - 10 + l * 6, 60 - l * 8, 16, (R() - 0.5) * 0.6, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // smoke plumes
  for (let i = 0; i < 6; i++) {
    const x = R() * SCENE_W;
    const top = 60 + R() * 160;
    for (let j = 0; j < 26; j++) {
      const t = j / 26;
      g.fillStyle = `rgba(${theme.night ? '60,60,70' : '80,74,68'},${0.16 * (1 - t)})`;
      g.beginPath();
      g.ellipse(x + Math.sin(j * 0.6) * 40 * t, HORIZON - t * (HORIZON - top), 18 + t * 70, 14 + t * 50, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ---- ground
  const grd = g.createLinearGradient(0, HORIZON, 0, SCENE_H);
  grd.addColorStop(0, theme.ground[0]);
  grd.addColorStop(1, theme.ground[1]);
  g.fillStyle = grd;
  g.fillRect(0, HORIZON, SCENE_W, SCENE_H - HORIZON);

  // water strip for harbor
  if (theme.water) {
    const wg = g.createLinearGradient(0, HORIZON, 0, HORIZON + 260);
    wg.addColorStop(0, '#4f93b8');
    wg.addColorStop(1, theme.water);
    g.fillStyle = wg;
    g.fillRect(0, HORIZON, SCENE_W, 260);
    for (let i = 0; i < 400; i++) {
      const y = HORIZON + R() * 250;
      g.fillStyle = `rgba(255,255,255,${0.05 + R() * 0.12})`;
      g.fillRect(R() * SCENE_W, y, 20 + R() * 60, 2);
    }
  }

  // ground haze band near horizon
  const hz = g.createLinearGradient(0, HORIZON - 60, 0, HORIZON + 120);
  hz.addColorStop(0, theme.haze);
  hz.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hz;
  g.fillRect(0, HORIZON - 60, SCENE_W, 180);

  // roads / terrain bands
  for (let i = 0; i < 5; i++) {
    const y = HORIZON + 60 + i * (100 + R() * 60);
    g.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.07})`;
    g.fillRect(0, y, SCENE_W, 26 + R() * 40);
  }

  // scattered props: crates, sandbags, wrecks, barrels
  const propColors = ['#7a6a4c', '#6b5f45', '#8b5a3c', '#5c6b52', '#4a4a4a'];
  for (let i = 0; i < 150; i++) {
    const depth = R();
    const y = HORIZON + 30 + Math.pow(depth, 1.5) * (SCENE_H - HORIZON - 90);
    const s = 0.35 + Math.pow(depth, 1.4) * 2.1;
    const x = R() * SCENE_W;
    const kind = R();
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.globalAlpha = 0.9;
    if (kind < 0.45) {
      g.fillStyle = propColors[Math.floor(R() * propColors.length)];
      g.fillRect(-16, -22, 32, 22);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(-16, -22, 32, 5);
    } else if (kind < 0.7) {
      g.fillStyle = '#6f6448';
      for (let b = 0; b < 3; b++) {
        g.beginPath();
        g.ellipse(-10 + b * 10, -8 - (b % 2) * 8, 9, 6, 0, 0, Math.PI * 2);
        g.fill();
      }
    } else if (kind < 0.85) {
      g.fillStyle = theme.id === 'jungle' ? '#2f4a2c' : '#6d6a5f';
      g.fillRect(-26, -18, 52, 18);
      g.fillStyle = '#3a3833';
      g.beginPath();
      g.arc(-14, 0, 6, 0, Math.PI * 2);
      g.arc(14, 0, 6, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = theme.id === 'jungle' ? '#3d5f37' : '#5f5540';
      g.beginPath();
      g.moveTo(0, -36);
      g.lineTo(14, 0);
      g.lineTo(-14, 0);
      g.closePath();
      g.fill();
    }
    // shadow
    g.globalAlpha = 0.2;
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(0, 2, 22, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // vignette-ish darkening at ground bottom
  const bot = g.createLinearGradient(0, SCENE_H - 260, 0, SCENE_H);
  bot.addColorStop(0, 'rgba(0,0,0,0)');
  bot.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = bot;
  g.fillRect(0, SCENE_H - 260, SCENE_W, 260);

  if (theme.night) {
    g.fillStyle = 'rgba(10,18,38,0.35)';
    g.fillRect(0, 0, SCENE_W, SCENE_H);
  }

  return c;
}
