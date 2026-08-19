import { useCallback, useEffect, useRef, useState } from 'react';
import { Game, type Hud, type Phase } from './game/engine';
import { sfx } from './game/audio';

const SCORE_KEY = 'war_sniper_scores_v1';

interface ScoreRow {
  score: number;
  wave: number;
  date: string;
}

function loadScores(): ScoreRow[] {
  try {
    const raw = localStorage.getItem(SCORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ScoreRow[];
    return Array.isArray(arr) ? arr.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveScore(row: ScoreRow): ScoreRow[] {
  const list = [...loadScores(), row].sort((a, b) => b.score - a.score).slice(0, 8);
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

const emptyHud: Hud = {
  score: 0,
  combo: 1,
  wave: 1,
  health: 100,
  ammo: 7,
  mag: 7,
  reloading: 0,
  cover: 100,
  inCover: false,
  scoped: false,
  zoom: 2.6,
  remaining: 0,
  themeName: '',
  banner: '',
  accuracy: 100,
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [phase, setPhase] = useState<Phase>('menu');
  const [hud, setHud] = useState<Hud>(emptyHud);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [lastRun, setLastRun] = useState<{ score: number; wave: number; best: boolean }>({ score: 0, wave: 1, best: false });
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setScores(loadScores());
    if (!canvasRef.current) return;
    const g = new Game(canvasRef.current);
    gameRef.current = g;
    g.onHud = (h) => setHud(h);
    g.onPhase = (p) => setPhase(p);
    g.onGameOver = (score, wave) => {
      const list = saveScore({ score, wave, date: new Date().toLocaleDateString('ar-EG') });
      setScores(list);
      setLastRun({ score, wave, best: list.length > 0 && list[0].score === score });
    };
    const ro = new ResizeObserver(() => g.resize());
    ro.observe(canvasRef.current);
    return () => {
      ro.disconnect();
      g.destroy();
    };
  }, []);

  const start = useCallback(() => {
    sfx.resume();
    sfx.ui();
    gameRef.current?.start();
  }, []);

  const hold = (fn: (down: boolean) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      fn(true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      fn(false);
    },
    onPointerLeave: () => fn(false),
    onPointerCancel: () => fn(false),
  });

  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    },
  });

  const healthColor = hud.health > 60 ? 'from-emerald-400 to-lime-300' : hud.health > 30 ? 'from-amber-400 to-yellow-300' : 'from-rose-500 to-red-400';

  return (
    <div dir="rtl" className="fixed inset-0 select-none overflow-hidden bg-black font-[system-ui] text-white touch-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

      {/* ================= HUD ================= */}
      {(phase === 'playing' || phase === 'paused') && (
        <div className="pointer-events-none absolute inset-0 z-10">
          {/* top bar */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 sm:p-3">
            <div className="flex items-center gap-2">
              <button
                {...tap(() => gameRef.current?.togglePause())}
                className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-md border border-amber-400/40 bg-black/55 text-amber-300 backdrop-blur active:scale-95"
              >
                <span className="text-lg leading-none">❚❚</span>
              </button>
              <div className="rounded-md border border-white/10 bg-black/55 px-3 py-1.5 backdrop-blur">
                <div className="text-[10px] font-bold tracking-widest text-amber-300/80">النقاط</div>
                <div className="font-mono text-xl font-black leading-none tabular-nums">{hud.score.toLocaleString('en-US')}</div>
              </div>
              {hud.combo > 1 && (
                <div className="animate-pulse rounded-md border border-orange-400/60 bg-orange-500/20 px-2.5 py-1.5 text-orange-200 backdrop-blur">
                  <div className="text-[10px] font-bold tracking-widest">تتابع</div>
                  <div className="font-mono text-lg font-black leading-none">×{hud.combo}</div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="rounded-md border border-white/10 bg-black/55 px-3 py-1.5 text-center backdrop-blur">
                <div className="text-[10px] font-bold tracking-widest text-emerald-300/80">أهداف</div>
                <div className="font-mono text-lg font-black leading-none">{hud.remaining}</div>
              </div>
              <div className="rounded-md border border-white/10 bg-black/55 px-3 py-1.5 text-center backdrop-blur">
                <div className="text-[10px] font-bold tracking-widest text-sky-300/80">الموجة</div>
                <div className="font-mono text-lg font-black leading-none">{hud.wave}</div>
              </div>
              <button
                {...tap(() => {
                  const m = !muted;
                  setMuted(m);
                  sfx.setMuted(m);
                })}
                className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-black/55 text-base backdrop-blur active:scale-95"
              >
                {muted ? '🔇' : '🔊'}
              </button>
            </div>
          </div>

          {/* health + cover */}
          <div className="absolute bottom-3 right-3 w-40 sm:w-56">
            <div className="mb-1 flex items-center justify-between text-[10px] font-bold tracking-widest text-white/70">
              <span>الدرع {hud.cover}%</span>
              <span>الصحة {hud.health}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-sm border border-white/20 bg-black/60">
              <div className={`h-full bg-gradient-to-l ${healthColor} transition-[width] duration-200`} style={{ width: `${hud.health}%` }} />
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm border border-white/10 bg-black/60">
              <div className="h-full bg-sky-400/80 transition-[width] duration-150" style={{ width: `${hud.cover}%` }} />
            </div>
          </div>

          {/* ammo */}
          <div className="absolute bottom-3 left-3 text-left">
            <div className="mb-1 flex flex-row-reverse gap-1">
              {Array.from({ length: hud.mag }).map((_, i) => (
                <div
                  key={i}
                  className={`h-5 w-1.5 rounded-sm transition-all ${i < hud.ammo ? 'bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.8)]' : 'bg-white/15'}`}
                />
              ))}
            </div>
            <div className="font-mono text-xs font-bold tracking-widest text-white/70">
              {hud.reloading > 0 ? 'إعادة تلقيم…' : `${hud.ammo} / ${hud.mag}`}
            </div>
            {hud.reloading > 0 && (
              <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-sm bg-black/70">
                <div className="h-full bg-amber-400" style={{ width: `${hud.reloading * 100}%` }} />
              </div>
            )}
          </div>

          {/* touch / action controls */}
          <div className="absolute bottom-16 left-2 flex flex-col items-center gap-2 sm:bottom-20 sm:left-4">
            <button
              {...hold((d) => gameRef.current?.setCover(d))}
              className={`pointer-events-auto h-14 w-14 rounded-full border text-[11px] font-black backdrop-blur active:scale-95 ${
                hud.inCover ? 'border-sky-300 bg-sky-500/40 text-white' : 'border-white/25 bg-black/50 text-sky-200'
              }`}
            >
              احتماء
            </button>
            <button
              {...tap(() => gameRef.current?.reload())}
              className="pointer-events-auto h-12 w-12 rounded-full border border-white/25 bg-black/50 text-[11px] font-black text-amber-200 backdrop-blur active:scale-95"
            >
              تلقيم
            </button>
          </div>

          <div className="absolute bottom-16 right-2 flex flex-col items-center gap-2 sm:bottom-20 sm:right-4">
            <button
              {...tap(() => gameRef.current?.toggleScope())}
              className={`pointer-events-auto h-14 w-14 rounded-full border text-[11px] font-black backdrop-blur active:scale-95 ${
                hud.scoped ? 'border-emerald-300 bg-emerald-500/40 text-white' : 'border-white/25 bg-black/50 text-emerald-200'
              }`}
            >
              {hud.scoped ? `${hud.zoom.toFixed(1)}x` : 'منظار'}
            </button>
            <button
              {...tap(() => gameRef.current?.fire())}
              className="pointer-events-auto h-20 w-20 rounded-full border-2 border-rose-400/70 bg-gradient-to-b from-rose-600/70 to-rose-800/70 text-sm font-black text-white shadow-[0_0_24px_rgba(244,63,94,0.35)] backdrop-blur active:scale-90"
            >
              إطلاق
            </button>
          </div>
        </div>
      )}

      {/* ================= MENU ================= */}
      {phase === 'menu' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-b from-black/80 via-black/55 to-black/90 p-4">
          <div className="w-full max-w-md text-center">
            <div className="mb-1 text-xs font-black tracking-[0.5em] text-amber-400">OPERATION</div>
            <h1 className="text-5xl font-black leading-none tracking-tight text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.9)] sm:text-6xl">
              WAR<span className="text-amber-400">SNIPER</span>
            </h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/75">
              قنّاص، دبابات، وطائرات مُسيّرة. صوّب بدقة، اقضِ على الأهداف قبل أن يطلقوا النار، واحتمِ عند الخطر.
            </p>

            <button
              onClick={start}
              className="mt-6 w-full rounded-lg border-2 border-amber-300/70 bg-gradient-to-b from-amber-400 to-amber-600 py-4 text-xl font-black text-black shadow-[0_8px_30px_rgba(251,191,36,0.35)] transition active:scale-95"
            >
              ابدأ المهمة ▸
            </button>

            <div className="mt-5 grid grid-cols-2 gap-2 text-right text-[11px] text-white/70">
              <div className="rounded-md border border-white/10 bg-black/50 p-2">
                <div className="mb-1 font-black text-amber-300">الكمبيوتر</div>
                <div>الماوس: التصويب • زر أيسر: إطلاق</div>
                <div>زر أيمن / Shift: منظار</div>
                <div>R: تلقيم • C: احتماء • P: إيقاف</div>
              </div>
              <div className="rounded-md border border-white/10 bg-black/50 p-2">
                <div className="mb-1 font-black text-amber-300">الجوال</div>
                <div>اسحب على الشاشة للتصويب</div>
                <div>زر «إطلاق» للرماية</div>
                <div>«منظار» للتكبير • «احتماء» للتحصّن</div>
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-white/10 bg-black/60 p-3 text-right">
              <div className="mb-2 text-xs font-black tracking-widest text-amber-300">أفضل النتائج</div>
              {scores.length === 0 ? (
                <div className="py-2 text-center text-xs text-white/40">لا توجد نتائج بعد — كن الأول!</div>
              ) : (
                <ol className="space-y-1">
                  {scores.slice(0, 5).map((s, i) => (
                    <li key={i} className="flex items-center justify-between rounded bg-white/5 px-2 py-1 text-xs">
                      <span className="font-mono font-black tabular-nums text-amber-200">
                        {i + 1}. {s.score.toLocaleString('en-US')}
                      </span>
                      <span className="text-white/50">الموجة {s.wave} • {s.date}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= PAUSE ================= */}
      {phase === 'paused' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xs text-center">
            <h2 className="text-3xl font-black tracking-widest text-amber-300">إيقاف مؤقت</h2>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <Stat label="النقاط" value={hud.score.toLocaleString('en-US')} />
              <Stat label="الموجة" value={String(hud.wave)} />
              <Stat label="الدقة" value={`${hud.accuracy}%`} />
            </div>
            <button
              onClick={() => gameRef.current?.resumeGame()}
              className="mt-5 w-full rounded-lg border-2 border-emerald-300/70 bg-gradient-to-b from-emerald-400 to-emerald-600 py-3 text-lg font-black text-black active:scale-95"
            >
              متابعة
            </button>
            <button
              onClick={start}
              className="mt-2 w-full rounded-lg border border-white/25 bg-black/60 py-3 text-sm font-black text-white/85 active:scale-95"
            >
              إعادة المهمة
            </button>
          </div>
        </div>
      )}

      {/* ================= GAME OVER ================= */}
      {phase === 'over' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-b from-red-950/80 via-black/85 to-black/90 p-4">
          <div className="w-full max-w-sm text-center">
            <div className="text-xs font-black tracking-[0.4em] text-rose-400">MISSION FAILED</div>
            <h2 className="mt-1 text-4xl font-black tracking-tight text-white">سقط القنّاص</h2>
            {lastRun.best && (
              <div className="mx-auto mt-2 inline-block rounded-full border border-amber-300/60 bg-amber-400/20 px-3 py-1 text-xs font-black text-amber-200">
                ★ رقم قياسي جديد
              </div>
            )}
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <Stat label="النقاط" value={lastRun.score.toLocaleString('en-US')} />
              <Stat label="الموجة" value={String(lastRun.wave)} />
              <Stat label="الدقة" value={`${hud.accuracy}%`} />
            </div>

            <button
              onClick={start}
              className="mt-5 w-full rounded-lg border-2 border-amber-300/70 bg-gradient-to-b from-amber-400 to-amber-600 py-4 text-xl font-black text-black shadow-[0_8px_30px_rgba(251,191,36,0.35)] active:scale-95"
            >
              إعادة المحاولة فورًا ⟲
            </button>
            <button
              onClick={() => {
                sfx.ui();
                gameRef.current?.setPhase('menu');
              }}
              className="mt-2 w-full rounded-lg border border-white/25 bg-black/60 py-2.5 text-sm font-black text-white/80 active:scale-95"
            >
              القائمة الرئيسية
            </button>

            <div className="mt-4 rounded-lg border border-white/10 bg-black/60 p-3 text-right">
              <div className="mb-2 text-xs font-black tracking-widest text-amber-300">لوحة الشرف</div>
              <ol className="space-y-1">
                {scores.slice(0, 5).map((s, i) => (
                  <li
                    key={i}
                    className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                      s.score === lastRun.score ? 'bg-amber-400/20 text-amber-100' : 'bg-white/5'
                    }`}
                  >
                    <span className="font-mono font-black tabular-nums">
                      {i + 1}. {s.score.toLocaleString('en-US')}
                    </span>
                    <span className="text-white/50">الموجة {s.wave}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/60 px-2 py-2">
      <div className="text-[10px] font-bold tracking-widest text-white/50">{label}</div>
      <div className="font-mono text-lg font-black leading-none">{value}</div>
    </div>
  );
}
