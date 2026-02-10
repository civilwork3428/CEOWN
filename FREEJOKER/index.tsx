
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// --- 遊戲常數 ---
const BALL_TYPES = ['🔴', '🟡', '🔵', '🟢', '⚪'];
const MISSION_TYPES = ['🔴', '🟡', '🔵', '🟢', '⚪']; 
const JOKER = '🤡';
const COLS = 6;
const ROWS = 7;
const SWAP_DURATION = 250;
const MAX_CHARGE = 5;
const STAMPEDE_THRESHOLD = 21; 

const SEVEN_TREASURES = ['#FFD700', '#F5F5F5', '#0000FF', '#E0FFFF', '#008000', '#FF6B6B', '#FFBF00'];
const PERFORMANCE_COLORS = ['#ff5e7d', '#fbbf24', '#3b82f6', '#22c55e', '#f8fafc', '#a855f7', '#f97316'];

type GameState = 'IDLE' | 'SWAPPING' | 'MATCHING' | 'FALLING' | 'BOMBING' | 'SPARKLING' | 'GRAFFITI' | 'STAMPEDE' | 'SETTLEMENT';

interface Pos { r: number; c: number; }

class Particle {
  x: number; y: number; vx: number; vy: number;
  color: string; life: number; size: number;
  alpha: number; gravity: number; drag: number;
  spin?: number;
  constructor(x: number, y: number, color: string, isFirework: boolean, isTreasure: boolean = false) {
    this.x = x; this.y = y;
    const angle = Math.random() * Math.PI * 2;
    const speed = isTreasure ? (5 + Math.random() * 7) : (isFirework ? (6 + Math.random() * 10) : (1 + Math.random() * 3));
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.color = color;
    this.life = isFirework ? (1.5 + Math.random()) : 0.8;
    this.alpha = 1;
    this.size = isTreasure ? (3 + Math.random() * 5) : (isFirework ? (2 + Math.random() * 4) : (1 + Math.random() * 2));
    this.gravity = isFirework ? 0.08 : 0.05;
    this.drag = 0.97;
    if (isTreasure) this.spin = Math.random() * 0.4;
  }
  update() {
    this.vx *= this.drag;
    this.vy *= this.drag;
    this.vy += this.gravity;
    this.x += this.vx;
    this.y += this.vy;
    this.life -= 0.008;
    this.alpha = Math.max(0, this.life);
  }
}

interface BouncingJoker {
  id: number; x: number; y: number; vx: number; vy: number;
  size: number; rotation: number; rv: number; emoji: string;
}

interface JokerShow { r: number; c: number; scale: number; phase: 'GROW' | 'WAIT' | 'FIRE'; }

const BallGame: React.FC = () => {
  const [grid, setGrid] = useState<(string | null)[][]>([]);
  const [selected, setSelected] = useState<Pos | null>(null);
  const [gameState, setGameState] = useState<GameState>('IDLE');
  const [score, setScore] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [targetColor, setTargetColor] = useState<string>(MISSION_TYPES[0]);
  const [charge, setCharge] = useState(0);
  const [bouncingJokers, setBouncingJokers] = useState<BouncingJoker[]>([]);
  const [isSurrender, setIsSurrender] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [jokerShows, setJokerShows] = useState<Record<string, JokerShow>>({});
  const [isShaking, setIsShaking] = useState(false);
  const [showSkillHint, setShowSkillHint] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const jokerCount = grid.flat().filter(cell => cell === JOKER).length;

  const getSkillInfo = () => {
    switch (gameState) {
      case 'BOMBING': return { emoji: '🧨', text: '5x5 大爆炸', color: 'text-pink-500', bg: 'border-pink-500' };
      case 'SPARKLING': return { emoji: '💎', text: '七寶大掃除', color: 'text-cyan-400', bg: 'border-cyan-400' };
      case 'GRAFFITI': return { emoji: '🎨', text: '目標染色術', color: 'text-yellow-400', bg: 'border-yellow-400' };
      default: return null;
    }
  };

  const getTotem = () => {
    switch (gameState) {
      case 'BOMBING': return '🧨';
      case 'SPARKLING': return '💎';
      case 'GRAFFITI': return '🎨';
      default: return null;
    }
  };

  const playPop = (freq = 400, type: 'sine' | 'square' = 'sine', duration = 0.2, volume = 0.1) => {
    if (isMuted) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.1, ctx.currentTime + duration);
      g.gain.setValueAtTime(volume, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  };

  const shakeScreen = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 200);
  };

  // 監聽技能狀態，觸發橫幅
  useEffect(() => {
    if (['BOMBING', 'SPARKLING', 'GRAFFITI'].includes(gameState)) {
      setShowSkillHint(true);
      playPop(880, 'sine', 0.4, 0.2); // 技能準備好的提示音
    } else {
      setShowSkillHint(false);
    }
  }, [gameState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update();
        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        if (p.spin !== undefined) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.life * 8);
          ctx.rect(-p.size/2, -p.size/2, p.size, p.size);
          ctx.restore();
        } else {
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      animationId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animationId);
  }, []);

  const triggerExplosion = (r: number, c: number, color: string, isFirework = false, isTreasure = false) => {
    const colorMap: Record<string, string> = {
      '🔴': '#ff5e7d', '🟡': '#fbbf24', '🔵': '#3b82f6', '🟢': '#22c55e', '⚪': '#f8fafc',
      [JOKER]: '#ef4444'
    };
    const pColor = isTreasure ? SEVEN_TREASURES[Math.floor(Math.random() * SEVEN_TREASURES.length)] : (isFirework ? PERFORMANCE_COLORS[Math.floor(Math.random() * PERFORMANCE_COLORS.length)] : (colorMap[color] || '#ffffff'));
    
    const x = c * 51 + 25;
    const y = r * 51 + 25;
    const count = isTreasure ? 40 : (isFirework ? 70 : 15);
    
    for (let i = 0; i < count; i++) {
      particlesRef.current.push(new Particle(x, y, pColor, isFirework || isTreasure, isTreasure));
    }
  };

  const performJokerFerrisWheel = async (r: number, c: number) => {
    const id = `${r}-${c}`;
    setJokerShows(prev => ({ ...prev, [id]: { r, c, scale: 1.0, phase: 'GROW' } }));
    playPop(300, 'sine', 0.3, 0.2);
    
    for (let s = 1.0; s <= 2.2; s += 0.3) {
      setJokerShows(prev => prev[id] ? ({ ...prev, [id]: { ...prev[id], scale: s } }) : prev);
      await new Promise(res => setTimeout(res, 50));
    }

    setJokerShows(prev => prev[id] ? ({ ...prev, [id]: { ...prev[id], phase: 'WAIT', scale: 2.2 } }) : prev);
    const waitStartTime = Date.now();
    while (Date.now() - waitStartTime < 1000) {
      triggerExplosion(r, c, JOKER, false, true);
      await new Promise(res => setTimeout(res, 250));
    }

    setJokerShows(prev => { const next = {...prev}; delete next[id]; return next; });

    const directions = [[-1,0], [1,0], [0,-1], [0,1], [-1,-1], [1,1], [-1,1], [1,-1]];
    const dir = directions[Math.floor(Math.random() * directions.length)];
    playPop(1000, 'square', 0.7, 0.4);

    for (let i = 1; i <= 5; i++) {
      const nr = r + dir[0] * i;
      const nc = c + dir[1] * i;
      triggerExplosion(nr, nc, JOKER, true, true);
      playPop(500 + i * 100, 'square', 0.1, 0.1);
      await new Promise(res => setTimeout(res, 70));
    }
  };

  const spawnBouncingBead = (r: number, c: number, idOffset: number = 0) => {
    const x = c * 51 + 25;
    const y = r * 51 + 25;
    const newBead: BouncingJoker = {
      id: Date.now() + Math.random() + idOffset,
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 80, 
      vy: (Math.random() - 0.5) * 80,
      size: 50 + Math.random() * 40,
      rotation: Math.random() * 360,
      rv: (Math.random() - 0.5) * 45,
      emoji: JOKER
    };
    setBouncingJokers(prev => [...prev, newBead]);
  };

  const startFireworksFinale = async () => {
    setGameState('STAMPEDE');
    setIsSurrender(true);
    playPop(400, 'sine', 1, 0.5);

    let currentGrid = grid.map(row => [...row]);

    for (let i = 0; i < 9; i++) {
      const r = Math.floor(Math.random() * ROWS);
      const c = Math.floor(Math.random() * COLS);
      
      triggerExplosion(r, c, JOKER, true, true);
      shakeScreen();
      playPop(900 + Math.random() * 300, 'square', 0.5, 0.3);

      let hitAny = false;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && currentGrid[nr][nc] === JOKER) {
            currentGrid[nr][nc] = null;
            spawnBouncingBead(nr, nc, i * 10 + dr * 5 + dc);
            hitAny = true;
          }
        }
      }
      if (hitAny) {
        setGrid([...currentGrid]);
        playPop(1400, 'square', 0.15, 0.5); 
      }
      
      await new Promise(res => setTimeout(res, 200));
    }
  };

  useEffect(() => {
    if (gameState !== 'STAMPEDE') return;
    const timer = setInterval(() => {
      setBouncingJokers(prev => prev.map(j => {
        let nx = j.x + j.vx;
        let ny = j.y + j.vy;
        let nvx = j.vx;
        let nvy = j.vy;
        let hit = false;
        if (nx < 0 || nx > window.innerWidth - j.size) { nvx *= -0.98; nx = Math.max(0, Math.min(nx, window.innerWidth - j.size)); hit = true; }
        if (ny < 0 || ny > window.innerHeight - j.size) { nvy *= -0.98; ny = Math.max(0, Math.min(ny, window.innerHeight - j.size)); hit = true; }
        if (hit) playPop(400 + Math.random() * 800, 'sine', 0.1, 0.04);
        return { ...j, x: nx, y: ny, vx: nvx, vy: nvy, rotation: j.rotation + j.rv };
      }));
    }, 16);
    return () => clearInterval(timer);
  }, [gameState]);

  const initGrid = useCallback(() => {
    let newGrid: string[][] = [];
    do {
      newGrid = Array(ROWS).fill(null).map(() => 
        Array(COLS).fill(null).map(() => BALL_TYPES[Math.floor(Math.random() * BALL_TYPES.length)])
      );
    } while (findMatchLines(newGrid).length > 0);
    setGrid(newGrid);
    setScore(0);
    setCharge(0);
    setGameState('IDLE');
    setIsSurrender(false);
    setTargetColor(MISSION_TYPES[Math.floor(Math.random() * MISSION_TYPES.length)]);
    particlesRef.current = [];
    setJokerShows({});
    setBouncingJokers([]);
  }, []);

  useEffect(() => { initGrid(); }, [initGrid]);

  function findMatchLines(g: (string | null)[][]) {
    const lines: Pos[][] = [];
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    const usedInDir = new Set<string>();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = g[r][c];
        if (!color || color === JOKER) continue;
        for (let d = 0; d < dirs.length; d++) {
          const key = `${r},${c},${d}`;
          if (usedInDir.has(key)) continue;
          const [dr, dc] = dirs[d];
          let count = 1;
          const currentLine: Pos[] = [{ r, c }];
          let nr = r + dr, nc = c + dc;
          while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && g[nr][nc] === color) {
            currentLine.push({ r: nr, c: nc });
            usedInDir.add(`${nr},${nc},${d}`);
            count++;
            nr += dr; nc += dc;
          }
          if (count >= 3) lines.push(currentLine);
        }
      }
    }
    return lines;
  }

  const spawnJokers = async (currentGrid: (string | null)[][], count: number) => {
    const nextGrid = currentGrid.map(row => [...row]);
    let spawned = 0;
    const candidates: Pos[] = [];
    nextGrid.forEach((row, ri) => row.forEach((cell, ci) => {
      if (cell && cell !== JOKER) candidates.push({ r: ri, c: ci });
    }));
    while (spawned < count && candidates.length > 0) {
      const idx = Math.floor(Math.random() * candidates.length);
      const pos = candidates.splice(idx, 1)[0];
      nextGrid[pos.r][pos.c] = JOKER;
      performJokerFerrisWheel(pos.r, pos.c);
      spawned++;
    }
    if (nextGrid.flat().filter(c => c === JOKER).length >= STAMPEDE_THRESHOLD) {
      setTimeout(() => { if (gameState !== 'STAMPEDE') startFireworksFinale(); }, 1200);
    }
    return nextGrid;
  };

  const processMatches = useCallback(async (currentGrid: (string | null)[][], triggeredMode: 'BOMBING' | 'SPARKLING' | 'GRAFFITI' | null = null, wasTargetMatched: boolean = false, currentChainCharge: number = 0) => {
    setGameState('MATCHING');
    const matchLines = findMatchLines(currentGrid);
    
    if (matchLines.length === 0) {
      setCharge(prev => {
        const nextCharge = prev + currentChainCharge;
        if (nextCharge >= MAX_CHARGE && !triggeredMode) {
          setGameState('GRAFFITI');
          return 0;
        }
        setGameState(triggeredMode || 'IDLE');
        return Math.min(nextCharge, MAX_CHARGE);
      });
      return;
    }

    const nextGrid = currentGrid.map(row => [...row]);
    let turnScore = 0;
    let nextMode = triggeredMode;
    let targetInThisChain = wasTargetMatched;
    const matchedPos = new Set<string>();

    matchLines.forEach(line => {
      const color = currentGrid[line[0].r][line[0].c];
      if (color === targetColor) targetInThisChain = true;
      line.forEach(p => matchedPos.add(`${p.r},${p.c}`));
      if (line.length >= 5) { turnScore += 1000; nextMode = 'SPARKLING'; }
      else if (line.length === 4) { turnScore += 300; if (nextMode !== 'SPARKLING') nextMode = 'BOMBING'; }
      else turnScore += 100;
    });

    matchedPos.forEach(s => {
      const [r, c] = s.split(',').map(Number);
      triggerExplosion(r, c, nextGrid[r][c]!, false);
      nextGrid[r][c] = null;
    });

    setScore(s => s + turnScore);
    setGrid(nextGrid);
    playPop(nextMode === 'SPARKLING' ? 800 : 400, 'square');
    await new Promise(r => setTimeout(r, 400));

    setGameState('FALLING');
    const fallenGrid = nextGrid.map(row => [...row]);
    for (let c = 0; c < COLS; c++) {
      let emptyRow = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (fallenGrid[r][c] !== null) {
          const val = fallenGrid[r][c];
          fallenGrid[r][c] = null;
          fallenGrid[emptyRow][c] = val;
          emptyRow--;
        }
      }
      for (let r = emptyRow; r >= 0; r--) {
        fallenGrid[r][c] = BALL_TYPES[Math.floor(Math.random() * BALL_TYPES.length)];
      }
    }
    setGrid(fallenGrid);
    await new Promise(r => setTimeout(r, 400));

    if (findMatchLines(fallenGrid).length === 0 && targetInThisChain) {
      setTargetColor(MISSION_TYPES[Math.floor(Math.random() * MISSION_TYPES.length)]);
    }
    processMatches(fallenGrid, nextMode, targetInThisChain, currentChainCharge + matchLines.length);
  }, [targetColor, charge]);

  const handleCellClick = async (r: number, c: number) => {
    if (!['IDLE', 'BOMBING', 'SPARKLING', 'GRAFFITI'].includes(gameState)) return;

    if (gameState === 'BOMBING') {
      const nextGrid = grid.map(row => [...row]);
      let hits = 0;
      shakeScreen();
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && nextGrid[nr][nc]) {
            triggerExplosion(nr, nc, nextGrid[nr][nc]!, true, true);
            if (nextGrid[nr][nc] === JOKER) {
              spawnBouncingBead(nr, nc); 
            }
            nextGrid[nr][nc] = null;
            hits++;
          }
        }
      }
      if (!hits) return;
      playPop(1100, 'square', 0.6, 0.4);
      setGrid(nextGrid);
      setScore(s => s + 800);
      await new Promise(res => setTimeout(res, 300));
      processMatches(nextGrid);
      return;
    }

    if (gameState === 'SPARKLING') {
      const color = grid[r][c];
      if (!color) return;
      shakeScreen();
      const nextGrid = grid.map(row => row.map(cell => (cell === color || cell === JOKER) ? null : cell));
      grid.forEach((row, ri) => row.forEach((cell, ci) => {
        if (cell === color || cell === JOKER) {
          setTimeout(() => { performJokerFerrisWheel(ri, ci); }, Math.random() * 300);
        }
      }));
      playPop(1200, 'square', 0.8, 0.5);
      setGrid(nextGrid);
      setScore(s => s + 2000);
      await new Promise(res => setTimeout(res, 2000));
      processMatches(nextGrid);
      return;
    }

    if (gameState === 'GRAFFITI') {
      if (grid[r][c] === JOKER) return;
      const nextGrid = grid.map(row => [...row]);
      nextGrid[r][c] = targetColor;
      triggerExplosion(r, c, targetColor);
      setGrid(nextGrid);
      await new Promise(res => setTimeout(res, 200));
      processMatches(nextGrid);
      return;
    }

    if (grid[r][c] === JOKER) { playPop(100, 'square'); return; }
    if (!selected) { setSelected({ r, c }); playPop(300); return; }
    
    const dr = Math.abs(selected.r - r), dc = Math.abs(selected.c - c);
    if ((dr <= 1 && dc <= 1) && !(dr === 0 && dc === 0)) {
      setGameState('SWAPPING');
      const nextGrid = grid.map(row => [...row]);
      [nextGrid[r][c], nextGrid[selected.r][selected.c]] = [nextGrid[selected.r][selected.c], nextGrid[r][c]];
      setGrid(nextGrid);
      setSelected(null);
      await new Promise(res => setTimeout(res, SWAP_DURATION));
      
      const matchLines = findMatchLines(nextGrid);
      if (matchLines.length > 0) {
        const hasTarget = matchLines.some(l => nextGrid[l[0].r][l[0].c] === targetColor);
        if (!hasTarget) {
          const withJokerGrid = await spawnJokers(nextGrid, 1);
          setGrid(withJokerGrid);
          processMatches(withJokerGrid);
        } else {
          processMatches(nextGrid);
        }
      } else {
        const resetGrid = grid.map(row => [...row]);
        [resetGrid[r][c], resetGrid[selected.r][selected.c]] = [resetGrid[selected.r][selected.c], resetGrid[r][c]];
        const withJokerGrid = await spawnJokers(resetGrid, 2);
        setGrid(withJokerGrid);
        setGameState('IDLE');
        playPop(150, 'square');
      }
    } else { setSelected({ r, c }); playPop(300); }
  };

  const getDynamicBg = () => {
    if (gameState === 'STAMPEDE') return 'bg-indigo-900';
    const ratio = jokerCount / STAMPEDE_THRESHOLD;
    if (ratio > 0.8) return 'bg-[#4c0519]'; 
    if (ratio > 0.5) return 'bg-[#1e1b4b]'; 
    return 'bg-neutral-950'; 
  };

  const skill = getSkillInfo();

  return (
    <div className={`min-h-screen transition-colors duration-1000 flex flex-col items-center justify-center p-4 font-sans select-none overflow-hidden
      ${getDynamicBg()} ${isShaking ? 'shake-anim' : ''}
    `}>
      
      {/* 技能全螢幕呼吸邊框 */}
      {showSkillHint && skill && (
        <div className={`fixed inset-0 z-50 pointer-events-none border-[12px] animate-border-pulse ${skill.bg.replace('border-', 'border-opacity-30 border-')}`} />
      )}

      <canvas ref={canvasRef} width={320} height={400} className="fixed pointer-events-none z-[60] w-[320px] h-[400px]" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -45%)' }} />

      {/* 技能發動大提示 */}
      {showSkillHint && skill && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-[280px] animate-skill-hint">
          <div className={`bg-neutral-900/90 backdrop-blur-md border-y-4 ${skill.bg} py-4 px-6 flex items-center justify-center gap-4 shadow-[0_0_30px_rgba(0,0,0,0.5)]`}>
             <span className="text-4xl animate-bounce">{skill.emoji}</span>
             <div className="flex flex-col">
               <span className="text-white font-black text-xl italic leading-none">技能發動！</span>
               <span className={`${skill.color} font-bold text-sm uppercase tracking-tighter`}>{skill.text}</span>
             </div>
             <span className="text-4xl animate-bounce" style={{animationDelay:'0.1s'}}>{skill.emoji}</span>
          </div>
          <div className="text-center mt-2">
            <span className="text-[10px] text-white font-black bg-purple-600 px-3 py-1 rounded-full animate-pulse shadow-lg">請點擊棋盤釋放魔法 ➔</span>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="fixed inset-0 z-[300] bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm" onClick={() => setShowHelp(false)}>
          <div className="bg-neutral-900 border-2 border-purple-500 p-8 rounded-[40px] max-w-sm w-full text-white shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-2xl font-black italic text-purple-400">嘉年華魔法指南 🎪</h3>
            <p className="text-xs text-neutral-400 leading-relaxed italic border-l-4 border-purple-500 pl-3">當螢幕發光並出現技能橫幅時，代表魔法能量已充滿，請點擊棋盤啟動！</p>
            <ul className="text-sm space-y-2 text-neutral-300 font-bold">
              <li>🧨 <span className="text-pink-400 font-black">5x5 爆裂：</span> 消除 4 顆球獲得，超廣範圍清空。</li>
              <li>💎 <span className="text-cyan-400 font-black">七寶掃除：</span> 消除 5 顆球獲得，清除所有同色球與小丑。</li>
              <li>🎨 <span className="text-yellow-400 font-black">目標染色：</span> 任務量表充滿時獲得，將目標染成指定色。</li>
              <li>💡 <span className="text-white italic">提示：</span> 出現橫幅時，請專心點擊你想爆破的位置！</li>
            </ul>
            <button onClick={() => setShowHelp(false)} className="w-full py-3 bg-purple-600 rounded-full font-black text-white hover:bg-purple-500 transition-colors">我知道了 ➔</button>
          </div>
        </div>
      )}

      {gameState === 'STAMPEDE' && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center pointer-events-none">
          {bouncingJokers.map(j => (
            <div key={j.id} style={{ left: j.x, top: j.y, width: j.size, height: j.size, transform: `rotate(${j.rotation}deg)` }} 
              className="absolute bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-4xl shadow-xl border border-white/20"
            >
              <span className="drop-shadow-lg">{j.emoji}</span>
            </div>
          ))}
          <div className="relative z-[110] flex flex-col items-center pointer-events-auto gap-12">
            <div className={`text-white font-black text-4xl italic tracking-tighter p-10 animate-bounce shadow-2xl text-center rounded-3xl border-8 border-white bg-gradient-to-r from-pink-600 to-yellow-600`}>
               慶典最高潮!!!<br/>
               <span className="text-xl not-italic mt-2 block italic text-white/80 tracking-normal">BOING! BOING! 🤡</span>
            </div>
            <button onClick={() => { setGameState('SETTLEMENT'); playPop(800, 'sine', 0.3, 0.2); }}
              className="px-12 py-6 bg-white text-indigo-950 font-black text-2xl rounded-full border-b-8 border-indigo-200 hover:scale-110 active:scale-95 transition-all shadow-2xl animate-pulse"
            >領取禮物 ➔</button>
          </div>
        </div>
      )}

      {gameState === 'SETTLEMENT' && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
          <div className="text-9xl mb-4 animate-bounce">{JOKER}</div>
          <h2 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-orange-600 mb-2 italic">
            太精彩了！
          </h2>
          <div className="bg-neutral-900/50 backdrop-blur-md p-8 rounded-[40px] border-2 border-orange-500/30 mb-8 w-full max-w-xs shadow-2xl">
             <div className="text-neutral-500 text-xs font-black uppercase tracking-widest mb-1">本次演出得分</div>
             <div className="text-7xl font-black text-yellow-500">{score}</div>
          </div>
          <button onClick={initGrid} className="px-12 py-5 bg-gradient-to-r from-orange-500 to-pink-500 text-white font-black text-2xl rounded-full hover:scale-110 transition-all border-4 border-white shadow-lg">開始新表演 🔄</button>
        </div>
      )}

      <div className="w-full max-w-[320px] flex flex-col mb-4">
        <div className="flex justify-between items-start mb-2">
          <div className="relative group">
            <h1 className="text-2xl font-black italic tracking-tighter text-purple-500 drop-shadow-md leading-none">小丑嘉年華</h1>
            <p className="text-[10px] font-bold text-red-500 mt-1 uppercase tracking-widest italic font-black">🤡 SKILL READY ALERT 🤡</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button onClick={() => setShowHelp(true)} className="w-8 h-8 bg-neutral-900 rounded-full border border-neutral-800 flex items-center justify-center text-neutral-500 hover:text-white hover:border-purple-500 transition-all active:scale-90 font-black">?</button>
            <div className="bg-neutral-900 px-3 py-1 rounded-xl border border-neutral-800 shadow-inner text-right">
              <div className="text-[8px] text-neutral-500 font-bold leading-tight">SCORE</div>
              <div className="text-xl font-black text-yellow-500 leading-none">{score}</div>
            </div>
          </div>
        </div>

        <div className={`bg-neutral-900/80 p-3 rounded-2xl border transition-all duration-300 flex flex-col gap-3 shadow-lg relative overflow-hidden border-neutral-800`}>
          <div className="flex items-center justify-between z-10">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">魔法目標</span>
              <span className="text-xs font-bold text-neutral-400 italic">尋找這個圖案</span>
            </div>
            <div className="w-12 h-12 bg-neutral-950 rounded-xl border-2 border-purple-500/50 flex items-center justify-center text-4xl animate-pulse shadow-[0_0_15px_rgba(168,85,247,0.3)]">
              {targetColor}
            </div>
          </div>
          <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
              <div className={`h-full transition-all duration-500 ease-out rounded-full bg-purple-600 shadow-[0_0_10px_rgba(168,85,247,0.5)] ${charge === MAX_CHARGE ? 'animate-pulse' : ''}`} style={{ width: `${(charge / MAX_CHARGE) * 100}%` }} />
          </div>
          <div className="flex justify-between items-center text-[9px] font-black text-orange-500 uppercase tracking-widest px-1">
            <span>慶典進度</span>
            <span className={jokerCount >= STAMPEDE_THRESHOLD - 5 ? 'animate-pulse text-red-500' : ''}>{jokerCount} / {STAMPEDE_THRESHOLD}</span>
          </div>
        </div>
      </div>

      <div className={`relative p-3 bg-neutral-900/40 backdrop-blur-sm rounded-[32px] border-2 border-neutral-800 shadow-2xl`}>
        <div className="relative grid grid-cols-6 grid-rows-7 gap-1 w-[306px] h-[357px]">
          {grid.map((row, r) => row.map((cell, c) => (
            <div key={`${r}-${c}`} onClick={() => handleCellClick(r, c)}
              className={`w-[50px] h-[50px] bg-neutral-950/60 rounded-xl border border-neutral-900 transition-all duration-200 flex items-center justify-center text-3xl cursor-pointer relative overflow-hidden
                ${selected?.r === r && selected?.c === c ? 'border-purple-500 scale-105 shadow-[0_0_15px_rgba(168,85,247,0.5)] z-10' : ''}
                ${showSkillHint ? 'ring-1 ring-white/10' : ''}
              `}
            >
              {!cell && getTotem() && (
                <div className="absolute inset-0 flex items-center justify-center animate-totem-ready text-4xl z-20">
                  {getTotem()}
                </div>
              )}
              {cell && getTotem() && (
                <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none text-4xl z-0 scale-75 rotate-12">
                  {getTotem()}
                </div>
              )}

              <span className={`drop-shadow-md transition-transform z-10 ${jokerShows[`${r}-${c}`] ? 'opacity-0' : 'opacity-100'}`}>{cell}</span>
              
              {jokerShows[`${r}-${c}`] && (
                <div 
                  className={`absolute inset-0 flex items-center justify-center text-4xl z-[100] transition-transform duration-100 ease-out
                    ${jokerShows[`${r}-${c}`].phase === 'WAIT' ? 'animate-wiggle' : ''}
                  `}
                  style={{ transform: `scale(${jokerShows[`${r}-${c}`].scale})` }}
                >
                  🤡
                  {jokerShows[`${r}-${c}`].phase === 'WAIT' && (
                    <div className="absolute inset-0 bg-yellow-400/20 rounded-full blur-xl animate-pulse" />
                  )}
                </div>
              )}
              
              {cell === targetColor && gameState === 'IDLE' && (
                <div className="absolute inset-0 border border-purple-500/30 rounded-xl pointer-events-none animate-pulse" />
              )}
            </div>
          )))}
        </div>
      </div>

      <div className="mt-8 flex gap-4 w-full max-w-[320px]">
          <button onClick={initGrid} className="flex-1 px-4 py-4 bg-neutral-900 text-white font-black rounded-2xl border border-neutral-800 transition-all active:scale-95 text-[12px] tracking-widest hover:border-neutral-600">重整舞台 🔄</button>
          <button onClick={startFireworksFinale} className="flex-1 px-4 py-4 bg-indigo-900 text-white font-black rounded-2xl border border-indigo-700 transition-all active:scale-95 text-[12px] tracking-widest shadow-lg hover:bg-indigo-800">開始秀時間 🎆</button>
      </div>

      <style>{`
        @keyframes skill-hint {
          0% { transform: translate(-50%, -50px); opacity: 0; }
          20% { transform: translate(-50%, 0); opacity: 1; }
          25% { transform: translate(-50%, 0) rotate(2deg); }
          30% { transform: translate(-50%, 0) rotate(-2deg); }
          35% { transform: translate(-50%, 0) rotate(0); }
          100% { transform: translate(-50%, 0); opacity: 1; }
        }
        .animate-skill-hint { animation: skill-hint 1.5s ease-out; }
        
        @keyframes border-pulse {
          0%, 100% { border-width: 12px; opacity: 0.3; }
          50% { border-width: 20px; opacity: 0.6; }
        }
        .animate-border-pulse { animation: border-pulse 1.5s infinite ease-in-out; }

        @keyframes totem-ready {
          0% { transform: scale(0.8) rotate(0deg); filter: brightness(1); }
          50% { transform: scale(1.2) rotate(10deg); filter: brightness(1.5) drop-shadow(0 0 10px white); }
          100% { transform: scale(0.8) rotate(0deg); filter: brightness(1); }
        }
        .animate-totem-ready { animation: totem-ready 1s infinite ease-in-out; }

        @keyframes wiggle { 0%, 100% { transform: scale(2.2) rotate(0deg); } 25% { transform: scale(2.3) rotate(5deg); } 75% { transform: scale(2.3) rotate(-5deg); } }
        .animate-wiggle { animation: wiggle 0.2s infinite; }
        @keyframes shake { 0% { transform: translate(0,0); } 25% { transform: translate(5px,5px); } 50% { transform: translate(-5px,-5px); } 75% { transform: translate(5px,-5px); } 100% { transform: translate(0,0); } }
        .shake-anim { animation: shake 0.1s infinite; }
        .animate-in { animation: animate-in 0.3s ease-out; }
        @keyframes animate-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<BallGame />);
}
