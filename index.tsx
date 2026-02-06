
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// --- 遊戲常數 ---
const BALL_TYPES = ['🔴', '🟡', '🔵', '🟢', '⚪', '🟣', '🟠'];
const JOKER = '🤡';
const SAD_JOKER = '😢';
const COLS = 6;
const ROWS = 7;
const SWAP_DURATION = 250;
const MAX_CHARGE = 5;
const STAMPEDE_THRESHOLD = 21;

type GameState = 'IDLE' | 'SWAPPING' | 'MATCHING' | 'FALLING' | 'BOMBING' | 'SPARKLING' | 'GRAFFITI' | 'STAMPEDE' | 'SETTLEMENT';

interface Pos { r: number; c: number; }

interface Particle {
  id: number; x: number; y: number; vx: number; vy: number;
  color: string; life: number; size: number;
}

interface BouncingJoker {
  id: number; x: number; y: number; vx: number; vy: number;
  size: number;
  rotation: number;
  rv: number;
  emoji: string;
}

const BallGame: React.FC = () => {
  const [grid, setGrid] = useState<(string | null)[][]>([]);
  const [selected, setSelected] = useState<Pos | null>(null);
  const [gameState, setGameState] = useState<GameState>('IDLE');
  const [score, setScore] = useState(0);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [targetColor, setTargetColor] = useState<string>(BALL_TYPES[0]);
  const [charge, setCharge] = useState(0);
  const [bouncingJokers, setBouncingJokers] = useState<BouncingJoker[]>([]);
  const [isSurrender, setIsSurrender] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  
  const particleIdRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const jokerCount = grid.flat().filter(cell => cell === JOKER).length;

  // --- 音效 ---
  const playPop = (freq = 400, type: 'sine' | 'square' = 'sine', duration = 0.2, volume = 0.1) => {
    if (isMuted) return;
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, ctx.currentTime + duration);
    g.gain.setValueAtTime(volume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  const createExplosion = (r: number, c: number, color: string, isBig = false) => {
    const newParticles: Particle[] = [];
    const count = isBig ? 40 : 15;
    const colorMap: Record<string, string> = {
      '🔴': '#ff5e7d', '🟡': '#fbbf24', '🔵': '#3b82f6', 
      '🟢': '#22c55e', '⚪': '#f8fafc', '🟣': '#a855f7', '🟠': '#f97316',
      [JOKER]: '#64748b'
    };
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (isBig ? 4 : 2) + Math.random() * 4;
      newParticles.push({
        id: particleIdRef.current++,
        x: c * 52 + 26, y: r * 52 + 26,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color: colorMap[color] || '#ffffff',
        life: 100, size: 2 + Math.random() * 3
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  const startStampede = useCallback((count: number, surrenderMode: boolean = false) => {
    setGameState('STAMPEDE');
    setIsSurrender(surrenderMode);
    const jokers: BouncingJoker[] = [];
    const displayCount = count || 1; 
    const emoji = count === 0 && surrenderMode ? SAD_JOKER : JOKER;

    for (let i = 0; i < displayCount; i++) {
      jokers.push({
        id: i,
        x: Math.random() * (window.innerWidth - 60),
        y: Math.random() * (window.innerHeight - 60),
        vx: (Math.random() - 0.5) * 35,
        vy: (Math.random() - 0.5) * 35,
        size: 40 + Math.random() * 60,
        rotation: Math.random() * 360,
        rv: (Math.random() - 0.5) * 20,
        emoji: emoji
      });
    }
    setBouncingJokers(jokers);
    playPop(surrenderMode ? 300 : 600, 'sine', 0.5, 0.2); 
  }, [isMuted]);

  useEffect(() => {
    if (gameState !== 'STAMPEDE') return;
    const timer = setInterval(() => {
      setBouncingJokers(prev => prev.map(j => {
        let nx = j.x + j.vx;
        let ny = j.y + j.vy;
        let nvx = j.vx;
        let nvy = j.vy;
        let hit = false;
        if (nx < 0 || nx > window.innerWidth - j.size) { nvx *= -1; hit = true; }
        if (ny < 0 || ny > window.innerHeight - j.size) { nvy *= -1; hit = true; }
        if (hit) playPop(300 + Math.random() * 700, 'sine', 0.1, 0.04);
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
    setTargetColor(BALL_TYPES[Math.floor(Math.random() * BALL_TYPES.length)]);
  }, []);

  useEffect(() => {
    initGrid();
    const timer = setInterval(() => {
      setParticles(prev => prev.map(p => ({
        ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + 0.1, life: p.life - 4
      })).filter(p => p.life > 0));
    }, 16);
    return () => clearInterval(timer);
  }, [initGrid]);

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

  const spawnJokers = (currentGrid: (string | null)[][], count: number) => {
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
      createExplosion(pos.r, pos.c, JOKER, false);
      spawned++;
    }
    const totalJokers = nextGrid.flat().filter(c => c === JOKER).length;
    if (totalJokers >= STAMPEDE_THRESHOLD) {
      setTimeout(() => startStampede(totalJokers, false), 500);
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
        if (triggeredMode) setGameState(triggeredMode);
        else setGameState('IDLE');
        return Math.min(nextCharge, MAX_CHARGE);
      });
      return;
    }
    const nextGrid = currentGrid.map(row => [...row]);
    let turnScore = 0;
    let nextMode = triggeredMode;
    let targetInThisChain = wasTargetMatched;
    let newMatchesCount = matchLines.length;
    const matchedPos = new Set<string>();
    matchLines.forEach(line => {
      const lineColor = currentGrid[line[0].r][line[0].c];
      if (lineColor === targetColor) targetInThisChain = true;
      line.forEach(p => matchedPos.add(`${p.r},${p.c}`));
      if (line.length >= 5) {
        turnScore += 1000;
        nextMode = 'SPARKLING';
      } else if (line.length === 4) {
        turnScore += 300;
        if (nextMode !== 'SPARKLING') nextMode = 'BOMBING';
      } else turnScore += 100;
    });
    matchedPos.forEach(s => {
      const [r, c] = s.split(',').map(Number);
      const color = nextGrid[r][c]!;
      createExplosion(r, c, color);
      nextGrid[r][c] = null;
    });
    setScore(s => s + turnScore);
    setGrid(nextGrid);
    playPop(nextMode === 'SPARKLING' ? 800 : nextMode === 'BOMBING' ? 600 : 400, 'square');
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
    const nextMatches = findMatchLines(fallenGrid);
    if (nextMatches.length === 0 && targetInThisChain) {
      setTargetColor(BALL_TYPES[Math.floor(Math.random() * BALL_TYPES.length)]);
    }
    processMatches(fallenGrid, nextMode, targetInThisChain, currentChainCharge + newMatchesCount);
  }, [isMuted, targetColor, charge, startStampede]);

  const handleCellClick = async (r: number, c: number) => {
    if (gameState !== 'IDLE' && gameState !== 'BOMBING' && gameState !== 'SPARKLING' && gameState !== 'GRAFFITI') return;
    if (gameState === 'BOMBING') {
      const color = grid[r][c];
      if (!color) return;
      const nextGrid = grid.map(row => [...row]);
      nextGrid[r][c] = null;
      createExplosion(r, c, color, true);
      playPop(700, 'square');
      setGrid(nextGrid);
      await new Promise(res => setTimeout(res, 200));
      processMatches(nextGrid);
      return;
    }
    if (gameState === 'SPARKLING') {
      const colorToClear = grid[r][c];
      if (!colorToClear) return;
      const nextGrid = grid.map(row => row.map(cell => (cell === colorToClear || cell === JOKER) ? null : cell));
      grid.forEach((row, ri) => row.forEach((cell, ci) => {
        if (cell === colorToClear || cell === JOKER) createExplosion(ri, ci, cell!, true);
      }));
      playPop(900, 'square');
      setGrid(nextGrid);
      await new Promise(res => setTimeout(res, 300));
      processMatches(nextGrid);
      return;
    }
    if (gameState === 'GRAFFITI') {
      if (grid[r][c] === JOKER) { playPop(150, 'square'); return; }
      const nextGrid = grid.map(row => [...row]);
      nextGrid[r][c] = targetColor;
      createExplosion(r, c, targetColor, false);
      playPop(650, 'sine');
      setGrid(nextGrid);
      await new Promise(res => setTimeout(res, 200));
      processMatches(nextGrid);
      return;
    }
    if (grid[r][c] === JOKER) { playPop(150, 'square'); return; }
    if (!selected) { setSelected({ r, c }); playPop(300); return; }
    const dr = Math.abs(selected.r - r);
    const dc = Math.abs(selected.c - c);
    const isNeighbor = (dr <= 1 && dc <= 1) && !(dr === 0 && dc === 0);
    if (isNeighbor) {
      setGameState('SWAPPING');
      const nextGrid = grid.map(row => [...row]);
      const temp = nextGrid[r][c];
      nextGrid[r][c] = nextGrid[selected.r][selected.c];
      nextGrid[selected.r][selected.c] = temp;
      setGrid(nextGrid);
      setSelected(null);
      await new Promise(res => setTimeout(res, SWAP_DURATION));
      const matchLines = findMatchLines(nextGrid);
      if (matchLines.length > 0) {
        const hasTarget = matchLines.some(line => nextGrid[line[0].r][line[0].c] === targetColor);
        if (!hasTarget) {
          const penalizedGrid = spawnJokers(nextGrid, 1);
          setGrid(penalizedGrid);
          await new Promise(res => setTimeout(res, 100));
          processMatches(penalizedGrid, null, false);
        } else processMatches(nextGrid, null, false);
      } else {
        const resetGrid = grid.map(row => [...row]);
        const temp2 = resetGrid[r][c];
        resetGrid[r][c] = resetGrid[selected.r][selected.c];
        resetGrid[selected.r][selected.c] = temp2;
        const penalizedGrid = spawnJokers(resetGrid, 2);
        setGrid(penalizedGrid);
        setGameState('IDLE');
        playPop(200, 'square');
      }
    } else { setSelected({ r, c }); playPop(300); }
  };

  const handleSurrender = () => {
    if (gameState !== 'IDLE') return;
    startStampede(jokerCount, true);
  };

  return (
    <div className={`min-h-screen transition-colors duration-500 flex flex-col items-center justify-center p-4 font-sans select-none overflow-hidden
      ${gameState === 'STAMPEDE' ? 'bg-indigo-900 animate-pulse-gentle' : 'bg-neutral-950'}
    `}>
      
      {/* 遊戲說明彈窗 */}
      {showHelp && (
        <div className="fixed inset-0 z-[300] bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm" onClick={() => setShowHelp(false)}>
          <div className="bg-neutral-900 border-2 border-purple-500 p-8 rounded-[40px] max-w-sm w-full text-white shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-2xl font-black italic text-purple-400">遊戲說明 📖</h3>
            <ul className="text-sm space-y-2 text-neutral-300 font-bold">
              <li>🔸 <span className="text-white">連線：</span>斜、直、橫達 3 顆以上即可消除。</li>
              <li>🔸 <span className="text-white">小丑：</span>非法移動或消珠未含目標色會增加 🤡。</li>
              <li>🔸 <span className="text-white">爆走：</span>滿 21 隻 🤡 或點擊「不玩了」進入彈珠秀。</li>
              <li>🔸 <span className="text-red-400">炸彈 (4連)：</span>單點炸掉任何珠子。</li>
              <li>🔸 <span className="text-cyan-400">閃光 (5+連)：</span>消除場上所有小丑與同色珠。</li>
              <li>🔸 <span className="text-purple-400">塗鴉 (能量)：</span>消除目標色累積能量，點擊珠子變色。</li>
            </ul>
            <button onClick={() => setShowHelp(false)} className="w-full py-3 bg-purple-600 rounded-full font-black text-white hover:bg-purple-500 transition-colors">我知道了</button>
          </div>
        </div>
      )}

      {/* 小丑爆走覆蓋層 */}
      {gameState === 'STAMPEDE' && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center">
          {bouncingJokers.map(j => (
            <div key={j.id} style={{ left: j.x, top: j.y, width: j.size, height: j.size, transform: `rotate(${j.rotation}deg)` }} 
              className="absolute bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-4xl shadow-[inset_0_-4px_10px_rgba(0,0,0,0.3),0_5px_15px_rgba(0,0,0,0.5)] border border-white/30"
            >
              <span className="drop-shadow-lg">{j.emoji}</span>
            </div>
          ))}
          <div className="relative z-[110] flex flex-col items-center pointer-events-auto gap-12">
            <div className={`text-white font-black text-6xl italic tracking-tighter p-10 animate-bounce shadow-2xl text-center rounded-3xl border-8 border-white ${isSurrender ? 'bg-gradient-to-r from-blue-500 to-indigo-500' : 'bg-gradient-to-r from-pink-500 to-yellow-500'}`}>
               {isSurrender ? '玩家投降!!!' : '小丑大爆走!!!'}<br/>
               <span className="text-3xl not-italic mt-2 block">{isSurrender ? '不玩了啦 🏳️' : 'BOING! BOING! 🤡'}</span>
            </div>
            <button onClick={() => { setGameState('SETTLEMENT'); setBouncingJokers([]); playPop(800, 'sine', 0.3, 0.2); }}
              className="px-12 py-6 bg-white text-indigo-950 font-black text-3xl rounded-full border-b-8 border-indigo-200 hover:scale-110 active:scale-95 transition-all shadow-[0_20px_50px_rgba(0,0,0,0.5)] animate-pulse"
            >看結算 ➔</button>
          </div>
        </div>
      )}

      {/* 結算畫面 */}
      {gameState === 'SETTLEMENT' && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
          <div className="text-9xl mb-4 animate-bounce">{isSurrender ? SAD_JOKER : JOKER}</div>
          <h2 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-orange-600 mb-2 italic">
            {isSurrender ? '下次再加油！' : '表演精彩！'}
          </h2>
          <div className="bg-neutral-900/50 backdrop-blur-md p-8 rounded-[40px] border-2 border-orange-500/30 mb-8 w-full max-w-xs shadow-2xl">
             <div className="text-neutral-500 text-xs font-black uppercase tracking-widest mb-1">最終積分</div>
             <div className="text-7xl font-black text-yellow-500">{score}</div>
          </div>
          <button onClick={initGrid} className="px-12 py-5 bg-gradient-to-r from-orange-500 to-pink-500 text-white font-black text-2xl rounded-full hover:scale-110 transition-all border-4 border-white">再來一場 🔄</button>
        </div>
      )}

      {/* 標題與任務目標 */}
      <div className="w-full max-w-[320px] flex flex-col mb-4">
        <div className="flex justify-between items-start mb-2">
          <div className="relative group">
            <h1 className="text-3xl font-black italic tracking-tighter text-purple-500 drop-shadow-md leading-none">斜直橫消珠</h1>
            <p className="text-[10px] font-bold text-red-500 mt-1 uppercase tracking-widest italic font-black">PUZZLE CARNIVAL 🤡</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button onClick={() => setShowHelp(true)} className="w-8 h-8 bg-neutral-900 rounded-full border border-neutral-800 flex items-center justify-center text-neutral-500 hover:text-white hover:border-purple-500 transition-all active:scale-90 font-black">?</button>
            <div className="bg-neutral-900 px-3 py-1 rounded-xl border border-neutral-800 shadow-inner text-right">
              <div className="text-[8px] text-neutral-500 font-bold leading-tight">SCORE</div>
              <div className="text-xl font-black text-yellow-500 leading-none">{score}</div>
            </div>
          </div>
        </div>

        <div className={`bg-neutral-900/80 p-3 rounded-2xl border transition-all duration-300 flex flex-col gap-3 shadow-lg relative overflow-hidden
          ${gameState === 'BOMBING' ? 'border-red-600 shadow-red-900/40 bg-red-950/20' : 
            gameState === 'SPARKLING' ? 'border-cyan-500 shadow-cyan-900/40 bg-cyan-950/20' : 
            gameState === 'GRAFFITI' ? 'border-purple-500 shadow-purple-900/40 bg-purple-950/20' : 'border-neutral-800'}
        `}>
          <div className="flex items-center justify-between z-10">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">任務目標色</span>
              <span className="text-xs font-bold text-neutral-400">消除以積累能量</span>
            </div>
            <div className="w-12 h-12 bg-neutral-950 rounded-xl border-2 border-purple-500/50 flex items-center justify-center text-4xl animate-pulse shadow-[0_0_15px_rgba(168,85,247,0.3)]">
              {targetColor}
            </div>
          </div>
          
          <div className="flex flex-col gap-1 z-10">
            <div className="flex justify-between items-center text-[9px] font-black text-purple-400 uppercase tracking-widest">
              <span>Graffiti Charge</span>
              <span>{charge} / {MAX_CHARGE}</span>
            </div>
            <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
              <div className={`h-full transition-all duration-500 ease-out rounded-full ${charge >= MAX_CHARGE ? 'bg-purple-400 shadow-[0_0_8px_#a855f7] animate-pulse' : 'bg-purple-600'}`} style={{ width: `${(charge / MAX_CHARGE) * 100}%` }} />
            </div>
          </div>

          <div className="relative min-h-[70px] flex flex-col justify-center border-t border-neutral-800 pt-2 transition-all duration-300 z-10">
            {gameState === 'IDLE' ? (
              <>
                <div className="flex justify-between items-center text-[9px] font-black text-orange-500 uppercase tracking-widest mb-1">
                  <span>Joker Alert</span>
                  <span className={jokerCount >= 15 ? 'animate-pulse text-orange-400 font-black' : ''}>{jokerCount} / {STAMPEDE_THRESHOLD}</span>
                </div>
                <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800 mb-2">
                  <div className={`h-full transition-all duration-300 ease-out rounded-full ${jokerCount >= STAMPEDE_THRESHOLD - 5 ? 'bg-orange-500 animate-pulse' : 'bg-orange-900'}`} style={{ width: `${(jokerCount / STAMPEDE_THRESHOLD) * 100}%` }} />
                </div>
                <button 
                  onClick={handleSurrender}
                  className="w-full py-2 font-black rounded-xl border bg-indigo-900/30 text-indigo-400 border-indigo-900/50 hover:bg-indigo-900/50 hover:text-white transition-all active:scale-95 text-[10px] tracking-widest flex items-center justify-center gap-2"
                >不玩了 🏳️</button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-1 animate-in slide-in-from-bottom-2 duration-300">
                {gameState === 'BOMBING' && <div className="text-red-500 font-black tracking-widest text-xs animate-pulse">💣 炸彈模式：點擊任意珠子炸碎它！</div>}
                {gameState === 'SPARKLING' && <div className="text-cyan-400 font-black tracking-widest text-xs animate-pulse">✨ 閃光模式：消除指定色及場上小丑！</div>}
                {gameState === 'GRAFFITI' && <div className="text-purple-400 font-black tracking-widest text-xs animate-pulse">🎨 塗鴉魔法：點擊將珠子變為任務色！</div>}
                <div className="mt-1 text-[8px] text-neutral-500 font-bold uppercase tracking-tighter italic">技能已準備就緒，請在棋盤上施放</div>
              </div>
            )}
          </div>
          
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 blur-2xl rounded-full" />
        </div>
      </div>

      {/* 遊戲棋盤 */}
      <div className={`relative p-3 bg-neutral-900 rounded-[32px] border-2 transition-all duration-500 shadow-2xl
        ${gameState === 'BOMBING' ? 'border-red-600 shadow-red-900/40' : 
          gameState === 'SPARKLING' ? 'border-cyan-500 shadow-cyan-900/40' : 
          gameState === 'GRAFFITI' ? 'border-purple-500 shadow-purple-900/40' : 
          gameState === 'STAMPEDE' ? 'border-orange-500 scale-95 blur-[4px]' : 'border-neutral-800'}
      `}>
        <div className="relative grid grid-cols-6 grid-rows-7 gap-1 w-[306px] h-[357px]">
          <div className="absolute inset-0 pointer-events-none z-50">
            {particles.map(p => (
              <div key={p.id} style={{ left: p.x, top: p.y, width: p.size, height: p.size, backgroundColor: p.color, opacity: p.life / 100 }} className="absolute rounded-full" />
            ))}
          </div>

          {grid.map((row, r) => row.map((cell, c) => (
            <div key={`${r}-${c}`} onClick={() => handleCellClick(r, c)}
              className={`w-[50px] h-[50px] bg-neutral-950 rounded-xl border transition-all duration-200 flex items-center justify-center text-3xl cursor-pointer relative overflow-hidden
                ${selected?.r === r && selected?.c === c ? 'border-purple-500 scale-105 shadow-[0_0_15px_rgba(168,85,247,0.5)] z-10' : 'border-neutral-900 hover:border-neutral-800'}
                ${(gameState === 'MATCHING' || gameState === 'FALLING') && !cell ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}
                ${gameState === 'BOMBING' && cell ? 'animate-pulse-red' : ''}
                ${gameState === 'SPARKLING' && cell ? 'animate-pulse-cyan' : ''}
                ${gameState === 'GRAFFITI' && cell ? 'animate-pulse-purple' : ''}
                ${cell === JOKER ? 'grayscale-[0.5] opacity-80' : ''}
              `}
            >
              <span className={`drop-shadow-sm ${cell === JOKER ? 'animate-bounce-slow' : ''}`}>{cell}</span>
              {cell === targetColor && gameState === 'IDLE' && (
                <div className="absolute inset-0 border-2 border-purple-500/20 rounded-xl pointer-events-none" />
              )}
            </div>
          )))}
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-4 w-full max-w-[320px]">
        <div className="grid grid-cols-3 gap-2 w-full">
          <div className={`bg-neutral-900/50 p-2 rounded-2xl border transition-colors flex flex-col items-center ${gameState === 'GRAFFITI' ? 'border-purple-500 bg-purple-900/20 shadow-[0_0_10px_rgba(168,85,247,0.2)]' : 'border-purple-900/30'}`}>
            <span className="text-[9px] font-bold text-purple-400 mb-1 leading-none uppercase tracking-tighter">Energy🎨</span>
            <span className="text-xs font-black text-center leading-none">塗鴉</span>
          </div>
          <div className={`bg-neutral-900/50 p-2 rounded-2xl border transition-colors flex flex-col items-center ${gameState === 'BOMBING' ? 'border-red-500 bg-red-900/20 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'border-red-900/30'}`}>
            <span className="text-[9px] font-bold text-red-500 mb-1 leading-none uppercase tracking-tighter">4 Match💣</span>
            <span className="text-xs font-black text-center leading-none">炸裂</span>
          </div>
          <div className={`bg-neutral-900/50 p-2 rounded-2xl border transition-colors flex flex-col items-center ${gameState === 'SPARKLING' ? 'border-cyan-500 bg-cyan-900/20 shadow-[0_0_10px_rgba(34,211,238,0.2)]' : 'border-cyan-900/30'}`}>
            <span className="text-[9px] font-bold text-cyan-500 mb-1 leading-none uppercase tracking-tighter">5+ Match✨</span>
            <span className="text-xs font-black text-center leading-none">驅逐</span>
          </div>
        </div>

        <div className="flex gap-4 w-full">
          <button onClick={initGrid} className="flex-1 px-4 py-3 bg-neutral-900 text-neutral-400 hover:text-white font-black rounded-2xl border border-neutral-800 transition-all active:scale-95 text-[10px] tracking-widest">重新開始 🔄</button>
          <button onClick={() => setIsMuted(!isMuted)} className="w-12 h-12 bg-neutral-900 rounded-2xl flex items-center justify-center border border-neutral-800 text-xl active:scale-95">
            {isMuted ? '🔇' : '🔔'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse-red { 0%, 100% { border-color: #ef4444; } 50% { border-color: #ffffff; } }
        .animate-pulse-red { animation: pulse-red 0.6s infinite; border-width: 2px; }
        @keyframes pulse-cyan { 0%, 100% { border-color: #22d3ee; } 50% { border-color: #ffffff; } }
        .animate-pulse-cyan { animation: pulse-cyan 0.6s infinite; border-width: 2px; }
        @keyframes pulse-purple { 0%, 100% { border-color: #a855f7; } 50% { border-color: #ffffff; } }
        .animate-pulse-purple { animation: pulse-purple 0.6s infinite; border-width: 2px; }
        @keyframes bounce-slow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        .animate-bounce-slow { animation: bounce-slow 2s infinite ease-in-out; }
        @keyframes pulse-gentle { 0%, 100% { background-color: #312e81; } 50% { background-color: #4c1d95; } }
        .animate-pulse-gentle { animation: pulse-gentle 2s infinite; }
        
        .animate-in { animation: animate-in 0.3s ease-out; }
        @keyframes animate-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<BallGame />);
}
