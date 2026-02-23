
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// --- Game Constants ---
const GRID_ROWS = 4;
const GRID_COLS = 6;
const TOTAL_FUSES = GRID_ROWS * GRID_COLS;
const CHARACTERS = ['🤡', '🤪', '🙈', '👻', '👽', '🤖', '🥳', '😎', '🐱', '🦁'];

type GameMode = 'CELEBRATION' | 'PUNISHMENT';
type GameStatus = 'LOBBY' | 'PLAYING' | 'LAUNCHED' | 'RESULT';

interface Particle {
  x: number; y: number; vx: number; vy: number;
  color: string; alpha: number; life: number;
  size: number;
  text?: string;
}

const ClownCannon: React.FC = () => {
  const [status, setStatus] = useState<GameStatus>('LOBBY');
  const [mode, setMode] = useState<GameMode>('CELEBRATION');
  const [playerCount, setPlayerCount] = useState(2);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [fuses, setFuses] = useState<boolean[]>(new Array(TOTAL_FUSES).fill(false));
  const [winningFuse, setWinningFuse] = useState(-1);
  const [winner, setWinner] = useState<number | null>(null);
  const [loser, setLoser] = useState<number | null>(null);
  const [shake, setShake] = useState(false);
  const [character, setCharacter] = useState('🤡');
  const [nickname, setNickname] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);

  // --- Sound Effects ---
  const playSound = (freq: number, type: OscillatorType = 'sine', dur = 0.2, volume = 0.1) => {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtx.current;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (type === 'sawtooth' || type === 'square') {
        osc.frequency.exponentialRampToValueAtTime(freq / 2, ctx.currentTime + dur);
      }
      g.gain.setValueAtTime(volume, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch (e) {}
  };

  // --- Particle System ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const update = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15; // Gravity
        p.life -= 0.015;
        p.alpha = p.life;
        if (p.life <= 0) {
          particles.current.splice(i, 1);
        } else {
          ctx.globalAlpha = p.alpha;
          if (p.text) {
            ctx.fillStyle = p.color;
            ctx.font = `bold ${p.size * 5}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(p.text, p.x, p.y);
          } else {
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      animId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(animId);
  }, []);

  const triggerFireworks = (x: number, y: number) => {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < 30; i++) {
      particles.current.push({
        x, y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10 - 2,
        color,
        alpha: 1,
        life: 1,
        size: Math.random() * 4 + 2
      });
    }
    playSound(400 + Math.random() * 400, 'sine', 0.3);
  };

  const triggerSpiralFireworks = (x: number, y: number) => {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const numParticles = 15;
    for (let i = 0; i < numParticles; i++) {
      const angle = (i / numParticles) * Math.PI * 2;
      const speed = 3 + Math.random() * 2;
      particles.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        color,
        alpha: 1,
        life: 1.5,
        size: 3
      });
    }
    playSound(600 + Math.random() * 200, 'sine', 0.2, 0.05);
  };

  const triggerLaunchExplosion = () => {
    const colors = ['#ffffff', '#ffaa00', '#ff4400', '#00ffff', '#ff00ff'];
    for (let i = 0; i < 150; i++) {
      particles.current.push({
        x: window.innerWidth / 2,
        y: window.innerHeight * 0.7,
        vx: (Math.random() - 0.5) * 30,
        vy: (Math.random() - 0.5) * 30 - 15,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        life: 2,
        size: Math.random() * 8 + 4
      });
    }

    // Pinball "BUMP" effects
    const bumps = ['BUMP!', 'BOING!', 'DING!', 'BONK!'];
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        particles.current.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          vx: (Math.random() - 0.5) * 2,
          vy: -2,
          color: '#ffffff',
          alpha: 1,
          life: 1,
          size: 5,
          text: bumps[Math.floor(Math.random() * bumps.length)]
        });
        playSound(800 + Math.random() * 400, 'square', 0.1, 0.05);
      }, i * 400);
    }

    playSound(80, 'sawtooth', 1.2, 0.4);
    playSound(150, 'square', 0.8, 0.2);
  };

  const exportJpg = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isSuccess = mode === 'CELEBRATION' ? winner !== null : loser === null; // In punishment, if you didn't trigger it, you are "safe" but the result screen shows the one who triggered it. Let's simplify: if you are on the result screen, we show the result of that specific player.
    
    // Background
    ctx.fillStyle = mode === 'CELEBRATION' ? '#0f172a' : '#1e1b4b'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border
    ctx.strokeStyle = mode === 'CELEBRATION' ? '#eab308' : '#ef4444';
    ctx.lineWidth = 20;
    ctx.strokeRect(10, 10, 580, 780);

    // Title
    ctx.fillStyle = mode === 'CELEBRATION' ? '#eab308' : '#f87171';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(mode === 'CELEBRATION' ? '小丑大砲 - 榮耀證書' : '小丑大砲 - 殘念證書', 300, 120);

    // Content
    ctx.fillStyle = 'white';
    ctx.font = '24px sans-serif';
    ctx.fillText(`挑戰者：${nickname || '匿名玩家'}`, 300, 220);
    
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = mode === 'CELEBRATION' ? '#eab308' : '#f87171';
    ctx.fillText(mode === 'CELEBRATION' ? '表演成功！' : '大砲炸裂！', 300, 300);
    
    ctx.font = '24px sans-serif';
    ctx.fillStyle = 'white';
    const playerNum = (winner ?? loser)! + 1;
    ctx.fillText(`玩家編號：Player ${playerNum}`, 300, 360);
    ctx.fillText(`遊戲模式：${mode === 'CELEBRATION' ? '慶祝模式' : '處罰模式'}`, 300, 420);

    // Character Emoji
    ctx.font = '120px sans-serif';
    ctx.fillText(character, 300, 580);

    // Copyright
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('國土永續 2026年版', 300, 740);
    ctx.fillText('僅供公益宣導與教育使用，未經授權不得商業轉售。', 300, 770);

    const link = document.createElement('a');
    link.download = `小丑大砲_${nickname || '玩家'}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.8);
    link.click();
  };

  // --- Game Logic ---
  const initGame = () => {
    setFuses(new Array(TOTAL_FUSES).fill(false));
    setWinningFuse(Math.floor(Math.random() * TOTAL_FUSES));
    setCurrentPlayer(0);
    setWinner(null);
    setLoser(null);
    setCharacter(CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]);
    setStatus('PLAYING');
  };

  const handleFuseClick = (index: number) => {
    if (status !== 'PLAYING' || fuses[index]) return;

    const newFuses = [...fuses];
    newFuses[index] = true;
    setFuses(newFuses);

    if (index === winningFuse) {
      if (mode === 'CELEBRATION') {
        setWinner(currentPlayer);
      } else {
        setLoser(currentPlayer);
      }
      
      setStatus('LAUNCHED');
      setShake(true);
      triggerLaunchExplosion();

      // Trigger spiral fireworks for all remaining fuses
      newFuses.forEach((pulled, i) => {
        if (!pulled) {
          const rect = document.getElementById(`fuse-${i}`)?.getBoundingClientRect();
          if (rect) {
            setTimeout(() => {
              triggerSpiralFireworks(rect.left + rect.width / 2, rect.top + rect.height / 2);
            }, Math.random() * 800);
          }
        }
      });

      setTimeout(() => {
        setShake(false);
        setStatus('RESULT');
      }, 4000); // Longer for pinball effect
    } else {
      const rect = document.getElementById(`fuse-${index}`)?.getBoundingClientRect();
      if (rect) {
        triggerFireworks(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      setCurrentPlayer((prev) => (prev + 1) % playerCount);
    }
  };

  return (
    <div className={`min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-sans select-none overflow-hidden relative ${shake ? 'animate-shake' : ''}`}>
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-50" width={window.innerWidth} height={window.innerHeight} />

      {/* Background Elements */}
      <div className="absolute inset-0 opacity-20 pointer-events-none overflow-hidden">
        <div className="absolute top-10 left-10 text-6xl animate-pulse">🎪</div>
        <div className="absolute top-20 right-20 text-6xl animate-bounce">🎈</div>
        <div className="absolute bottom-20 left-20 text-6xl animate-spin-slow">🍿</div>
        <div className="absolute bottom-40 right-10 text-6xl animate-wiggle">✨</div>
        {status === 'LAUNCHED' && (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent animate-pulse" />
        )}
      </div>

      {status === 'LOBBY' && (
        <div className="flex flex-col items-center text-center gap-8 animate-in fade-in zoom-in duration-500 z-10">
          <div className="relative">
            <h1 className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-red-500 to-yellow-500 italic drop-shadow-2xl">小丑大砲</h1>
            <div className="absolute -top-6 -right-6 text-5xl animate-bounce">{character}</div>
          </div>
          
          <div className="bg-slate-900/80 p-8 rounded-3xl border border-slate-800 shadow-2xl space-y-6 w-full max-w-md">
            <div className="flex flex-col gap-4">
              <label className="text-sm font-bold text-slate-500 uppercase tracking-widest">遊戲模式</label>
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setMode('CELEBRATION')}
                  className={`py-3 rounded-xl font-black transition-all border-2 ${mode === 'CELEBRATION' ? 'bg-yellow-500 text-slate-950 border-yellow-400 shadow-lg scale-105' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                >
                  🎉 慶祝模式
                  <div className="text-[10px] font-normal opacity-70">彈飛者獲勝</div>
                </button>
                <button 
                  onClick={() => setMode('PUNISHMENT')}
                  className={`py-3 rounded-xl font-black transition-all border-2 ${mode === 'PUNISHMENT' ? 'bg-red-600 text-white border-red-500 shadow-lg scale-105' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                >
                  💀 處罰模式
                  <div className="text-[10px] font-normal opacity-70">彈飛者落敗</div>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <label className="text-sm font-bold text-slate-500 uppercase tracking-widest">玩家人數</label>
              <div className="flex gap-4 justify-center">
                {[2, 3, 4].map(n => (
                  <button 
                    key={n}
                    onClick={() => setPlayerCount(n)}
                    className={`w-12 h-12 rounded-full font-bold transition-all border-2 ${playerCount === n ? 'bg-blue-500 text-white border-blue-400 scale-110 shadow-lg' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <button 
              onClick={initGame}
              className="w-full py-5 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white text-2xl font-black rounded-2xl shadow-xl active:scale-95 transition-all"
            >
              開始表演 🎭
            </button>
          </div>
        </div>
      )}

      {status === 'PLAYING' && (
        <div className="flex flex-col items-center gap-8 w-full max-w-2xl z-10">
          <div className="flex justify-between items-center w-full px-4 bg-slate-900/50 py-4 rounded-2xl border border-slate-800">
            <div className="flex items-center gap-3">
              {[...Array(playerCount)].map((_, i) => (
                <div 
                  key={i}
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold border-2 transition-all ${
                    currentPlayer === i 
                    ? 'scale-125 shadow-lg border-white ring-4 ring-white/20 ' + (i === 0 ? 'bg-red-500' : i === 1 ? 'bg-blue-500' : i === 2 ? 'bg-green-500' : 'bg-yellow-500')
                    : 'bg-slate-800 border-slate-700 opacity-50'
                  }`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="text-right">
              <p className="text-slate-500 text-[10px] font-bold uppercase tracking-tighter">輪到玩家</p>
              <p className={`text-xl font-black ${
                currentPlayer === 0 ? 'text-red-500' : 
                currentPlayer === 1 ? 'text-blue-500' : 
                currentPlayer === 2 ? 'text-green-500' : 'text-yellow-500'
              }`}>PLAYER {currentPlayer + 1}</p>
            </div>
          </div>

          <div className="relative w-48 h-48 mb-4">
            <div className="absolute inset-0 bg-slate-800 rounded-full border-8 border-slate-700 shadow-inner flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <span className="text-8xl relative z-10">💣</span>
            </div>
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-7xl animate-wiggle z-20">{character}</div>
          </div>

          <div className="grid grid-cols-6 gap-3 p-4 bg-slate-900/50 rounded-3xl border border-slate-800 shadow-2xl">
            {fuses.map((pulled, idx) => (
              <button
                key={idx}
                id={`fuse-${idx}`}
                disabled={pulled}
                onClick={() => handleFuseClick(idx)}
                className={`w-12 h-16 sm:w-16 sm:h-20 rounded-xl transition-all relative overflow-hidden group
                  ${pulled 
                    ? 'bg-slate-800 opacity-30 cursor-not-allowed' 
                    : 'bg-gradient-to-b from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 active:scale-90 shadow-lg border border-white/5'
                  }`}
              >
                {!pulled && (
                  <>
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-full bg-orange-900/50" />
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-2 h-2 bg-yellow-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(234,179,8,0.8)]" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-xs font-black text-slate-400">{idx + 1}</span>
                    </div>
                  </>
                )}
              </button>
            ))}
          </div>
          
          <div className="flex flex-col items-center gap-1">
            <p className="text-slate-500 font-bold italic animate-pulse">點擊引線，觸發大砲！</p>
            <p className={`text-[10px] font-black px-3 py-1 rounded-full ${mode === 'CELEBRATION' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-red-500/20 text-red-500'}`}>
              {mode === 'CELEBRATION' ? '目標：發射小丑！' : '目標：避開小丑！'}
            </p>
          </div>
        </div>
      )}

      {status === 'LAUNCHED' && (
        <div className="flex flex-col items-center justify-center z-50 w-full h-full">
          <div className={`text-[12rem] relative ${mode === 'CELEBRATION' ? 'animate-launch' : 'animate-balloon-chaos'}`}>
            {character}
            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-6xl animate-bounce">🔥</div>
          </div>
          <div className="mt-20 flex flex-col items-center gap-4">
            <h2 className={`text-6xl font-black italic animate-pulse ${mode === 'CELEBRATION' ? 'text-yellow-500' : 'text-red-500'}`}>
              {mode === 'CELEBRATION' ? '發射！！！' : '氣球亂飛中...'}
            </h2>
            <div className="flex gap-2">
              <span className="text-4xl animate-bounce delay-75">✨</span>
              <span className="text-4xl animate-bounce delay-150">💫</span>
              <span className="text-4xl animate-bounce delay-300">🌟</span>
            </div>
          </div>
        </div>
      )}

      {status === 'RESULT' && (
        <div className="flex flex-col items-center text-center gap-8 animate-in zoom-in duration-500 z-10">
          <div className="relative">
            <div className="text-9xl mb-4">🕸️</div>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 text-7xl animate-wiggle">{character}</div>
          </div>
          
          <div className={`bg-slate-900/90 p-10 rounded-[3rem] border-4 shadow-2xl space-y-6 max-w-md ${mode === 'CELEBRATION' ? 'border-yellow-500/50' : 'border-red-500/50'}`}>
            <h2 className="text-5xl font-black text-white italic">
              {mode === 'CELEBRATION' ? '表演成功！' : '大砲炸裂！'}
            </h2>
            
            <div className="py-4">
              <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">
                {mode === 'CELEBRATION' ? '獲勝者' : '落敗者'}
              </p>
              <p className={`text-6xl font-black mt-2 ${
                (winner ?? loser) === 0 ? 'text-red-500' : 
                (winner ?? loser) === 1 ? 'text-blue-500' : 
                (winner ?? loser) === 2 ? 'text-green-500' : 'text-yellow-500'
              }`}>
                PLAYER {(winner ?? loser)! + 1}
              </p>
            </div>
            
            <p className="text-slate-300">
              {mode === 'CELEBRATION' 
                ? '成功將小丑發射並落入安全網！' 
                : '不幸觸發了大砲，小丑飛走啦！'}
            </p>

            <div className="flex flex-col gap-3 w-full">
              <input 
                type="text" 
                placeholder="輸入你的暱稱 (選填)" 
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-center focus:outline-none focus:border-blue-500 text-white"
              />
              <button 
                onClick={exportJpg}
                className={`w-full py-3 font-black rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 ${
                  mode === 'CELEBRATION' ? 'bg-yellow-500 text-slate-950 hover:bg-yellow-400' : 'bg-red-600 text-white hover:bg-red-500'
                }`}
              >
                導出證書 .JPG 🖼️
              </button>
            </div>
            
            <button 
              onClick={() => setStatus('LOBBY')}
              className="w-full py-4 bg-white text-slate-950 font-black rounded-2xl hover:bg-slate-200 transition-all shadow-lg text-xl"
            >
              返回大廳 🏠
            </button>
          </div>
        </div>
      )}

      <footer className="absolute bottom-4 text-center px-4 opacity-40">
        <div className="text-[10px] text-slate-500 leading-tight font-mono">
          CLOWN CANNON v3.0 // DUAL MODE EDITION<br/>
          PRODUCED BY CLOWN CIRCUS 2026
        </div>
      </footer>

      <style>{`
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes zoom-in { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-in { animation-fill-mode: forwards; }

        @keyframes shake {
          0%, 100% { transform: translate(0, 0); }
          10% { transform: translate(-10px, -10px); }
          20% { transform: translate(10px, 10px); }
          30% { transform: translate(-10px, 10px); }
          40% { transform: translate(10px, -10px); }
          50% { transform: translate(-10px, -10px); }
          60% { transform: translate(10px, 10px); }
        }
        .animate-shake { animation: shake 0.5s infinite; }

        @keyframes wiggle {
          0%, 100% { transform: translate(-50%, 0) rotate(0deg); }
          25% { transform: translate(-50%, -5px) rotate(-5deg); }
          75% { transform: translate(-50%, -5px) rotate(5deg); }
        }
        .animate-wiggle { animation: wiggle 2s ease-in-out infinite; }

        @keyframes launch {
          0% { transform: translateY(0) scale(1); }
          20% { transform: translateY(20px) scale(1.1); }
          100% { transform: translateY(-1200px) scale(0.5); }
        }
        .animate-launch { animation: launch 1.5s cubic-bezier(0.6, -0.28, 0.735, 0.045) forwards; }

        @keyframes balloon-chaos {
          0% { transform: translate(0, 0) rotate(0deg) scale(1); }
          10% { transform: translate(-100px, -50px) rotate(20deg) scale(0.9); }
          20% { transform: translate(150px, -150px) rotate(-30deg) scale(1.1); }
          30% { transform: translate(-200px, -250px) rotate(45deg) scale(0.8); }
          40% { transform: translate(180px, -400px) rotate(-60deg) scale(1.2); }
          50% { transform: translate(-120px, -550px) rotate(90deg) scale(0.7); }
          60% { transform: translate(80px, -700px) rotate(-120deg) scale(1.1); }
          70% { transform: translate(-50px, -850px) rotate(180deg) scale(0.9); }
          100% { transform: translate(0, -1500px) rotate(720deg) scale(0.5); }
        }
        .animate-balloon-chaos { animation: balloon-chaos 3s ease-in-out forwards; }

        .animate-spin-slow { animation: spin 8s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<ClownCannon />);
}
