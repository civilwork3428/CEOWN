
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- 遊戲常數 ---
const ALL_BALL_TYPES = ['🔴', '🟡', '🔵', '🟢', '⚪', '🟣', '🟠'];
const JOKER = '🤡';
const SAD_JOKER = '😢';
const COLS = 6;
const ROWS = 7;
const SWAP_DURATION = 250;
const MAX_CHARGE = 5;
const JOKER_COST = 500; // 每隻小丑的基本成本（結算扣除）
const ACTION_COST_PER_JOKER = 50; // 每次行動，每個小丑的打工費（即時扣除）
const PENALTY_PER_JOKER = 1000; // 少一人的違約金
const BONUS_PER_JOKER = 500; // 多一人的獎勵金
const RECRUIT_COST = 1000; // 招募小丑的費用

const LEVELS = [
  { id: 'family', name: '家庭派對', req: 3, time: 120, desc: '溫馨的小型慶祝會', color: 'from-green-500 to-emerald-700' },
  { id: 'community', name: '社區巡演', req: 7, time: 180, desc: '熱鬧的街頭藝術節', color: 'from-blue-500 to-indigo-700' },
  { id: 'festival', name: '慶典盛會', req: 12, time: 180, desc: '萬眾矚目的宏大嘉年華', color: 'from-purple-500 to-rose-700' },
];

type GameState = 'START_SCREEN' | 'IDLE' | 'SWAPPING' | 'MATCHING' | 'FALLING' | 'BOMBING' | 'SPARKLING' | 'GRAFFITI' | 'STAMPEDE' | 'SETTLEMENT';

interface Pos { r: number; c: number; }
interface Particle { id: number; x: number; y: number; vx: number; vy: number; color: string; life: number; size: number; spark: boolean; }
interface BouncingJoker { id: number; x: number; y: number; vx: number; vy: number; size: number; rotation: number; rv: number; emoji: string; }
interface FloatingText { id: number; x: number; y: number; text: string; life: number; color: string; }

const BallGame: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>('START_SCREEN');
  const [selectedLevel, setSelectedLevel] = useState(LEVELS[0]);
  const [grid, setGrid] = useState<(string | null)[][]>([]);
  const [selected, setSelected] = useState<Pos | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [targetColor, setTargetColor] = useState<string>(ALL_BALL_TYPES[0]);
  const [charge, setCharge] = useState(0);
  const [bouncingJokers, setBouncingJokers] = useState<BouncingJoker[]>([]);
  const [isSurrender, setIsSurrender] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [aiReview, setAiReview] = useState<{grade: string, comment: string}>({grade: '-', comment: '正在結算...'});
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(180);
  
  const particleIdRef = useRef(0);
  const floatingTextIdRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const lastJokerCountRef = useRef(0);

  // 保持 5 色平衡難度
  const getAvailableBalls = useCallback(() => {
    return ALL_BALL_TYPES.slice(0, 5); // 🔴🟡🔵🟢⚪
  }, []);

  const jokerCount = grid.flat().filter(cell => cell === JOKER).length;
  lastJokerCountRef.current = jokerCount;

  const missingCount = Math.max(0, selectedLevel.req - jokerCount);
  const extraCount = Math.max(0, jokerCount - selectedLevel.req);
  
  const baseCost = jokerCount * JOKER_COST;
  const penaltyDebt = missingCount * PENALTY_PER_JOKER;
  const bonusCredit = extraCount * BONUS_PER_JOKER;
  const totalDebt = baseCost + penaltyDebt - bonusCredit;
  const isSuccess = score >= totalDebt;

  const wasTargetClearedRef = useRef(false);

  // 時間格式化
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 倒數計時邏輯
  useEffect(() => {
    let timer: number;
    const activeStates: GameState[] = ['IDLE', 'SWAPPING', 'MATCHING', 'FALLING', 'BOMBING', 'SPARKLING', 'GRAFFITI'];
    
    if (activeStates.includes(gameState)) {
      timer = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            startStampede(lastJokerCountRef.current, false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState]);

  const generateAIComment = async (finalScore: number, jokers: number, success: boolean, levelName: string) => {
    setIsAiLoading(true);
    setAiReview({grade: '-', comment: '正在數錢...'});
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `你是一個「奸詐、狡黠、凡事以利益為重」的嘉年華大老闆。玩家完成了合約：${levelName}，最終盈餘為：${finalScore - totalDebt}。請給出評級與一句話評語。評語要極端陰險、奸巧，像是帶著優雅笑意在計算玩家的利用價值，而非謾罵。`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              grade: { type: Type.STRING, description: "評級 S(大賺), A(小賺), B(平手), C(虧損), D(撤資)" },
              comment: { type: Type.STRING, description: "12字以內，奸詐狡猾的一針見血評語" }
            },
            required: ["grade", "comment"]
          }
        }
      });
      const res = JSON.parse(response.text || '{"grade":"F","comment":"生意難做。"}');
      setAiReview(res);
    } catch (error) {
      setAiReview({grade: success ? 'S' : 'D', comment: success ? '呵呵，這點利潤我也就笑納了。' : '這點殘渣，我連看都不看。'});
    } finally {
      setIsAiLoading(false);
    }
  };

  const playSound = (freq = 400, type: OscillatorType = 'sine', duration = 0.2, volume = 0.1) => {
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
    } catch(e) {}
  };

  const createExplosion = (r: number, c: number, color: string, isBig = false) => {
    if (!boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const cellW = rect.width / COLS;
    const cellH = rect.height / ROWS;

    const newParticles: Particle[] = [];
    const colorMap: Record<string, string> = {
      '🔴': '#ff5e7d', '🟡': '#fbbf24', '🔵': '#3b82f6', 
      '🟢': '#22c55e', '⚪': '#f8fafc', '🟣': '#a855f7', '🟠': '#f97316',
      [JOKER]: '#6366f1'
    };
    const baseColor = colorMap[color] || '#ffffff';
    for (let i = 0; i < (isBig ? 20 : 8); i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (isBig ? 3 : 2) + Math.random() * 4;
      newParticles.push({
        id: particleIdRef.current++,
        x: (c + 0.5) * cellW, y: (r + 0.5) * cellH,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color: baseColor,
        life: 100, size: 2 + Math.random() * 2,
        spark: Math.random() > 0.8
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  const createFloatingText = (r: number, c: number, text: string, color: string) => {
    if (!boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const cellW = rect.width / COLS;
    const cellH = rect.height / ROWS;
    setFloatingTexts(prev => [
      ...prev,
      { id: floatingTextIdRef.current++, x: (c + 0.5) * cellW, y: r * cellH, text, life: 100, color }
    ]);
  };

  const startGame = (level: typeof LEVELS[0]) => {
    setSelectedLevel(level);
    initGrid(level);
  };

  const initGrid = useCallback((level: typeof LEVELS[0]) => {
    const availableBalls = getAvailableBalls();
    let newGrid: string[][] = [];
    do {
      newGrid = Array(ROWS).fill(null).map(() => 
        Array(COLS).fill(null).map(() => availableBalls[Math.floor(Math.random() * availableBalls.length)])
      );
    } while (findMatchLines(newGrid).length > 0);
    setGrid(newGrid);
    setScore(0);
    setCharge(0);
    setCombo(0);
    setTimeLeft(level.time);
    setGameState('IDLE');
    setIsSurrender(false);
    setTargetColor(availableBalls[Math.floor(Math.random() * availableBalls.length)]);
    wasTargetClearedRef.current = false;
  }, [getAvailableBalls]);

  useEffect(() => {
    const timer = setInterval(() => {
      setParticles(prev => prev.map(p => ({
        ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + 0.15, life: p.life - 5
      })).filter(p => p.life > 0));
      setFloatingTexts(prev => prev.map(t => ({
        ...t, y: t.y - 1, life: t.life - 3
      })).filter(t => t.life > 0));
    }, 16);
    return () => clearInterval(timer);
  }, []);

  function findMatchLines(g: (string | null)[][]) {
    const lines: Pos[][] = [];
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = g[r][c];
        if (!color || color === JOKER) continue;
        for (const [dr, dc] of dirs) {
          let currentLine: Pos[] = [{ r, c }];
          let nr = r + dr, nc = c + dc;
          while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && g[nr][nc] === color) {
            currentLine.push({ r: nr, c: nc });
            nr += dr; nc += dc;
          }
          if (currentLine.length >= 3) {
            const alreadyIn = lines.some(l => l.every((p, i) => currentLine[i] && p.r === currentLine[i].r && p.c === currentLine[i].c));
            if (!alreadyIn) lines.push(currentLine);
          }
        }
      }
    }
    return lines;
  }

  const startStampede = (count: number, surrenderMode: boolean = false) => {
    setGameState('STAMPEDE');
    setIsSurrender(surrenderMode);
    const jokers: BouncingJoker[] = [];
    const emoji = count === 0 && surrenderMode ? SAD_JOKER : JOKER;
    for (let i = 0; i < Math.max(count, 8); i++) {
      jokers.push({
        id: i,
        x: Math.random() * (window.innerWidth - 60),
        y: Math.random() * (window.innerHeight - 60),
        vx: (Math.random() - 0.5) * 20,
        vy: (Math.random() - 0.5) * 20,
        size: 50 + Math.random() * 30,
        rotation: Math.random() * 360,
        rv: (Math.random() - 0.5) * 15,
        emoji
      });
    }
    setBouncingJokers(jokers);
    playSound(surrenderMode ? 150 : 600, 'triangle', 0.6);
  };

  useEffect(() => {
    if (gameState !== 'STAMPEDE') return;
    const timer = setInterval(() => {
      setBouncingJokers(prev => prev.map(j => {
        let nx = j.x + j.vx; let ny = j.y + j.vy;
        let nvx = j.vx; let nvy = j.vy;
        if (nx < 0 || nx > window.innerWidth - j.size) nvx *= -1;
        if (ny < 0 || ny > window.innerHeight - j.size) nvy *= -1;
        return { ...j, x: nx, y: ny, vx: nvx, vy: nvy, rotation: j.rotation + j.rv };
      }));
    }, 16);
    return () => clearInterval(timer);
  }, [gameState]);

  const processMatches = useCallback(async (currentGrid: (string | null)[][], triggeredMode: GameState | null = null, currentChainCharge: number = 0, isManualSwap = false) => {
    setGameState('MATCHING');
    const matchLines = findMatchLines(currentGrid);
    const availableBalls = getAvailableBalls();
    
    if (matchLines.length === 0) {
      if (isManualSwap && !wasTargetClearedRef.current) {
        const penalizedGrid = currentGrid.map(row => [...row]);
        const emptyPositions: Pos[] = [];
        penalizedGrid.forEach((row, r) => row.forEach((cell, c) => {
          if (cell !== JOKER) emptyPositions.push({r, c});
        }));
        if (emptyPositions.length > 0) {
          const target = emptyPositions[Math.floor(Math.random() * emptyPositions.length)];
          penalizedGrid[target.r][target.c] = JOKER;
          setGrid(penalizedGrid);
          playSound(200, 'square');
        }
      }

      setCharge(prev => {
        const nextCharge = prev + currentChainCharge;
        if (nextCharge >= MAX_CHARGE && !triggeredMode) {
          setGameState('GRAFFITI');
          return 0;
        }
        setGameState(triggeredMode || 'IDLE');
        setCombo(0);
        return Math.min(nextCharge, MAX_CHARGE);
      });

      if (wasTargetClearedRef.current) {
        setTargetColor(availableBalls[Math.floor(Math.random() * availableBalls.length)]);
        wasTargetClearedRef.current = false;
      }
      return;
    }

    const nextGrid = currentGrid.map(row => [...row]);
    let turnScore = 0;
    let turnCharge = 0;
    let nextMode = triggeredMode;
    const currentCombo = combo + 1;
    setCombo(currentCombo);

    matchLines.forEach(line => {
      const color = currentGrid[line[0].r][line[0].c];
      if (color === targetColor) {
        wasTargetClearedRef.current = true;
        turnCharge += 2;
      } else {
        turnCharge += 1;
      }
      
      const baseScore = line.length >= 5 ? 1200 : line.length === 4 ? 400 : 100;
      turnScore += baseScore * currentCombo;
      
      if (line.length >= 5) nextMode = 'SPARKLING';
      else if (line.length === 4 && nextMode !== 'SPARKLING') nextMode = 'BOMBING';

      line.forEach(p => {
        if (nextGrid[p.r][p.c]) {
          createExplosion(p.r, p.c, color!, line.length >= 4);
          nextGrid[p.r][p.c] = null;
        }
      });
      if (currentCombo > 1) createFloatingText(line[0].r, line[0].c, `${currentCombo}x!`, '#fbbf24');
    });

    setScore(s => s + turnScore);
    setGrid(nextGrid);
    playSound(400 + (currentCombo * 60), 'sine', 0.25);
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
        fallenGrid[r][c] = availableBalls[Math.floor(Math.random() * availableBalls.length)];
      }
    }
    setGrid(fallenGrid);
    await new Promise(r => setTimeout(r, 300));
    processMatches(fallenGrid, nextMode as GameState, currentChainCharge + turnCharge, isManualSwap);
  }, [combo, targetColor, getAvailableBalls]);

  const handleCellClick = async (r: number, c: number) => {
    if (gameState !== 'IDLE' && gameState !== 'BOMBING' && gameState !== 'SPARKLING' && gameState !== 'GRAFFITI') return;
    const color = grid[r][c];
    
    const applyActionCost = () => {
        const totalActionCost = lastJokerCountRef.current * ACTION_COST_PER_JOKER;
        if (totalActionCost > 0) {
            setScore(s => s - totalActionCost);
            createFloatingText(r, c, `-${totalActionCost}`, '#ef4444');
        }
    };

    if (gameState === 'BOMBING' && color) {
      applyActionCost();
      if (color === targetColor) wasTargetClearedRef.current = true;
      const nextGrid = grid.map(row => [...row]);
      nextGrid[r][c] = null;
      createExplosion(r, c, color, true);
      playSound(700, 'square', 0.4);
      setGrid(nextGrid);
      processMatches(nextGrid);
      return;
    }
    if (gameState === 'SPARKLING' && color) {
      applyActionCost();
      if (color === targetColor || grid.flat().some(cell => cell === color && cell === targetColor)) wasTargetClearedRef.current = true;
      const nextGrid = grid.map(row => row.map(cell => (cell === color || cell === JOKER) ? null : cell));
      grid.forEach((row, ri) => row.forEach((cell, ci) => {
        if (cell === color || cell === JOKER) createExplosion(ri, ci, cell!, true);
      }));
      playSound(900, 'square', 0.5);
      setGrid(nextGrid);
      processMatches(nextGrid);
      return;
    }
    if (gameState === 'GRAFFITI' && color !== JOKER) {
      applyActionCost();
      const nextGrid = grid.map(row => [...row]);
      nextGrid[r][c] = targetColor; 
      createExplosion(r, c, targetColor);
      playSound(550, 'sine', 0.3);
      setGrid(nextGrid);
      wasTargetClearedRef.current = true;
      processMatches(nextGrid);
      return;
    }

    if (color === JOKER) { playSound(120, 'square'); return; }
    if (!selected) { setSelected({ r, c }); playSound(350); return; }

    const dr = Math.abs(selected.r - r);
    const dc = Math.abs(selected.c - c);
    
    if ((dr <= 1 && dc <= 1) && !(dr === 0 && dc === 0)) {
      setGameState('SWAPPING');
      const nextGrid = grid.map(row => [...row]);
      [nextGrid[r][c], nextGrid[selected.r][selected.c]] = [nextGrid[selected.r][selected.c], nextGrid[r][c]];
      setGrid(nextGrid);
      setSelected(null);
      await new Promise(res => setTimeout(res, SWAP_DURATION));
      const matchLines = findMatchLines(nextGrid);
      if (matchLines.length > 0) {
        applyActionCost();
        wasTargetClearedRef.current = false;
        processMatches(nextGrid, null, 0, true);
      } else {
        setGrid(grid.map(row => [...row]));
        setGameState('IDLE');
        playSound(220, 'square');
      }
    } else { setSelected({ r, c }); playSound(350); }
  };

  const handleRecruitJoker = () => {
    if (gameState !== 'IDLE' || score < RECRUIT_COST) return;
    const nonJokerPositions: Pos[] = [];
    grid.forEach((row, r) => row.forEach((cell, c) => {
      if (cell && cell !== JOKER) nonJokerPositions.push({ r, c });
    }));
    if (nonJokerPositions.length === 0) return;
    const target = nonJokerPositions[Math.floor(Math.random() * nonJokerPositions.length)];
    const nextGrid = grid.map(row => [...row]);
    nextGrid[target.r][target.c] = JOKER;
    setScore(s => s - RECRUIT_COST);
    setGrid(nextGrid);
    createExplosion(target.r, target.c, JOKER, true);
    createFloatingText(target.r, target.c, `-${RECRUIT_COST}`, '#ef4444');
    playSound(150, 'square', 0.4, 0.2);
  };

  const handleSettlement = () => {
    setGameState('SETTLEMENT');
    setBouncingJokers([]);
    generateAIComment(score, lastJokerCountRef.current, isSuccess, selectedLevel.name);
  };

  const gradeColors: Record<string, string> = {
    'S': 'text-cyan-400 drop-shadow-[0_0_30px_rgba(34,211,238,0.8)]',
    'A': 'text-emerald-400 drop-shadow-[0_0_25px_rgba(52,211,153,0.7)]',
    'B': 'text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.6)]',
    'C': 'text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.5)]',
    'D': 'text-rose-600 drop-shadow-[0_0_15px_rgba(225,29,72,0.5)]',
    '-': 'text-neutral-600'
  };

  const colorGlowMap: Record<string, string> = {
    '🔴': '0 0 15px #ff5e7d', '🟡': '0 0 15px #fbbf24', '🔵': '0 0 15px #3b82f6', 
    '🟢': '0 0 15px #22c55e', '⚪': '0 0 15px #f8fafc', '🟣': '0 0 15px #a855f7', '🟠': '0 0 15px #f97316'
  };

  return (
    <div className={`w-full h-full flex flex-col items-center justify-center p-2 sm:p-4 transition-all duration-1000 select-none overflow-hidden relative ${gameState === 'STAMPEDE' ? 'bg-indigo-950' : 'bg-[#050505]'}`} style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))' }}>
      
      <div className="absolute inset-0 pointer-events-none opacity-40 blur-[80px]">
        <div className={`absolute top-0 left-0 w-1/2 h-1/2 rounded-full transition-all duration-1000 ${gameState === 'STAMPEDE' ? 'bg-purple-600' : 'bg-blue-900'}`} />
        <div className={`absolute bottom-0 right-0 w-1/2 h-1/2 rounded-full transition-all duration-1000 ${gameState === 'STAMPEDE' ? 'bg-red-600' : 'bg-purple-900'}`} />
      </div>

      {gameState === 'START_SCREEN' && (
        <div className="fixed inset-0 z-[400] bg-black/95 flex flex-col items-center justify-center p-6 overflow-y-auto" style={{ paddingTop: 'calc(2rem + env(safe-area-inset-top, 0px))' }}>
          <div className="mb-8 text-center animate-in">
             <h1 className="text-5xl sm:text-7xl font-black italic text-white bungee tracking-tighter mb-2">小丑大遊行</h1>
             <p className="text-indigo-500 font-black tracking-[0.3em] uppercase text-sm sm:text-lg">請選擇演出合約</p>
          </div>
          <div className="grid gap-4 w-full max-lg">
            {LEVELS.map(lvl => (
              <button key={lvl.id} onClick={() => startGame(lvl)} className={`group relative p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] bg-gradient-to-br ${lvl.color} text-white shadow-2xl transition-all hover:scale-[1.02] active:scale-95 text-left`}>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-2xl sm:text-4xl font-black bungee italic">{lvl.name}</span>
                  <div className="flex flex-col items-end gap-1">
                    <span className="bg-black/50 px-3 py-1 rounded-full text-[10px] font-black bungee">需求: {lvl.req}🤡</span>
                    <span className="bg-black/50 px-3 py-1 rounded-full text-[10px] font-black bungee">時限: {lvl.time}s</span>
                  </div>
                </div>
                <p className="text-sm sm:text-base font-bold opacity-90">{lvl.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {showHelp && (
        <div className="fixed inset-0 z-[500] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6 overflow-y-auto" onClick={() => setShowHelp(false)}>
          <div className="bg-neutral-900/95 border-2 border-indigo-500/50 p-6 sm:p-10 rounded-[40px] max-w-md w-full shadow-2xl space-y-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b-2 border-indigo-500 pb-2">
              <h3 className="text-2xl font-black bungee italic text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 to-purple-500">營運標準作業程序 (SOP)</h3>
              <button onClick={() => setShowHelp(false)} className="text-neutral-500 hover:text-white transition-colors text-2xl font-black bungee">×</button>
            </div>
            
            <div className="space-y-6 overflow-y-auto max-h-[60vh] pr-2 custom-scrollbar text-xs sm:text-sm">
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center font-black bungee text-[10px]">01</span>
                  <h4 className="text-indigo-400 bungee uppercase tracking-widest font-black">前期評估 (Evaluation)</h4>
                </div>
                <p className="text-neutral-400 font-bold ml-8">確認合約要求之小丑數量。小丑越多，後續單次行動所產生的工資負擔越重。</p>
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center font-black bungee text-[10px]">02</span>
                  <h4 className="text-indigo-400 bungee uppercase tracking-widest font-black">產值開發 (Production)</h4>
                </div>
                <div className="ml-8 space-y-2 text-neutral-300">
                  <p>• <span className="text-white">基礎消除</span>：匹配 3 枚珠子賺取積分。</p>
                  <p>• <span className="text-white">目標加成</span>：消除「TARGET」花色獲取雙倍充能。</p>
                  <p>• <span className="text-white">連鎖效應</span>：觸發 COMBO 可使該回合積分呈幾何倍數增長。</p>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center font-black bungee text-[10px]">03</span>
                  <h4 className="text-indigo-400 bungee uppercase tracking-widest font-black">人員配置 (HR)</h4>
                </div>
                <div className="ml-8 space-y-2 text-neutral-300">
                  <p>• <span className="text-white">招募代價</span>：每招募一員需支付 {RECRUIT_COST} 積分。</p>
                  <p>• <span className="text-white">維護成本</span>：每步移動需支付「🤡數 × {ACTION_COST_PER_JOKER}」工資。</p>
                  <p>• <span className="text-rose-500">注意</span>：若隨機移動未達成消除，老闆會強行塞入一員🤡並消耗額外成本。</p>
                </div>
              </section>

              <section className="space-y-3 border-t border-neutral-800 pt-4">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-rose-600 flex items-center justify-center font-black bungee text-[10px]">04</span>
                  <h4 className="text-rose-500 bungee uppercase tracking-widest font-black">結算與稅務 (Settlement)</h4>
                </div>
                <div className="ml-8 space-y-1 text-neutral-400 italic text-[10px] sm:text-[11px]">
                  <p>• 單員基礎稅率：{JOKER_COST}</p>
                  <p>• 缺員罰款：{PENALTY_PER_JOKER} / 位</p>
                  <p>• 超額獎金：{BONUS_PER_JOKER} / 位</p>
                </div>
              </section>
            </div>
            
            <button onClick={() => setShowHelp(false)} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xl hover:bg-indigo-500 active:scale-95 transition-all bungee shadow-[0_0_20px_rgba(79,70,229,0.4)]">明白了，開始營運</button>
          </div>
        </div>
      )}

      {gameState === 'STAMPEDE' && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/40">
          {bouncingJokers.map(j => (
            <div key={j.id} style={{ left: j.x, top: j.y, width: j.size, height: j.size, transform: `rotate(${j.rotation}deg)` }} className="absolute flex items-center justify-center text-4xl sm:text-5xl animate-pulse">
              <span>{j.emoji}</span>
            </div>
          ))}
          <div className="relative z-[110] text-center">
            <h2 className="text-6xl sm:text-8xl font-black italic text-white bungee mb-12 animate-bounce">{timeLeft === 0 ? '時間結束！' : isSurrender ? '中斷！' : '大爆走！'}</h2>
            <button onClick={handleSettlement} className="px-12 py-6 bg-white text-black font-black text-3xl sm:text-4xl rounded-full shadow-2xl bungee active:scale-90">結算 ➔</button>
          </div>
        </div>
      )}

      {gameState === 'SETTLEMENT' && (
        <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-center animate-in overflow-y-auto">
          <div className={`text-[15rem] sm:text-[22rem] font-black bungee italic leading-[0.8] mb-4 transition-all duration-700 ${gradeColors[aiReview.grade] || gradeColors['-']}`}>
            {aiReview.grade}
          </div>
          <div className="flex flex-col items-center gap-6 w-full max-w-2xl">
            <div className={`px-10 py-3 rounded-full font-black text-xl sm:text-2xl bungee italic tracking-widest ${isSuccess ? 'bg-cyan-600 text-white' : 'bg-rose-800 text-white animate-pulse'}`}>
              {isSuccess ? 'PROFIT ACHIEVED' : 'DEBT INCURRED'}
            </div>
            <p className="text-3xl sm:text-5xl font-black text-white italic tracking-tighter leading-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] px-4">
              「{aiReview.comment}」
            </p>
          </div>
          <div className="mt-12 mb-10 text-neutral-500 font-black bungee text-xl sm:text-2xl flex gap-8">
             <div className="flex flex-col items-center">
                <span className="text-[10px] opacity-40 mb-1">NET PROFIT</span>
                <span className={`text-3xl sm:text-4xl ${isSuccess ? 'text-cyan-400' : 'text-rose-600'}`}>{score - totalDebt}</span>
             </div>
             <div className="w-px h-12 bg-neutral-800" />
             <div className="flex flex-col items-center">
                <span className="text-[10px] opacity-40 mb-1">TOTAL SCORE</span>
                <span className="text-3xl sm:text-4xl text-neutral-300">{score}</span>
             </div>
          </div>
          <button onClick={() => setGameState('START_SCREEN')} className="px-20 py-6 bg-white text-black rounded-full font-black text-2xl sm:text-3xl bungee active:scale-95 transition-all shadow-[0_0_40px_rgba(255,255,255,0.2)] hover:scale-105">NEW DEAL 🔄</button>
        </div>
      )}

      {gameState !== 'START_SCREEN' && gameState !== 'SETTLEMENT' && (
        <>
          <div className="w-full max-w-[400px] mb-4 px-2 mt-4 sm:mt-0">
            <div className="flex justify-between items-center mb-4">
              <div className="flex flex-col">
                <h1 className="text-2xl sm:text-3xl font-black italic text-white bungee tracking-tighter leading-none">合約巡演</h1>
                <p className="text-[10px] sm:text-xs font-black text-indigo-500 uppercase italic mt-1">{selectedLevel.name}</p>
              </div>
              
              <div className="flex flex-col items-center">
                <div className="text-[10px] font-black text-neutral-500 uppercase bungee mb-0.5">合約時效</div>
                <div className={`text-3xl sm:text-4xl font-black bungee leading-none tracking-tighter ${timeLeft <= 30 ? 'text-rose-600 animate-pulse' : 'text-white'}`}>
                  {formatTime(timeLeft)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-[10px] font-black text-neutral-500 uppercase bungee mb-0.5">累計利潤</div>
                <div className={`text-2xl sm:text-3xl font-black bungee leading-none ${score < totalDebt ? 'text-rose-500' : 'text-cyan-400'}`}>{score}</div>
              </div>
            </div>

            <div className={`p-4 sm:p-6 rounded-[32px] sm:rounded-[40px] border-2 transition-all duration-700 backdrop-blur-2xl relative overflow-hidden shadow-xl
              ${gameState === 'BOMBING' ? 'border-red-500 bg-red-950/20' : 
                gameState === 'SPARKLING' ? 'border-cyan-400 bg-cyan-950/20' : 
                gameState === 'GRAFFITI' ? 'border-indigo-400 bg-indigo-950/20' : 'bg-neutral-900/40 border-neutral-800'}
            `}>
              <div className="absolute top-0 left-0 h-1 bg-white/20 w-full overflow-hidden">
                <div 
                   className={`h-full transition-all duration-1000 ${timeLeft <= 30 ? 'bg-rose-600' : 'bg-indigo-500'}`} 
                   style={{ width: `${(timeLeft / selectedLevel.time) * 100}%` }}
                />
              </div>

              <div className="flex items-center justify-between mb-4 mt-1">
                <div className="flex items-center gap-4 relative">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 bg-black rounded-3xl border-4 border-white/20 flex flex-col items-center justify-center text-4xl sm:text-5xl shadow-2xl relative overflow-hidden group">
                     <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 via-transparent to-purple-500 opacity-30 animate-spin-slow pointer-events-none" />
                     <span className="animate-pulse z-10">{targetColor}</span>
                     <div className="absolute bottom-0 w-full bg-white/10 py-0.5 text-[7px] font-black text-center bungee tracking-widest text-white/60">TARGET</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-neutral-400 uppercase tracking-widest bungee mb-1">目標花色</div>
                    <div className="text-xs font-bold text-white bg-indigo-600/40 px-2 py-0.5 rounded-full inline-block">能量 +2</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] font-black text-indigo-400 uppercase tracking-tighter mb-1">單步工資</div>
                  <div className="text-lg sm:text-xl font-black text-rose-500 bungee italic">-{lastJokerCountRef.current * ACTION_COST_PER_JOKER}</div>
                </div>
              </div>

              <div className="flex items-center gap-3 px-1">
                <div className="flex-1">
                  <div className="flex justify-between text-[9px] font-black text-neutral-500 uppercase mb-1.5 italic">
                    <span>進度: {lastJokerCountRef.current}/{selectedLevel.req}</span>
                    <span className={lastJokerCountRef.current < selectedLevel.req ? 'text-rose-500' : 'text-green-500'}>{missingCount > 0 ? `缺: ${missingCount}` : `超: ${extraCount}`}</span>
                  </div>
                  <div className="h-2 w-full bg-black/60 rounded-full overflow-hidden border border-neutral-800">
                    <div className={`h-full transition-all duration-700 ${lastJokerCountRef.current < selectedLevel.req ? 'bg-rose-600' : 'bg-green-600'}`} style={{ width: `${Math.min(100, (lastJokerCountRef.current/selectedLevel.req)*100)}%` }} />
                  </div>
                </div>
                <button onClick={() => startStampede(lastJokerCountRef.current, true)} className="px-3 py-2 bg-neutral-800 rounded-xl text-[10px] font-black text-neutral-400 active:scale-95">終止</button>
              </div>
              
              {['BOMBING', 'SPARKLING', 'GRAFFITI'].includes(gameState) && (
                 <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center animate-in text-center p-4">
                    <div className={`text-xl sm:text-3xl font-black bungee tracking-widest mb-1 ${gameState === 'BOMBING' ? 'text-red-500' : gameState === 'SPARKLING' ? 'text-cyan-400' : 'text-indigo-400'}`}>
                      {gameState === 'BOMBING' ? '💣 炸彈模式' : gameState === 'SPARKLING' ? '✨ 閃光模式' : '🎨 塗鴉模式'}
                    </div>
                    <div className="text-[10px] sm:text-xs text-white font-bold tracking-widest opacity-90">
                      {gameState === 'BOMBING' ? '點擊珠子引發區域爆炸' : gameState === 'SPARKLING' ? '點擊珠子消除全場同色' : '點擊珠子變為目標花色'}
                    </div>
                 </div>
              )}
            </div>
          </div>

          <div className={`relative p-2 sm:p-3 bg-neutral-900/30 backdrop-blur-2xl rounded-[40px] sm:rounded-[48px] border-2 transition-all duration-700
            ${gameState === 'BOMBING' ? 'border-red-500/40' : gameState === 'SPARKLING' ? 'border-cyan-400/40' : gameState === 'GRAFFITI' ? 'border-indigo-400/40' : 'border-neutral-800/60'}
          `}>
            <div className="absolute inset-0 pointer-events-none z-[60] overflow-hidden rounded-[40px] sm:rounded-[48px]">
              {particles.map(p => (
                <div key={p.id} style={{ left: p.x, top: p.y, width: p.size, height: p.size, backgroundColor: p.color, opacity: p.life / 100, boxShadow: p.spark ? `0 0 8px ${p.color}` : 'none' }} className="absolute rounded-full" />
              ))}
              {floatingTexts.map(t => (
                <div key={t.id} style={{ left: t.x, top: t.y, color: t.color, opacity: t.life / 100, transform: `translate(-50%, -50%) scale(${1.2 - t.life / 200})` }} className="absolute font-black text-xl sm:text-2xl italic bungee drop-shadow-lg whitespace-nowrap">{t.text}</div>
              ))}
            </div>
            <div ref={boardRef} className="grid grid-cols-6 grid-rows-7 gap-1 sm:gap-1.5 w-[85vw] max-w-[340px] aspect-[6/7]">
              {grid.map((row, r) => row.map((cell, c) => (
                <div key={`${r}-${c}`} onClick={() => handleCellClick(r, c)}
                  className={`relative flex items-center justify-center bg-black/30 rounded-xl sm:rounded-2xl border transition-all duration-300 cursor-pointer
                    ${selected?.r === r && selected?.c === c ? 'border-white scale-110 z-20 bg-white/10' : 'border-neutral-800/40'}
                    ${!cell ? 'scale-0' : 'scale-100'}
                  `}
                  style={{ 
                    boxShadow: cell === targetColor ? colorGlowMap[cell] : 'none',
                    borderColor: cell === targetColor ? 'rgba(255,255,255,0.4)' : undefined
                  }}
                >
                  <span className={`text-2xl sm:text-4xl drop-shadow-md transition-transform ${cell === JOKER ? 'animate-bounce-slow' : ''} ${cell === targetColor ? 'scale-110' : ''}`}>{cell}</span>
                  {cell === targetColor && <div className="absolute inset-0.5 sm:inset-1 border-2 border-white/30 rounded-lg pointer-events-none animate-pulse" />}
                </div>
              )))}
            </div>
          </div>

          <div className="mt-6 sm:mt-8 flex gap-3 sm:gap-4 w-full max-w-[400px] px-2 items-center mb-safe">
            <button onClick={() => setGameState('START_SCREEN')} className="flex-1 py-4 bg-neutral-900 rounded-3xl text-neutral-500 font-black bungee text-[10px] sm:text-xs tracking-widest active:scale-95 uppercase">Menu</button>
            <button 
              onClick={handleRecruitJoker}
              disabled={gameState !== 'IDLE' || score < RECRUIT_COST}
              className={`group flex flex-col items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-[32px] border-2 transition-all active:scale-90
                ${gameState === 'IDLE' && score >= RECRUIT_COST 
                  ? 'bg-indigo-600/20 border-indigo-500 shadow-lg shadow-indigo-500/20' 
                  : 'bg-neutral-900 border-neutral-800 opacity-50 grayscale cursor-not-allowed'}
              `}
            >
              <span className="text-2xl sm:text-3xl group-hover:animate-bounce">🤡</span>
              <span className={`text-[10px] font-black bungee mt-1 ${score >= RECRUIT_COST ? 'text-indigo-400' : 'text-neutral-500'}`}>{RECRUIT_COST}</span>
            </button>
            <button onClick={() => setIsMuted(!isMuted)} className="w-14 h-14 sm:w-16 sm:h-16 bg-neutral-900 rounded-3xl flex items-center justify-center text-2xl active:scale-90">{isMuted ? '🔇' : '🔔'}</button>
            <button onClick={() => setShowHelp(true)} className="w-14 h-14 sm:w-16 sm:h-16 bg-neutral-900 rounded-3xl flex items-center justify-center text-2xl text-indigo-500 active:scale-90 font-black">?</button>
          </div>
        </>
      )}

      <style>{`
        @keyframes bounce-slow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        .animate-bounce-slow { animation: bounce-slow 4s infinite ease-in-out; }
        .animate-in { animation: in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes in { from { opacity: 0; transform: scale(0.9) translateY(20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spin-slow 8s linear infinite; }
        .mb-safe { margin-bottom: env(safe-area-inset-bottom, 0px); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #4f46e5; border-radius: 10px; }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<BallGame />);
}
