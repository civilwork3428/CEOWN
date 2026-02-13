
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';

// --- 遊戲常數 ---
const COLS = 5;
const ROWS = 7;
const MAX_CELLS = COLS * ROWS;
const INITIAL_OXYGEN = 180; // 挑戰關總呼吸剩餘 180 秒
const BOMB_PENALTY = 10;    // 炸彈扣除秒數

type ItemType = 'KEY' | 'CHEST' | 'PICKAXE' | 'ROCK' | 'BOMB' | 'EMPTY';
type SkillType = 'PUSHER' | 'WIND';
type GameMode = 'TUTORIAL' | 'CHALLENGE';

interface GameItem {
  id: string;
  type: ItemType;
  value?: number;
}

type Cell = GameItem[];

type GameStatus = 'START' | 'PLAYING' | 'WON' | 'LOST';

// --- 提示文本庫 ---
const LEVEL_TIPS: Record<string, string> = {
  'TUTORIAL_1': '💡 使用「推手」將 🔑 移向 📦 吧！',
  'TUTORIAL_2': '💡 岩石 🧱 會阻擋路徑，試著繞過它們。',
  'TUTORIAL_3': '💡 十字鎬 ⛏️ 撞擊岩石 🧱 即可將其擊碎！',
  'TUTORIAL_4': '💡 注意 💣 上的數字，每次移動都會減少！',
  'CHALLENGE_DEFAULT': '💡 技巧：挑戰關中，氧氣就是生命，避開爆炸！',
  'CHALLENGE_BOMB': '💡 提示：炸彈爆炸會扣除 10 秒氧氣，請優先推離。'
};

const TombPuzzle: React.FC = () => {
  const [board, setBoard] = useState<Cell[]>([]);
  const [status, setStatus] = useState<GameStatus>('START');
  const [mode, setMode] = useState<GameMode>('TUTORIAL');
  const [level, setLevel] = useState(1);
  const [activeSkill, setActiveSkill] = useState<SkillType | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [deathReason, setDeathReason] = useState<string>('');
  const [explodingCells, setExplodingCells] = useState<Set<number>>(new Set());
  const [isShaking, setIsShaking] = useState(false);
  const [isOxygenFlashing, setIsOxygenFlashing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(INITIAL_OXYGEN);
  const [nickname, setNickname] = useState('');
  const [isNameConfirmed, setIsNameConfirmed] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const audioCtx = useRef<AudioContext | null>(null);
  const certificateRef = useRef<HTMLDivElement>(null);

  // --- 稱號邏輯 ---
  const getMightyTitle = (challengeLvl: number) => {
    if (challengeLvl === 0) return "遺跡見習生";
    if (challengeLvl <= 5) return "秘境開拓先鋒";
    if (challengeLvl <= 10) return "萬古地脈征服者";
    if (challengeLvl <= 15) return "傳說級探險宗師";
    if (challengeLvl <= 25) return "時空秩序重塑者";
    if (challengeLvl <= 40) return "虛空至高審判長";
    return "寰宇永恆創世神";
  };

  // --- 音效系統 ---
  const playSound = (freq: number, type: OscillatorType = 'sine', dur = 0.2) => {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtx.current;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.setValueAtTime(0.1, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch (e) {}
  };

  // --- 全局計時器 ---
  useEffect(() => {
    let timer: number;
    if (status === 'PLAYING' && mode === 'CHALLENGE' && !showExitConfirm && !showHelp) {
      timer = window.setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setDeathReason('OXYGEN_DEPLETED');
            setStatus('LOST');
            playSound(100, 'sawtooth', 0.5);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [status, mode, showExitConfirm, showHelp]);

  // --- 初始化關卡 ---
  const initLevel = useCallback((targetMode: GameMode, targetLvl: number, resetOxygen = false) => {
    const newBoard: Cell[] = Array(MAX_CELLS).fill(0).map(() => []);
    const addItem = (idx: number, type: ItemType, val?: number) => {
      newBoard[idx].push({ id: Math.random().toString(36).substr(2, 9), type, value: val });
    };

    setDeathReason('');
    setExplodingCells(new Set());
    setIsShaking(false);
    setIsOxygenFlashing(false);
    setIsNameConfirmed(false);
    setShowExitConfirm(false);
    setShowHelp(false);
    
    if (resetOxygen) {
      setTimeLeft(INITIAL_OXYGEN);
    }

    if (targetMode === 'TUTORIAL') {
      switch (targetLvl) {
        case 1: addItem(0, 'KEY'); addItem(34, 'CHEST'); break;
        case 2: addItem(0, 'KEY'); addItem(2, 'ROCK'); addItem(7, 'ROCK'); addItem(34, 'CHEST'); break;
        case 3: addItem(0, 'KEY'); addItem(2, 'ROCK'); addItem(12, 'PICKAXE'); addItem(34, 'CHEST'); break;
        case 4: addItem(0, 'KEY'); addItem(2, 'ROCK'); addItem(12, 'PICKAXE'); addItem(13, 'BOMB', 4); addItem(34, 'CHEST'); break;
      }
    } else {
      const rocksCount = Math.min(targetLvl, MAX_CELLS - 10);
      const bombsCount = Math.max(1, Math.floor(targetLvl / 5) + 1);

      const availableIndices = Array.from({ length: MAX_CELLS }, (_, i) => i);
      const shuffle = (arr: number[]) => arr.sort(() => Math.random() - 0.5);
      shuffle(availableIndices);

      addItem(availableIndices.pop()!, 'KEY');
      addItem(availableIndices.pop()!, 'CHEST');
      addItem(availableIndices.pop()!, 'PICKAXE');

      for (let i = 0; i < rocksCount && availableIndices.length > 0; i++) addItem(availableIndices.pop()!, 'ROCK');
      for (let i = 0; i < bombsCount && availableIndices.length > 0; i++) addItem(availableIndices.pop()!, 'BOMB', Math.max(2, 6 - Math.floor(targetLvl / 10)));
    }

    setBoard(newBoard);
    setMode(targetMode);
    setLevel(targetLvl);
    setStatus('PLAYING');
    setActiveSkill(null);
    setSelectedIdx(null);
  }, []);

  const startTutorial = () => initLevel('TUTORIAL', 1, true);
  const startChallenge = () => initLevel('CHALLENGE', 1, true);

  const isValid = (x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

  const calculateMoveStrict = (startIdx: number, dx: number, dy: number, maxDist: number, currentBoard: Cell[], movingItems: GameItem[]) => {
    let curX = startIdx % COLS, curY = Math.floor(startIdx / COLS);
    const hasKey = movingItems.some(i => i.type === 'KEY'), hasPickaxe = movingItems.some(i => i.type === 'PICKAXE');
    for (let i = 0; i < maxDist; i++) {
      const nextX = curX + dx, nextY = curY + dy;
      if (!isValid(nextX, nextY)) break;
      const nextIdx = nextY * COLS + nextX, targetCell = currentBoard[nextIdx];
      if (targetCell.length > 0) {
        const targetType = targetCell[0].type;
        if ((hasKey && targetType === 'CHEST') || (hasPickaxe && targetType === 'ROCK')) {
          curX = nextX; curY = nextY; break;
        } else break;
      }
      curX = nextX; curY = nextY;
    }
    return curY * COLS + curX;
  };

  const checkCollisions = (newBoard: Cell[]) => {
    let won = false;
    const processedBoard = newBoard.map((cell) => {
      const types = cell.map(i => i.type);
      if (types.includes('KEY') && types.includes('CHEST')) won = true;
      if (types.includes('PICKAXE') && types.includes('ROCK')) {
        playSound(300, 'square', 0.3);
        return cell.filter(i => i.type !== 'ROCK');
      }
      return cell;
    });
    if (won) { playSound(800, 'sine', 0.5); setStatus('WON'); }
    return processedBoard;
  };

  const updateBombs = async (currentBoard: Cell[]) => {
    let exploded = false;
    let explosionCount = 0;
    const nextBoard = currentBoard.map(cell => cell.map(item => {
      if (item.type === 'BOMB' && item.value !== undefined) {
        const v = item.value - 1;
        if (v <= 0) {
          exploded = true;
          explosionCount++;
        }
        return { ...item, value: v };
      }
      return item;
    }));

    if (exploded) {
      setIsShaking(true);
      playSound(50, 'sawtooth', 0.8);
      
      if (mode === 'CHALLENGE') {
        setTimeLeft(prev => Math.max(0, prev - (BOMB_PENALTY * explosionCount)));
        setIsOxygenFlashing(true);
        setTimeout(() => setIsOxygenFlashing(false), 500);
      }

      const affected = new Set<number>();
      const finalBoard = [...nextBoard];
      let chestBlown = false, keyBlown = false;

      nextBoard.forEach((cell, idx) => {
        if (cell.some(i => i.type === 'BOMB' && i.value === 0)) {
          const x = idx % COLS, y = Math.floor(idx / COLS);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (isValid(x + dx, y + dy)) {
                const tIdx = (y + dy) * COLS + (x + dx);
                affected.add(tIdx);
                if (finalBoard[tIdx].some(i => i.type === 'CHEST')) chestBlown = true;
                if (finalBoard[tIdx].some(i => i.type === 'KEY')) keyBlown = true;
                finalBoard[tIdx] = [];
              }
            }
          }
        }
      });
      setExplodingCells(affected);
      setTimeout(() => {
        setIsShaking(false); setExplodingCells(new Set());
        if (chestBlown || keyBlown) {
          setDeathReason(chestBlown && keyBlown ? 'BOTH_BLOWN' : (chestBlown ? 'CHEST_BLOWN' : 'KEY_BLOWN'));
          setStatus('LOST');
        } else if (timeLeft <= 0 && mode === 'CHALLENGE') {
          setDeathReason('OXYGEN_DEPLETED');
          setStatus('LOST');
        }
      }, 600);
      setBoard(finalBoard);
    } else setBoard(nextBoard);
  };

  const handleAction = (dx: number, dy: number) => {
    if (status !== 'PLAYING' || showExitConfirm || showHelp) return;
    if (activeSkill === 'PUSHER' && selectedIdx !== null) {
      const items = board[selectedIdx];
      if (items.length === 0) return;
      const targetIdx = calculateMoveStrict(selectedIdx, dx, dy, 2, board, items);
      if (targetIdx !== selectedIdx) {
        const nb = board.map(c => [...c]);
        nb[targetIdx] = [...nb[targetIdx], ...items]; nb[selectedIdx] = [];
        const checked = checkCollisions(nb); updateBombs(checked); playSound(400, 'sine', 0.1);
      }
    } else if (activeSkill === 'WIND') {
      const nb = board.map(c => [...c]);
      const movingGroup: { idx: number; items: GameItem[]; x: number; y: number }[] = [];
      board.forEach((c, i) => {
        const targets = c.filter(item => ['KEY', 'CHEST', 'PICKAXE', 'BOMB'].includes(item.type));
        if (targets.length > 0) movingGroup.push({ idx: i, items: targets, x: i % COLS, y: Math.floor(i / COLS) });
      });
      movingGroup.sort((a, b) => (dx > 0 ? b.x - a.x : dx < 0 ? a.x - b.x : dy > 0 ? b.y - a.y : a.y - b.y));
      movingGroup.forEach(m => {
        nb[m.idx] = nb[m.idx].filter(i => !['KEY', 'CHEST', 'PICKAXE', 'BOMB'].includes(i.type));
        const targetIdx = calculateMoveStrict(m.idx, dx, dy, 5, nb, m.items);
        nb[targetIdx] = [...nb[targetIdx], ...m.items];
      });
      const checked = checkCollisions(nb); updateBombs(checked); playSound(200, 'sine', 0.3);
    }
    setActiveSkill(null); setSelectedIdx(null);
  };

  const exportToJpg = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 600;
    canvas.height = 800;
    ctx.fillStyle = '#fcfcfc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 24;
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 36px serif';
    ctx.textAlign = 'center';
    ctx.fillText('探險結算獎狀', canvas.width / 2, 110);

    const title = mode === 'CHALLENGE' ? getMightyTitle(level) : "遺跡見習生";
    ctx.fillStyle = '#92400e';
    ctx.font = 'bold 72px serif';
    ctx.fillText(title, canvas.width / 2, 280);

    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 220, 310);
    ctx.lineTo(canvas.width / 2 + 220, 310);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.font = '24px serif';
    ctx.fillText('挑戰者', canvas.width / 2, 380);
    
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 64px serif';
    ctx.fillText(nickname || '無名英雄', canvas.width / 2, 460);

    ctx.fillStyle = '#b45309';
    ctx.font = 'bold 82px serif';
    ctx.fillText(mode === 'CHALLENGE' ? `挑戰 Lv.${level}` : `教學完成`, canvas.width / 2, 600);

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 26px serif';
    ctx.fillText('國土永續 2026年版', canvas.width / 2, 710);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px serif';
    ctx.fillText('僅供公益宣導與教育使用，未經授權不得商業轉售。', canvas.width / 2, 745);

    const link = document.createElement('a');
    link.download = `探險證書_${title}_${nickname || '冒險家'}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.9);
    link.click();
  };

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

  const renderIcon = (item: GameItem) => {
    switch (item.type) {
      case 'KEY': return <span className="text-2xl sm:text-3xl drop-shadow-lg animate-pulse">🔑</span>;
      case 'CHEST': return (
        <span className="text-2xl sm:text-3xl text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse inline-block transform hover:scale-110 transition-transform">
          📦
        </span>
      );
      case 'PICKAXE': return <span className="text-2xl sm:text-3xl">⛏️</span>;
      case 'ROCK': return <span className="text-2xl sm:text-3xl brightness-90">🧱</span>;
      case 'BOMB': return (
        <div className="relative flex items-center justify-center">
          <span className="text-2xl sm:text-3xl animate-pulse">💣</span>
          <span className={`absolute -top-1 -right-1 text-white text-[8px] font-black px-1 rounded-full border border-white ${item.value && item.value <= 1 ? 'bg-red-600 animate-ping' : 'bg-slate-700'}`}>
            {item.value}
          </span>
        </div>
      );
      default: return null;
    }
  };

  const getHintText = () => {
    if (mode === 'TUTORIAL') {
      return LEVEL_TIPS[`TUTORIAL_${level}`] || '';
    }
    const hasBomb = board.some(cell => cell.some(i => i.type === 'BOMB'));
    return hasBomb ? LEVEL_TIPS['CHALLENGE_BOMB'] : LEVEL_TIPS['CHALLENGE_DEFAULT'];
  };

  const handleNextLevel = () => {
    if (mode === 'TUTORIAL') {
      if (level < 4) {
        initLevel('TUTORIAL', level + 1);
      } else {
        startChallenge();
      }
    } else {
      initLevel('CHALLENGE', level + 1);
    }
  };

  const confirmGiveUp = () => {
    if (mode === 'TUTORIAL') {
      setStatus('START');
    } else {
      setDeathReason('MANUAL_EXIT');
      setStatus('LOST');
    }
    setShowExitConfirm(false);
    setActiveSkill(null);
    setSelectedIdx(null);
  };

  return (
    <div className={`min-h-screen bg-[#0f172a] text-slate-100 flex flex-col items-center justify-center p-2 select-none overflow-hidden transition-transform duration-75 ${isShaking ? 'scale-105 animate-shake' : ''}`}>
      
      {/* 幫助說明彈窗 */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[300] backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-slate-800 p-6 rounded-3xl border border-amber-500/50 shadow-2xl max-w-sm w-full">
            <h3 className="text-2xl font-black text-amber-500 mb-4 text-center italic">📜 探險指南</h3>
            <div className="space-y-4 text-sm text-slate-300">
              <section className="bg-slate-900/50 p-3 rounded-xl border border-slate-700">
                <p className="font-bold text-amber-400 mb-1">🏁 核心目標</p>
                <p>控制鑰匙 🔑 撞向寶箱 📦 即可通關。如果是教學關，每關都會介紹新物品！</p>
              </section>
              <section className="bg-slate-900/50 p-3 rounded-xl border border-slate-700">
                <p className="font-bold text-blue-400 mb-1">🛠️ 物品特性</p>
                <ul className="space-y-2">
                  <li className="flex gap-2"><span className="shrink-0">⛏️</span><span><strong>十字鎬</strong>：需與 🧱 同行或推向 🧱 來擊碎岩石。</span></li>
                  <li className="flex gap-2"><span className="shrink-0">💣</span><span><strong>炸彈</strong>：數字歸零即爆，會毀掉十字範圍格，且扣 10 秒氧。</span></li>
                  <li className="flex gap-2"><span className="shrink-0">🧱</span><span><strong>岩石</strong>：不可直接穿過，需移除或繞路。</span></li>
                </ul>
              </section>
              <section className="bg-slate-900/50 p-3 rounded-xl border border-slate-700">
                <p className="font-bold text-teal-400 mb-1">✨ 核心技術</p>
                <ul className="space-y-2">
                  <li className="flex gap-2"><span className="shrink-0">✋</span><span><strong>推手</strong>：選定單一格子，推動該格物品 2 格距離。</span></li>
                  <li className="flex gap-2"><span className="shrink-0">🌪️</span><span><strong>風吹</strong>：大規模位移，讓場上所有物品移動 5 格。</span></li>
                </ul>
              </section>
            </div>
            <button onClick={() => setShowHelp(false)} className="w-full mt-6 py-4 bg-amber-500 text-slate-950 font-black rounded-xl shadow-[0_4px_0_#b45309] active:translate-y-1 active:shadow-none">了解！返回探險</button>
          </div>
        </div>
      )}

      {/* 放棄確認彈窗 */}
      {showExitConfirm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[250] backdrop-blur-sm p-6">
          <div className="bg-slate-800 p-6 rounded-2xl border border-red-500/50 shadow-2xl max-w-xs w-full text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <h3 className="text-xl font-black text-slate-100 mb-2">確定放棄嗎？</h3>
            <p className="text-slate-400 text-xs mb-6">
              {mode === 'TUTORIAL' ? '放棄教學將回到主畫面。' : '放棄挑戰將直接進入結算並領取目前等級的獎狀。'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowExitConfirm(false)} className="flex-1 py-3 bg-slate-700 rounded-xl font-bold">取消</button>
              <button onClick={confirmGiveUp} className="flex-1 py-3 bg-red-600 rounded-xl font-black shadow-[0_4px_0_#991b1b]">確定放棄</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-2 text-center w-full max-w-sm relative flex flex-col items-center">
        <button 
          onClick={() => setShowExitConfirm(true)}
          className="absolute left-0 top-1 px-4 py-2 bg-red-900/60 border border-red-500/50 rounded-full text-[12px] font-black text-red-300 active:scale-95 transition-all tracking-tighter z-50 shadow-lg cursor-pointer"
        >
          🏳️ 放棄
        </button>
        <button 
          onClick={() => setShowHelp(true)}
          className="absolute right-0 top-1 px-4 py-2 bg-blue-900/60 border border-blue-500/50 rounded-full text-[12px] font-black text-blue-300 active:scale-95 transition-all tracking-tighter z-50 shadow-lg cursor-pointer"
        >
          ❓ 規則
        </button>
        <h1 className="text-2xl font-black text-amber-500 italic drop-shadow-md mt-1">
          {mode === 'TUTORIAL' ? '教學模式' : '挑戰模式'} 
          <span className="text-slate-400 text-sm not-italic ml-2">
            {mode === 'TUTORIAL' ? `${level}/4` : `Lv ${level}`}
          </span>
        </h1>
        {mode === 'CHALLENGE' && status === 'PLAYING' && (
          <div className={`mt-2 px-4 py-1 inline-block rounded-full border-2 font-mono text-xl transition-colors duration-300 ${isOxygenFlashing ? 'bg-red-600 border-white text-white scale-110' : (timeLeft <= 30 ? 'bg-red-900/40 border-red-500 text-red-400 animate-pulse' : 'bg-slate-800/80 border-amber-500/50 text-amber-400')}`}>
            🌬️ 呼吸: {formatTime(timeLeft)}
          </div>
        )}

        {/* 動態提示橫幅 */}
        {status === 'PLAYING' && (
          <div className="mt-3 w-full bg-blue-900/20 border border-blue-500/30 py-1.5 px-3 rounded-lg animate-in slide-in-from-top duration-500">
            <p className="text-[11px] text-blue-300 font-bold tracking-tight">
              {getHintText()}
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-1 bg-slate-900 p-2 rounded-xl border-4 border-slate-800 shadow-2xl my-2 relative" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {board.map((cell, idx) => (
          <div
            key={idx}
            onClick={() => status === 'PLAYING' && activeSkill === 'PUSHER' && cell.length > 0 && !showExitConfirm && !showHelp && setSelectedIdx(idx)}
            className={`w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center relative rounded-lg transition-all 
              ${selectedIdx === idx ? 'ring-2 ring-blue-500 bg-blue-500/20 scale-105 z-10' : 'bg-slate-800'}
              ${explodingCells.has(idx) ? 'bg-red-600/60 z-20 shadow-[0_0_10px_rgba(220,38,38,0.8)]' : 'border-b-2 border-black/40'}
            `}
          >
            {cell.map((item, i) => (
              <div key={item.id} className={`absolute inset-0 flex items-center justify-center ${i > 0 ? 'scale-75 translate-x-1 translate-y-1' : ''}`}>
                {renderIcon(item)}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="w-full max-w-sm flex flex-col gap-3 relative z-[100]">
        {!activeSkill ? (
          <div className="flex gap-3 justify-center">
            <button onClick={() => !showExitConfirm && !showHelp && setActiveSkill('PUSHER')} className="flex-1 py-3 bg-indigo-600 rounded-xl shadow-[0_4px_0_#3730a3] active:translate-y-1 active:shadow-none transition-all flex flex-col items-center">
              <span className="text-2xl mb-1">✋</span>
              <span className="text-[10px] font-black uppercase">推手 (2格)</span>
            </button>
            <button onClick={() => !showExitConfirm && !showHelp && setActiveSkill('WIND')} className="flex-1 py-3 bg-teal-600 rounded-xl shadow-[0_4px_0_#0d9488] active:translate-y-1 active:shadow-none transition-all flex flex-col items-center">
              <span className="text-2xl mb-1">🌪️</span>
              <span className="text-[10px] font-black uppercase">風吹 (5格)</span>
            </button>
          </div>
        ) : (
          <div className="bg-slate-800/95 p-4 rounded-2xl border-2 border-amber-500/40 flex flex-col items-center shadow-2xl relative z-[101]">
            <div className="mb-2 text-[10px] text-amber-500 font-bold uppercase tracking-widest">
              選擇方向啟動技能
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div/><button onClick={() => handleAction(0,-1)} className="w-12 h-12 bg-amber-500 rounded-lg font-black text-xl shadow-[0_4px_0_#b45309] active:translate-y-1 relative z-[102]">↑</button><div/>
              <button onClick={() => handleAction(-1,0)} className="w-12 h-12 bg-amber-500 rounded-lg font-black text-xl shadow-[0_4px_0_#b45309] active:translate-y-1 relative z-[102]">←</button>
              <button onClick={() => { setActiveSkill(null); setSelectedIdx(null); }} className="w-12 h-12 bg-slate-600 rounded-lg font-black text-lg relative z-[102]">✕</button>
              <button onClick={() => handleAction(1,0)} className="w-12 h-12 bg-amber-500 rounded-lg font-black text-xl shadow-[0_4px_0_#b45309] active:translate-y-1 relative z-[102]">→</button>
              <div/><button onClick={() => handleAction(0,1)} className="w-12 h-12 bg-amber-500 rounded-lg font-black text-xl shadow-[0_4px_0_#b45309] active:translate-y-1 relative z-[105]">↓</button><div/>
            </div>
          </div>
        )}
      </div>

      {status === 'WON' && (
        <div className="fixed inset-0 bg-indigo-900/60 flex items-center justify-center z-[150] backdrop-blur-md animate-in fade-in duration-300">
          <div className="text-center">
            <div className="text-8xl mb-4 animate-bounce">✨</div>
            <h2 className="text-5xl font-black italic text-amber-400 drop-shadow-lg mb-8 uppercase tracking-tighter">
              {mode === 'TUTORIAL' ? 'Clear!' : `Lv.${level} Clear!`}
            </h2>
            <button 
              onClick={handleNextLevel}
              className="px-12 py-5 bg-amber-500 text-slate-900 font-black text-2xl rounded-full shadow-[0_8px_0_#b45309] active:translate-y-2 active:shadow-none transition-all"
            >
              {mode === 'TUTORIAL' && level === 4 ? '開始正式挑戰' : '進入下一關'}
            </button>
          </div>
        </div>
      )}

      {status === 'LOST' && (
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-[200] backdrop-blur-xl p-4 overflow-y-auto">
          {!isNameConfirmed ? (
            <div className="bg-slate-800 p-8 rounded-[2rem] border-2 border-amber-500 shadow-2xl max-w-xs w-full animate-in zoom-in text-center">
              <div className="text-6xl mb-4">
                {deathReason === 'MANUAL_EXIT' ? '🏺' : '💨'}
              </div>
              <h2 className="text-2xl font-black text-amber-400 mb-2 italic">
                {deathReason === 'OXYGEN_DEPLETED' ? '氧氣耗盡！緊急撤離' : 
                 deathReason === 'MANUAL_EXIT' ? '探險結束！榮耀回歸' : '遺跡崩塌！'}
              </h2>
              <p className="text-slate-400 text-sm mb-6 uppercase tracking-widest font-bold">已登錄探險史冊</p>
              
              <div className="space-y-4 text-left">
                <p className="text-slate-300 text-xs font-medium">請輸入您的暱稱以領取榮耀：</p>
                <input 
                  type="text" 
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value.slice(0, 10))}
                  placeholder="英雄姓名 (限10字)"
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button 
                  onClick={() => setIsNameConfirmed(true)}
                  className="w-full py-4 bg-amber-500 text-slate-900 font-black rounded-xl active:scale-95 transition-all shadow-lg"
                >
                  領取獎狀
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center w-full max-w-sm">
              <div ref={certificateRef} className="certificate-card relative w-full bg-[#fcfcfc] border-[12px] border-[#fbbf24] p-6 shadow-2xl flex flex-col items-center text-center rounded-sm">
                <div className="absolute inset-2 border-2 border-amber-200 pointer-events-none"></div>
                <h2 className="text-xl font-serif font-black text-slate-500 mb-6 uppercase tracking-widest">探險結算獎狀</h2>
                <div className="my-4">
                  <h1 className="text-6xl font-black text-amber-800 tracking-tighter italic drop-shadow-sm leading-tight">
                    {mode === 'CHALLENGE' ? getMightyTitle(level) : "遺跡見習生"}
                  </h1>
                </div>
                <div className="w-2/3 h-1 bg-amber-400 my-8"></div>
                <div className="mb-10">
                  <p className="text-lg font-medium text-slate-500 mb-3">挑戰者</p>
                  <h3 className="text-5xl font-black text-slate-950 tracking-tight italic">
                    {nickname || '無名英雄'}
                  </h3>
                  <div className="mt-10">
                    <span className="text-7xl font-black text-amber-600 italic">
                      {mode === 'CHALLENGE' ? `Lv.${level}` : '教學完成'}
                    </span>
                  </div>
                </div>
                <div className="mt-8 space-y-1">
                  <p className="text-slate-900 font-serif font-black text-[18px]">國土永續 2026年版</p>
                  <p className="text-slate-400 font-serif text-[10px] leading-tight">
                    僅供公益宣導與教育使用，未經授權不得商業轉售。
                  </p>
                </div>
              </div>

              <div className="flex gap-2 w-full mt-6">
                <button onClick={exportToJpg} className="flex-1 py-4 bg-amber-600 text-white font-black text-sm rounded-xl tracking-widest shadow-xl active:scale-95 transition-all">
                  匯出 JPG
                </button>
                <button onClick={() => setStatus('START')} className="flex-1 py-4 bg-slate-800 text-white font-black text-sm rounded-xl tracking-widest shadow-xl active:scale-95 transition-all border border-slate-700">
                  回到主畫面
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {status === 'START' && (
        <div className="fixed inset-0 bg-[#0f172a] flex flex-col items-center justify-center z-[100] p-8 text-center bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/40 via-slate-900 to-slate-950">
          <div className="text-7xl mb-4 animate-pulse">🏺</div>
          <h1 className="text-5xl font-black text-amber-500 italic mb-4 tracking-tighter drop-shadow-lg">秘境奪寶</h1>
          
          <div className="bg-slate-800/80 p-5 rounded-3xl border border-amber-500/30 mb-8 max-w-xs text-left shadow-2xl relative">
            <div className="absolute -top-3 -right-3 bg-amber-500 text-slate-950 text-[10px] font-black px-2 py-1 rounded-lg">攻略指南</div>
            <ul className="space-y-3">
              <li className="flex gap-3 items-start">
                <span className="bg-amber-500/20 p-1 rounded">🔑</span>
                <p className="text-[11px] text-slate-300">取得鑰匙並送達寶箱即可開啟出口。</p>
              </li>
              <li className="flex gap-3 items-start">
                <span className="bg-blue-500/20 p-1 rounded">🌪️</span>
                <p className="text-[11px] text-slate-300">善用技能吹動或推開岩石障礙物。</p>
              </li>
              <li className="flex gap-3 items-start">
                <span className="bg-red-500/20 p-1 rounded">💨</span>
                <p className="text-[11px] text-slate-300">挑戰關限時 <span className="text-amber-400 font-bold">180秒</span>，氧氣耗盡則敗。</p>
              </li>
              <li className="flex gap-3 items-start">
                <span className="bg-orange-500/20 p-1 rounded">💣</span>
                <p className="text-[11px] text-slate-300">注意炸彈計時，爆炸將損耗氧氣與重要寶物。</p>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-5 w-full max-w-xs">
            <button onClick={startChallenge} className="py-6 bg-amber-500 text-slate-950 font-black text-3xl rounded-full shadow-[0_10px_0_#b45309] active:translate-y-1 active:shadow-none transition-all hover:scale-105">直接挑戰</button>
            <button onClick={startTutorial} className="py-4 bg-slate-700 text-slate-200 font-bold text-xl rounded-full transition-all border border-slate-600 shadow-lg hover:bg-slate-600">新手教學 (1-4 關)</button>
          </div>
        </div>
      )}

      <footer className="fixed bottom-4 text-[8px] text-slate-600 font-black uppercase tracking-[0.2em] opacity-30 text-center pointer-events-none z-0">
        Ancient Grid Challenge v2.5<br/>
        僅供公益宣導與教育使用
      </footer>

      <style>{`
        @keyframes shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-3px); } 20%, 40%, 60%, 80% { transform: translateX(3px); } }
        .animate-shake { animation: shake 0.25s cubic-bezier(.36,.07,.19,.97) both; animation-iteration-count: 2; }
        .certificate-card { font-family: 'Times New Roman', serif; animation: certificateShow 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        @keyframes certificateShow { 0% { transform: scale(0.5) rotate(-5deg); opacity: 0; } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }
        .zoom-in { animation: zoomIn 0.3s ease-out; }
        @keyframes zoomIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<TombPuzzle />);
}
