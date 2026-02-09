
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
const JOKER_COST = 500; 
const ACTION_COST_PER_JOKER = 50; 
const BONUS_PER_JOKER = 500; 
const BASE_RECRUIT_COST = 1000;
const RECRUIT_INCREMENT = 500;
const JOKER_EXIT_BONUS = 500; 

const FIREWORK_COLORS = ['#ff5e7d', '#fbbf24', '#3b82f6', '#22c55e', '#f8fafc', '#a855f7', '#f97316']; // 🔴🟡🔵🟢⚪🟣🟠

const LEVELS = [
  { id: 'family', name: '家庭派對', req: 3, time: 120, desc: '溫馨慶祝', color: 'from-green-500 to-emerald-700' },
  { id: 'community', name: '社區巡演', req: 7, time: 180, desc: '街頭藝術', color: 'from-blue-500 to-indigo-700' },
  { id: 'festival', name: '慶典盛會', req: 12, time: 180, desc: '嘉年華', color: 'from-purple-500 to-rose-700' },
];

type GameState = 'START_SCREEN' | 'IDLE' | 'SWAPPING' | 'MATCHING' | 'FALLING' | 'BOMBING' | 'SPARKLING' | 'GRAFFITI' | 'STAMPEDE' | 'SETTLEMENT' | 'CELEBRATION';

interface Pos { r: number; c: number; }
interface Particle { 
  id: number; x: number; y: number; vx: number; vy: number; 
  color: string; life: number; size: number; spark: boolean; 
  type?: 'ember' | 'ring' | 'trail' | 'joker' | 'grand_trail' | 'spiral_joker' | 'totem_spark' | 'totem_core' | 'rocket' | 'smoke' | 'wheel_spoke' | 'wheel_spark' | 'electricity' | 'piston_ring';
  rotation?: number;
  rv?: number;
  angle?: number;
  radius?: number;
  opacity?: number;
}
interface Performer { id: number; x: number; y: number; vx: number; vy: number; rotation: number; rv: number; rocketTimer: number; }
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
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [targetColor, setTargetColor] = useState<string>(ALL_BALL_TYPES[0]);
  const [charge, setCharge] = useState(0);
  const [bouncingJokers, setBouncingJokers] = useState<BouncingJoker[]>([]);
  const [isSurrender, setIsSurrender] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [aiReview, setAiReview] = useState<{grade: string, tag: string, tagEn: string}>({grade: '-', tag: '正在鑑定...', tagEn: 'EVALUATING'});
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(180);
  const [shake, setShake] = useState(false);
  const [celebrationIndex, setCelebrationIndex] = useState(0);
  
  const particleIdRef = useRef(0);
  const floatingTextIdRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const lastJokerCountRef = useRef(0);

  const getAvailableBalls = useCallback(() => {
    return ALL_BALL_TYPES.slice(0, 5); 
  }, []);

  const jokerCount = grid.flat().filter(cell => cell === JOKER).length;
  lastJokerCountRef.current = jokerCount;

  const currentRecruitCost = BASE_RECRUIT_COST + (jokerCount * RECRUIT_INCREMENT);
  const missingCount = Math.max(0, selectedLevel.req - jokerCount);
  const extraCount = Math.max(0, jokerCount - selectedLevel.req);
  
  const calculatePenalty = () => {
    if (missingCount <= 0) return 0;
    const basePenaltyPerPerson = selectedLevel.req * 1000;
    return missingCount * basePenaltyPerPerson;
  };

  const baseCost = jokerCount * JOKER_COST;
  const penaltyDebt = calculatePenalty();
  const bonusCredit = extraCount * BONUS_PER_JOKER;
  const totalDebt = baseCost + penaltyDebt - bonusCredit;
  const isSuccess = score >= totalDebt;
  const netProfit = score - totalDebt;

  const wasTargetClearedRef = useRef(false);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    let timer: number;
    const activeStates: GameState[] = ['IDLE', 'SWAPPING', 'MATCHING', 'FALLING', 'BOMBING', 'SPARKLING', 'GRAFFITI'];
    if (activeStates.includes(gameState)) {
      timer = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            handleFinalSequence(lastJokerCountRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState]);

  const generateAIComment = async (profit: number) => {
    setIsAiLoading(true);
    setAiReview({grade: '-', tag: '結算中...', tagEn: 'SETTLING'});
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `你是一個冷酷的嘉年華大老闆。玩家本次的盈餘為：${profit}。請根據盈餘判定等級並從以下標籤中選出最合適的一個。如果是獲利，選「奸商」或「打工人」。如果是虧損，選「賠錢」、「慈善家」或「蜘蛛人」。`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              grade: { type: Type.STRING, description: "評級 S, A, B, C, D" },
              tag: { type: Type.STRING, description: "中文標籤：奸商, 打工人, 賠錢, 慈善家, 蜘蛛人" },
              tagEn: { type: Type.STRING, description: "對應的英文標籤：PROFITEER, SALARYMAN, DEFICIT, PHILANTHROPIST, SPIDER-MAN" }
            },
            required: ["grade", "tag", "tagEn"]
          }
        }
      });
      const res = JSON.parse(response.text || '{"grade":"F","tag":"打工人","tagEn":"WORKER"}');
      setAiReview(res);
    } catch (error) {
      const fallback = profit > 1000 ? {grade:'S', tag:'奸商', tagEn:'PROFITEER'} : profit > 0 ? {grade:'B', tag:'打工人', tagEn:'SALARYMAN'} : profit > -2000 ? {grade:'C', tag:'賠錢', tagEn:'DEFICIT'} : {grade:'D', tag:'慈善家', tagEn:'PHILANTHROPIST'};
      setAiReview(fallback);
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

  const triggerShake = (intensity = 'mild') => {
    setShake(true);
    setTimeout(() => setShake(false), intensity === 'strong' ? 500 : 200);
  };

  const createExplosion = (r: number, c: number, color: string, effectType: 'normal' | 'bomb' | 'firework' | 'joker_exit' | 'grand_finale' | 'grand_wheel' = 'normal') => {
    const rect = boardRef.current?.getBoundingClientRect() || { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
    const cellW = rect.width / COLS;
    const cellH = rect.height / ROWS;
    
    const centerX = (effectType === 'grand_finale' || effectType === 'grand_wheel') ? r : (c + 0.5) * cellW;
    const centerY = (effectType === 'grand_finale' || effectType === 'grand_wheel') ? c : (r + 0.5) * cellH;

    const newParticles: Particle[] = [];
    const colorMap: Record<string, string> = {
      '🔴': '#ff5e7d', '🟡': '#fbbf24', '🔵': '#3b82f6', 
      '🟢': '#22c55e', '⚪': '#f8fafc', '🟣': '#a855f7', '🟠': '#f97316',
      [JOKER]: '#6366f1'
    };
    const baseColor = colorMap[color] || color;

    if (effectType === 'grand_wheel') {
      triggerShake('strong');
      const numAxes = 7;
      const particlesPerAxis = 50;
      FIREWORK_COLORS.forEach((axisColor, axisIdx) => {
        const angle = (axisIdx / numAxes) * Math.PI * 2;
        for (let i = 0; i < particlesPerAxis; i++) {
            const speed = (i / particlesPerAxis) * 25 + 2;
            newParticles.push({
                id: particleIdRef.current++,
                x: centerX, y: centerY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                color: axisColor, life: 300, size: 8 + Math.random() * 4, spark: true, type: 'wheel_spoke'
            });
        }
      });
      for (let i = 1; i <= 4; i++) {
        newParticles.push({
          id: particleIdRef.current++,
          x: centerX, y: centerY, vx: 0, vy: 0,
          color: '#ffffff', life: 150, size: i * 80, spark: false, type: 'piston_ring'
        });
      }
      for (let i = 0; i < 30; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 50 + Math.random() * 150;
        newParticles.push({
          id: particleIdRef.current++,
          x: centerX + Math.cos(ang) * rad, y: centerY + Math.sin(ang) * rad,
          vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20,
          color: '#4fc3f7', life: 40, size: 4, spark: true, type: 'electricity'
        });
      }
      playSound(100, 'square', 0.8, 0.4);
    } else if (effectType === 'grand_finale') {
      triggerShake('strong');
      const counts = [20, 30];
      counts.forEach((armCount, ringIdx) => {
        for (let arm = 0; arm < armCount; arm++) {
          const angle = (arm / armCount) * Math.PI * 2;
          const speed = (ringIdx + 1) * 7 + Math.random() * 5;
          newParticles.push({
            id: particleIdRef.current++,
            x: centerX, y: centerY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            color: baseColor, life: 300, size: 4 + Math.random() * 6, spark: true, type: 'grand_trail'
          });
        }
      });
    } else if (effectType === 'joker_exit') {
        const angle = Math.random() * Math.PI * 2;
        const speed = 15 + Math.random() * 10;
        newParticles.push({
            id: particleIdRef.current++,
            x: centerX, y: centerY,
            vx: Math.cos(angle) * speed,
            vy: -speed - Math.random() * 10,
            color: baseColor, life: 150, size: 40, spark: true, type: 'joker',
            rotation: Math.random() * 360, rv: (Math.random() - 0.5) * 40
        });
    } else if (effectType === 'bomb') {
      triggerShake();
      newParticles.push({
        id: particleIdRef.current++,
        x: centerX, y: centerY, vx: 0, vy: 0,
        color: baseColor, life: 100, size: 20, spark: false, type: 'ring'
      });
      for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 8;
        newParticles.push({
          id: particleIdRef.current++,
          x: centerX, y: centerY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          color: baseColor, life: 100, size: 3 + Math.random() * 3, spark: true
        });
      }
    } else if (effectType === 'firework') {
      triggerShake();
      const numArms = 8;
      const particlesPerArm = 12;
      for (let arm = 0; arm < numArms; arm++) {
        for (let i = 0; i < particlesPerArm; i++) {
          const angle = (arm / numArms) * Math.PI * 2;
          const speed = (i / particlesPerArm) * 12 + 2;
          newParticles.push({
            id: particleIdRef.current++,
            x: centerX, y: centerY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            color: baseColor, life: 150, size: 2 + Math.random() * 2, spark: true, type: 'trail'
          });
        }
      }
    } else {
      for (let i = 0; i < 12; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 5;
        newParticles.push({
          id: particleIdRef.current++,
          x: centerX, y: centerY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          color: baseColor, life: 80, size: 2 + Math.random() * 3, spark: Math.random() > 0.8
        });
      }
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
    let newGrid: (string | null)[][] = [];
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
    setPerformers([]);
    setIsSurrender(false);
    setTargetColor(availableBalls[Math.floor(Math.random() * availableBalls.length)]);
    wasTargetClearedRef.current = false;
    setCelebrationIndex(0);
  }, [getAvailableBalls]);

  useEffect(() => {
    const timer = setInterval(() => {
      setParticles(prev => prev.map(p => {
        if (p.type === 'ring') return { ...p, size: p.size + 18, life: p.life - 8 };
        if (p.type === 'piston_ring') return { ...p, size: p.size + (p.life > 75 ? 25 : -10), life: p.life - 6, opacity: p.life / 150 };
        if (p.type === 'smoke') return { ...p, x: p.x + p.vx, y: p.y + p.vy, size: p.size + 1.2, life: p.life - 3, opacity: (p.life / 60) };
        if (p.type === 'electricity') return { ...p, x: p.x + (Math.random()-0.5)*30, y: p.y + (Math.random()-0.5)*30, life: p.life - 5 };
        if (p.type === 'rocket') {
            const nextX = p.x + p.vx;
            const nextY = p.y + p.vy;
            if (Math.random() > 0.2) {
                setParticles(trail => [...trail, {
                    id: particleIdRef.current++,
                    x: nextX, y: nextY, vx: (Math.random()-0.5)*3, vy: 3,
                    color: '#ffffff', life: 60, size: 10, spark: false, type: 'smoke'
                }]);
            }
            if (p.life <= 2) {
                createExplosion(window.innerWidth / 2, window.innerHeight / 2, JOKER, 'grand_wheel');
                return { ...p, life: 0 };
            }
            return { ...p, x: nextX, y: nextY, life: p.life - 1.5 };
        }
        if (p.type === 'wheel_spoke' || p.type === 'grand_trail') return { ...p, x: p.x + p.vx, y: p.y + p.vy, vx: p.vx * 0.97, vy: p.vy * 0.97, life: p.life - 1.2 };
        if (p.type === 'joker') return { ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + 0.8, rotation: (p.rotation || 0) + (p.rv || 0), life: p.life - 2 };
        return { ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + 0.15, life: p.life - 4 };
      }).filter(p => p.life > 0));

      setPerformers(prev => prev.map(p => {
          let nextX = p.x + p.vx;
          let nextY = p.y + p.vy;
          let nextVx = p.vx;
          let nextVy = p.vy;
          const pad = 80;
          if (nextX < pad || nextX > window.innerWidth - pad) nextVx *= -1;
          if (nextY < pad || nextY > window.innerHeight - pad) nextVy *= -1;

          let nextTimer = p.rocketTimer - 1;
          if (nextTimer <= 0) {
              const rId = particleIdRef.current++;
              const targetX = window.innerWidth / 2;
              const targetY = window.innerHeight / 2;
              const angle = Math.atan2(targetY - p.y, targetX - p.x);
              const dist = Math.sqrt(Math.pow(targetX - p.x, 2) + Math.pow(targetY - p.y, 2));
              const speed = dist / 60; 
              setParticles(parts => [...parts, {
                  id: rId, x: p.x, y: p.y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
                  color: '#fff', life: 60, size: 55, spark: true, type: 'rocket'
              }]);
              playSound(600, 'square', 0.3, 0.1);
              nextTimer = 100 + Math.random()*150;
          }

          return { ...p, x: nextX, y: nextY, vx: nextVx, vy: nextVy, rotation: p.rotation + p.rv, rocketTimer: nextTimer };
      }));

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
    setPerformers([]);
    const jokers: BouncingJoker[] = [];
    const emoji = count === 0 && surrenderMode ? SAD_JOKER : JOKER;
    for (let i = 0; i < Math.max(count, 12); i++) {
      jokers.push({
        id: i, x: Math.random() * (window.innerWidth - 60), y: Math.random() * (window.innerHeight - 60),
        vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, size: 60 + Math.random() * 40,
        rotation: Math.random() * 360, rv: (Math.random() - 0.5) * 25, emoji
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
          createExplosion(p.r, p.c, color!, line.length >= 5 ? 'firework' : line.length === 4 ? 'bomb' : 'normal');
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
  }, [combo, targetColor, getAvailableBalls, charge]);

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
      if (color === JOKER) {
          setScore(s => s + JOKER_EXIT_BONUS);
          createFloatingText(r, c, `+${JOKER_EXIT_BONUS} 退場獎勵`, '#fbbf24');
          createExplosion(r, c, color, 'joker_exit');
          playSound(600, 'triangle', 0.3);
      } else {
          createExplosion(r, c, color, 'bomb');
          playSound(700, 'square', 0.4);
      }
      setGrid(nextGrid);
      processMatches(nextGrid);
      return;
    }
    if (gameState === 'SPARKLING' && color) {
      applyActionCost();
      let jokersCleared = 0;
      if (color === targetColor || grid.flat().some(cell => cell === color && cell === targetColor)) wasTargetClearedRef.current = true;
      const nextGrid = grid.map((row, ri) => row.map((cell, ci) => {
          if (cell === color || cell === JOKER) {
              if (cell === JOKER) { jokersCleared++; createExplosion(ri, ci, cell!, 'joker_exit'); }
              else { createExplosion(ri, ci, cell!, 'firework'); }
              return null;
          }
          return cell;
      }));
      if (jokersCleared > 0) {
          const totalBonus = jokersCleared * JOKER_EXIT_BONUS;
          setScore(s => s + totalBonus);
          createFloatingText(r, c, `+${totalBonus} 全員飛天`, '#fbbf24');
          playSound(800, 'triangle', 0.5);
      } else { playSound(900, 'square', 0.5); }
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
    const cost = BASE_RECRUIT_COST + (lastJokerCountRef.current * RECRUIT_INCREMENT);
    if (gameState !== 'IDLE' || score < cost) return;
    const nonJokerPositions: Pos[] = [];
    grid.forEach((row, r) => row.forEach((cell, c) => {
      if (cell && cell !== JOKER) nonJokerPositions.push({ r, c });
    }));
    if (nonJokerPositions.length === 0) return;
    const target = nonJokerPositions[Math.floor(Math.random() * nonJokerPositions.length)];
    const nextGrid = grid.map(row => [...row]);
    nextGrid[target.r][target.c] = JOKER;
    setScore(s => s - cost);
    setGrid(nextGrid);
    createExplosion(target.r, target.c, JOKER, 'bomb');
    createFloatingText(target.r, target.c, `-${cost}`, '#ef4444');
    playSound(150, 'square', 0.4, 0.2);
  };

  const handleFinalSequence = async (count: number) => {
    setGameState('CELEBRATION');
    const board = boardRef.current?.getBoundingClientRect();
    if (!board) { startStampede(count); return; }

    const jokerPerformers: Performer[] = [];
    grid.forEach((row, r) => row.forEach((cell, c) => {
      if (cell === JOKER) {
        const cellW = board.width / COLS;
        const cellH = board.height / ROWS;
        jokerPerformers.push({
          id: jokerPerformers.length,
          x: board.left + (c + 0.5) * cellW,
          y: board.top + (r + 0.5) * cellH,
          vx: (Math.random()-0.5)*15,
          vy: (Math.random()-0.5)*15,
          rotation: 0,
          rv: (Math.random()-0.5)*20,
          rocketTimer: 20 + Math.random()*50
        });
      }
    }));

    if (jokerPerformers.length === 0) {
        jokerPerformers.push({ id: 0, x: window.innerWidth/2, y: window.innerHeight/2, vx: 10, vy: -10, rotation: 0, rv: 15, rocketTimer: 15 });
    }

    setPerformers(jokerPerformers);
    playSound(400, 'triangle', 1.0, 0.5);
    setGrid(Array(ROWS).fill(null).map(() => Array(COLS).fill(null)));

    const performanceDuration = 7000; 
    let elapsed = 0;
    const interval = 1000;
    while(elapsed < performanceDuration) {
        await new Promise(r => setTimeout(r, interval));
        elapsed += interval;
    }

    setPerformers([]);
    startStampede(count, false);
  };

  const gradeColors: Record<string, string> = {
    'S': 'text-cyan-400 drop-shadow-[0_0_30px_rgba(34,211,238,0.8)]',
    'A': 'text-emerald-400 drop-shadow-[0_0_25px_rgba(52,211,153,0.7)]',
    'B': 'text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.6)]',
    'C': 'text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.5)]',
    'D': 'text-rose-600 drop-shadow-[0_0_15px_rgba(225,29,72,0.5)]',
    '-': 'text-neutral-600'
  };

  const tagColors: Record<string, string> = {
    '奸商': 'from-yellow-400 to-amber-600',
    '打工人': 'from-blue-400 to-indigo-600',
    '賠錢': 'from-orange-400 to-rose-600',
    '慈善家': 'from-purple-400 to-fuchsia-600',
    '蜘蛛人': 'from-red-600 to-blue-800'
  };

  const colorGlowMap: Record<string, string> = {
    '🔴': '0 0 15px #ff5e7d', '🟡': '0 0 15px #fbbf24', '🔵': '0 0 15px #3b82f6', 
    '🟢': '0 0 15px #22c55e', '⚪': '0 0 15px #f8fafc', '🟣': '0 0 15px #a855f7', '🟠': '0 0 15px #f97316'
  };

  return (
    <div className={`w-full h-full flex flex-col items-center justify-center p-2 sm:p-4 transition-all duration-1000 select-none overflow-hidden relative ${gameState === 'STAMPEDE' || gameState === 'CELEBRATION' ? 'bg-[#000]' : 'bg-[#050505]'} ${shake ? 'animate-shake' : ''}`} style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))' }}>
      
      {gameState === 'CELEBRATION' && (
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none animate-in">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[180vw] h-[180vw] bg-[radial-gradient(circle,rgba(255,255,255,0.12)_0%,transparent_60%)] animate-pulse" />
          <div className="absolute inset-0 bg-black/80" />
        </div>
      )}

      {gameState === 'START_SCREEN' && (
        <div className="fixed inset-0 z-[400] bg-black/95 flex flex-col items-center justify-center p-6 overflow-y-auto" style={{ paddingTop: 'calc(2rem + env(safe-area-inset-top, 0px))' }}>
          <div className="mb-8 text-center animate-in">
             <h1 className="text-5xl sm:text-7xl font-black italic text-white bungee tracking-tighter mb-2 text-glow">小丑大遊行</h1>
             <p className="text-indigo-500 font-black tracking-[0.3em] uppercase text-sm sm:text-lg">請選擇演出合約</p>
          </div>
          <div className="grid gap-4 w-full max-w-lg">
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
              <h3 className="text-2xl font-black bungee italic text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 to-purple-500">營運 SOP</h3>
              <button onClick={() => setShowHelp(false)} className="text-neutral-500 hover:text-white transition-colors text-2xl font-black bungee">×</button>
            </div>
            <div className="space-y-6 overflow-y-auto max-h-[60vh] pr-2 custom-scrollbar text-xs sm:text-sm">
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center font-black bungee text-[10px]">01</span>
                  <h4 className="text-indigo-400 bungee uppercase tracking-widest font-black">產值與模式</h4>
                </div>
                <div className="ml-8 space-y-2 text-neutral-300">
                  <p>• <span className="text-red-500 font-bold">炸彈模式</span>：區域爆炸並驅逐小丑。</p>
                  <p>• <span className="text-cyan-400 font-bold">閃光模式</span>：全員飛天巨量積分。</p>
                  <p>• <span className="text-indigo-400 font-bold">塗鴉模式</span>：精準變更珠子顏色。</p>
                </div>
              </section>
              <section className="space-y-3 border-t border-neutral-800 pt-4">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-rose-600 flex items-center justify-center font-black bungee text-[10px]">02</span>
                  <h4 className="text-rose-500 bungee uppercase tracking-widest font-black">結算慶典</h4>
                </div>
                <div className="ml-8 space-y-1 text-neutral-400 italic text-[10px] sm:text-[11px]">
                  <p>• <span className="text-cyan-400 font-black underline">謝幕演出</span>：小丑變身表演者，發射巨大沖天炮精確升空綻放「七色大華輪」。</p>
                  <p>• <span className="text-yellow-400 font-black underline">營運鑑定</span>：根據最終盈餘，賦予你「奸商」或「蜘蛛人」等專屬鑑定標籤。</p>
                </div>
              </section>
            </div>
            <button onClick={() => setShowHelp(false)} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xl hover:bg-indigo-500 active:scale-95 transition-all bungee shadow-[0_0_20px_rgba(79,70,229,0.4)]">明白了，開始營運</button>
          </div>
        </div>
      )}

      {(gameState === 'STAMPEDE' || gameState === 'CELEBRATION') && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center pointer-events-none">
          {bouncingJokers.map(j => (
            <div key={j.id} style={{ left: j.x, top: j.y, width: j.size, height: j.size, transform: `rotate(${j.rotation}deg)` }} className="absolute flex items-center justify-center text-4xl sm:text-6xl animate-pulse">
              <span>{j.emoji}</span>
            </div>
          ))}
          {performers.map(p => (
              <div key={p.id} style={{ left: p.x, top: p.y, transform: `translate(-50%, -50%) rotate(${p.rotation}deg)` }} className="absolute flex items-center justify-center text-6xl sm:text-8xl drop-shadow-[0_0_30px_rgba(255,255,255,0.6)] animate-bounce">
                  <span>🤡</span>
              </div>
          ))}
          <div className="relative z-[110] text-center pointer-events-auto">
            {gameState === 'CELEBRATION' ? (
                <div className="animate-in flex flex-col items-center">
                   <div className="mb-10 px-10 py-4 bg-white/10 backdrop-blur-xl rounded-full border-2 border-white/20 animate-pulse">
                      <span className="text-white bungee tracking-[0.3em] text-xl">盛典頂點：幾何大華輪</span>
                   </div>
                   <h2 className="text-6xl sm:text-9xl font-black italic text-cyan-400 bungee mb-6 drop-shadow-[0_0_60px_rgba(34,211,238,1)] scale-110">表演進行中</h2>
                   <p className="text-white font-black bungee tracking-[0.6em] text-2xl uppercase opacity-100 animate-pulse">Geometric Totem Wheels</p>
                </div>
            ) : (
                <div className="animate-in flex flex-col items-center">
                    <h2 className="text-6xl sm:text-9xl font-black italic text-white bungee mb-12 animate-pulse">{timeLeft === 0 ? '時間結束！' : '巡演完美謝幕'}</h2>
                    <button 
                        onClick={() => {
                            setGameState('SETTLEMENT');
                            generateAIComment(netProfit);
                        }} 
                        className="px-16 py-8 bg-white text-black font-black text-4xl sm:text-5xl rounded-full shadow-[0_0_60px_rgba(255,255,255,0.4)] bungee active:scale-90 transition-all hover:scale-105"
                    >
                        獲利結算 ➔
                    </button>
                </div>
            )}
          </div>
        </div>
      )}

      {gameState === 'SETTLEMENT' && (
        <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-center animate-in overflow-y-auto">
          <div className={`text-[10rem] sm:text-[14rem] font-black bungee italic leading-[0.8] transition-all duration-700 ${gradeColors[aiReview.grade] || gradeColors['-']}`}>
            {aiReview.grade}
          </div>
          <div className="flex flex-col items-center mt-4">
            <div className={`px-12 py-6 rounded-2xl bg-gradient-to-br ${tagColors[aiReview.tag] || 'from-neutral-600 to-neutral-800'} text-white shadow-2xl relative overflow-hidden group`}>
               <div className="absolute inset-0 bg-white/20 animate-shine-slow pointer-events-none" />
               <h3 className="text-6xl sm:text-8xl font-black bungee tracking-tighter italic drop-shadow-lg animate-pulse-fast">{aiReview.tag}</h3>
               <p className="text-sm sm:text-lg font-black bungee tracking-[0.4em] opacity-80 mt-1">{aiReview.tagEn}</p>
            </div>
          </div>
          
          <div className="mt-16 mb-10 flex gap-12 sm:gap-16 items-center">
             <div className="flex flex-col items-center">
                <span className="text-xs font-black bungee text-neutral-500 mb-2">NET PROFIT</span>
                <span className={`text-4xl sm:text-6xl font-black bungee ${netProfit >= 0 ? 'text-cyan-400' : 'text-rose-600'}`}>{netProfit > 0 ? '+' : ''}{netProfit}</span>
             </div>
             <div className="w-px h-16 bg-neutral-800" />
             <div className="flex flex-col items-center">
                <span className="text-xs font-black bungee text-neutral-500 mb-2">TOTAL SCORE</span>
                <span className="text-4xl sm:text-6xl font-black bungee text-neutral-300">{score}</span>
             </div>
          </div>
          <button onClick={() => setGameState('START_SCREEN')} className="px-20 py-6 bg-white text-black rounded-full font-black text-2xl sm:text-3xl bungee active:scale-95 transition-all shadow-[0_0_40px_rgba(255,255,255,0.2)] hover:scale-105">NEXT DEAL 🔄</button>
        </div>
      )}

      {gameState !== 'START_SCREEN' && gameState !== 'SETTLEMENT' && (
        <>
          <div className="w-full max-w-[400px] mb-4 px-2 mt-4 sm:mt-0 relative z-10">
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
                <div className={`h-full transition-all duration-1000 ${timeLeft <= 30 ? 'bg-rose-600' : 'bg-indigo-500'}`} style={{ width: `${(timeLeft / selectedLevel.time) * 100}%` }} />
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
                <button onClick={() => handleFinalSequence(lastJokerCountRef.current)} className="px-3 py-2 bg-neutral-800 rounded-xl text-[10px] font-black text-neutral-400 active:scale-95 shadow-lg">履約</button>
              </div>

              {['BOMBING', 'SPARKLING', 'GRAFFITI'].includes(gameState) && (
                 <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-in text-center p-4 z-50">
                    <div className={`text-2xl sm:text-3xl font-black bungee tracking-widest mb-2 ${gameState === 'BOMBING' ? 'text-red-500' : gameState === 'SPARKLING' ? 'text-cyan-400' : 'text-indigo-400'}`}>
                      {gameState === 'BOMBING' ? '💣 炸彈模式' : gameState === 'SPARKLING' ? '✨ 閃光模式' : '🎨 塗鴉模式'}
                    </div>
                    <div className="text-xs sm:text-sm text-white font-bold tracking-widest leading-relaxed px-4">
                      {gameState === 'BOMBING' ? '點擊任一珠子引發十字爆炸，並驅逐🤡！' : gameState === 'SPARKLING' ? '點擊珠子消除同色，觸發🤡全員飛天！' : '點擊任一珠子，將其轉化為當前目標花色！'}
                    </div>
                    <div className="mt-4 px-4 py-1.5 border border-white/20 rounded-full text-[9px] font-black text-white/50 animate-pulse bungee tracking-[0.2em]">
                      TOUCH TO ACTIVATE
                    </div>
                 </div>
              )}
            </div>
          </div>

          <div className={`relative p-2 sm:p-3 bg-neutral-900/30 backdrop-blur-2xl rounded-[40px] sm:rounded-[48px] border-2 transition-all duration-700
            ${gameState === 'BOMBING' ? 'border-red-500/40' : gameState === 'SPARKLING' ? 'border-cyan-400/40' : gameState === 'GRAFFITI' ? 'border-indigo-400/40' : 'border-neutral-800/60'}
          `}>
            <div className="absolute inset-0 pointer-events-none z-[600] overflow-hidden rounded-[40px] sm:rounded-[48px]">
              {particles.map(p => (
                <div key={p.id} 
                  style={{ 
                    left: p.x, top: p.y, width: p.size, height: p.size, 
                    backgroundColor: (p.type === 'joker' || p.type === 'spiral_joker') ? 'transparent' : p.color, 
                    opacity: p.opacity ?? (p.life / 100), 
                    boxShadow: p.spark && (p.type !== 'joker' && p.type !== 'spiral_joker') ? `0 0 45px ${p.color}, 0 0 90px ${p.color}` : 'none',
                    borderRadius: p.type === 'ring' || p.type === 'piston_ring' || p.type === 'totem_core' ? '50%' : (p.type === 'joker' || p.type === 'spiral_joker' || p.type === 'rocket') ? '0' : '2px',
                    border: (p.type === 'ring' || p.type === 'piston_ring') ? `8px solid ${p.color}` : 'none',
                    filter: p.type === 'ring' || p.type === 'piston_ring' || p.type === 'smoke' ? 'blur(5px)' : 'none',
                    transform: `translate(-50%, -50%) rotate(${p.rotation || 0}deg)`,
                    fontSize: (p.type === 'joker' || p.type === 'spiral_joker' || p.type === 'rocket') ? `${p.size}px` : 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: (p.type === 'grand_trail' || p.type === 'spiral_joker' || p.type === 'wheel_spoke' || p.type === 'electricity' || p.type === 'rocket' || p.type === 'piston_ring') ? 1000 : 1
                  }} 
                  className="absolute"
                >
                    {(p.type === 'joker' || p.type === 'spiral_joker') ? JOKER : p.type === 'rocket' ? '🚀' : null}
                </div>
              ))}
              {floatingTexts.map(t => (
                <div key={t.id} style={{ left: t.x, top: t.y, color: t.color, opacity: t.life / 100, transform: `translate(-50%, -50%) scale(${1.2 - t.life / 200})` }} className="absolute font-black text-xl sm:text-2xl italic bungee drop-shadow-lg whitespace-nowrap">{t.text}</div>
              ))}
            </div>
            <div ref={boardRef} className="grid grid-cols-6 grid-rows-7 gap-1.5 w-[85vw] max-w-[340px] aspect-[6/7]">
              {grid.map((row, r) => row.map((cell, c) => (
                <div key={`${r}-${c}`} onClick={() => handleCellClick(r, c)}
                  className={`relative flex items-center justify-center bg-black/30 rounded-xl sm:rounded-2xl border transition-all duration-300 cursor-pointer
                    ${selected?.r === r && selected?.c === c ? 'border-white scale-110 z-20 bg-white/10 shadow-[0_0_20px_rgba(255,255,255,0.2)]' : 'border-neutral-800/40'}
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

          <div className="mt-6 sm:mt-8 flex gap-3 sm:gap-4 w-full max-w-[400px] px-2 items-center mb-safe relative z-10">
            <button onClick={() => setGameState('START_SCREEN')} className="flex-1 py-4 bg-neutral-900 rounded-3xl text-neutral-500 font-black bungee text-[10px] sm:text-xs tracking-widest active:scale-95 uppercase">Menu</button>
            <button 
              onClick={handleRecruitJoker}
              disabled={gameState !== 'IDLE' || score < currentRecruitCost}
              className={`group flex flex-col items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-[32px] border-2 transition-all active:scale-90
                ${gameState === 'IDLE' && score >= currentRecruitCost ? 'bg-indigo-600/20 border-indigo-500 shadow-lg shadow-indigo-500/20' : 'bg-neutral-900 border-neutral-800 opacity-50 grayscale cursor-not-allowed'}
              `}
            >
              <span className="text-2xl sm:text-3xl group-hover:animate-bounce">🤡</span>
              <span className={`text-[10px] font-black bungee mt-1 ${score >= currentRecruitCost ? 'text-indigo-400' : 'text-neutral-500'}`}>{currentRecruitCost}</span>
            </button>
            <button onClick={() => setIsMuted(!isMuted)} className="w-14 h-14 sm:w-16 sm:h-16 bg-neutral-900 rounded-3xl flex items-center justify-center text-2xl active:scale-90">{isMuted ? '🔇' : '🔔'}</button>
            <button onClick={() => setShowHelp(true)} className="w-14 h-14 sm:w-16 sm:h-16 bg-neutral-900 rounded-3xl flex items-center justify-center text-2xl text-indigo-500 active:scale-90 font-black">?</button>
          </div>
        </>
      )}

      <style>{`
        @keyframes bounce-slow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        .animate-bounce-slow { animation: bounce-slow 4s infinite ease-in-out; }
        .animate-in { animation: in 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes in { from { opacity: 0; transform: scale(0.9) translateY(30px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spin-slow 8s linear infinite; }
        @keyframes shake {
          0%, 100% { transform: translate(0, 0); }
          5% { transform: translate(-20px, 20px); }
          10% { transform: translate(20px, -20px); }
          15% { transform: translate(-20px, -20px); }
          20% { transform: translate(20px, 20px); }
          100% { transform: translate(0, 0); }
        }
        .animate-shake { animation: shake 0.3s ease-out; }
        @keyframes shine-fast { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        .animate-shine-slow { animation: shine-fast 2s infinite linear; }
        @keyframes pulse-fast { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.9; transform: scale(1.02); } }
        .animate-pulse-fast { animation: pulse-fast 0.5s infinite ease-in-out; }
        .text-glow { text-shadow: 0 0 20px rgba(255,255,255,0.4); }
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
