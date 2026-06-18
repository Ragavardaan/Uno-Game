import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Copy, Check, Send, LogOut, RefreshCw, Sparkles, 
  User, SendHorizontal, MessageSquare, Trophy, AlertCircle,
  Play, Plus, ShieldCheck, Volume2, VolumeX, ArrowLeftRight, HelpCircle
} from 'lucide-react';
import { Card, CardColor, GameRoomState, Player, ChatMessage } from './types';
import { UnoCard } from './components/UnoCard';
import { ColorChooser } from './components/ColorChooser';
import { playSound } from './utils/audio';

// Profiles custom presets
const AVATAR_PRESETS = ['🐍', '🦊', '🐱', '🦖', '🦁', '🦄', '🐼', '🐙', '🐸', '🚀', '🧙', '👽', '👾', '🤠', '😎', '💩'];
const COLOR_PRESETS = [
  { id: 'blue', label: 'Indigo Blue', theme: 'sky-500', text: 'text-sky-400', bg: 'bg-sky-500/20 border-sky-400 text-sky-300' },
  { id: 'purple', label: 'Amethyst Violet', theme: 'purple-500', text: 'text-purple-400', bg: 'bg-purple-500/20 border-purple-400 text-purple-300' },
  { id: 'emerald', label: 'Emerald Green', theme: 'emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-400 text-emerald-300' },
  { id: 'rose', label: 'Rose Pink', theme: 'rose-500', text: 'text-rose-400', bg: 'bg-rose-500/20 border-rose-400 text-rose-300' },
  { id: 'amber', label: 'Amber Gold', theme: 'amber-400', text: 'text-amber-400', bg: 'bg-amber-400/20 border-amber-400 text-amber-300' },
  { id: 'lime', label: 'Lime Burst', theme: 'lime-400', text: 'text-lime-400', bg: 'bg-lime-400/20 border-lime-400 text-lime-300' }
];

export default function App() {
  // Local profile customize
  const [profileName, setProfileName] = useState(() => {
    return localStorage.getItem('uno_player_name') || `Player_${Math.floor(Math.random() * 899 + 100)}`;
  });
  const [profileAvatar, setProfileAvatar] = useState(() => {
    return localStorage.getItem('uno_player_avatar') || '🦊';
  });
  const [profileColor, setProfileColor] = useState(() => {
    return localStorage.getItem('uno_player_color') || 'blue';
  });

  // Client states
  const [connected, setConnected] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [room, setRoom] = useState<GameRoomState | null>(null);
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [gameRulesOpen, setGameRulesOpen] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState<number>(8);

  // Wild Card color pick state
  const [pendingWildCardUid, setPendingWildCardUid] = useState<string | null>(null);
  const [isDrawnCardChoice, setIsDrawnCardChoice] = useState(false); // tracks if choosing wild color for drawn card

  // Drawn card in-hand temporary preview
  const [drawnCardPending, setDrawnCardPending] = useState<Card | null>(null);

  // Say UNO indicator toggle state prior to card action
  const [sayUnoToggled, setSayUnoToggled] = useState(false);

  // References and WebSocket instance
  const wsRef = useRef<WebSocket | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Recover credentials on startup
  const [savedPlayerId, setSavedPlayerId] = useState(() => localStorage.getItem('uno_player_id') || '');
  const [savedRoomId, setSavedRoomId] = useState(() => localStorage.getItem('uno_room_id') || '');

  // Connect to the WebSocket on mounting
  useEffect(() => {
    connectWS();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Sync scroll on chat updates
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chats]);

  // Keep player preferences in localStorage
  useEffect(() => {
    localStorage.setItem('uno_player_name', profileName);
    localStorage.setItem('uno_player_avatar', profileAvatar);
    localStorage.setItem('uno_player_color', profileColor);
  }, [profileName, profileAvatar, profileColor]);

  // Connect WebSocket helper with retry logic
  // Define this tracker variable immediately ABOVE the connectWS function
  const reconnectAttemptsRef = useRef(0);
  
  const connectWS = () => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    
    // FIX 1: Appended '/ws' path to route through Render's proxy successfully
    const wsUrl = `${wsProtocol}//${wsHost}/ws`;

    console.log(`[WebSocket] Connecting to UNO engine at: ${wsUrl}`);
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('[WebSocket] Connection established successfully!');
      setConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0; // Reset retry counter upon success

      // Attempt seating recovery if parameters are present
      if (savedRoomId && savedPlayerId) {
        socket.send(JSON.stringify({
          type: 'join_room',
          data: {
            roomId: savedRoomId,
            reconnectPlayerId: savedPlayerId,
            name: profileName,
            avatar: profileAvatar,
            color: profileColor
          }
        }));
      }
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { type } = payload;

        switch (type) {
          case 'join_success':
            localStorage.setItem('uno_player_id', payload.playerId);
            localStorage.setItem('uno_room_id', payload.roomId);
            setSavedPlayerId(payload.playerId);
            setSavedRoomId(payload.roomId);
            setError(null);
            break;

          case 'room_state':
            setRoom(payload.room);
            setChats(payload.chats);
            setDrawnCardPending(payload.drawnCardPending || null);
            
            // Check for Say Uno resetting
            const me = payload.room.players.find((p: Player) => p.id === savedPlayerId);
            if (me) {
              setSayUnoToggled(me.unoDeclared);
            }

            // High craft sound effects trigger synchronized from server events
            if (payload.room.lastActionSound && soundEnabled) {
              playSound(payload.room.lastActionSound);
            }
            break;

          case 'left_success':
            localStorage.removeItem('uno_room_id');
            setSavedRoomId('');
            setRoom(null);
            setDrawnCardPending(null);
            setSayUnoToggled(false);
            break;

          case 'kicked':
            localStorage.removeItem('uno_room_id');
            setSavedRoomId('');
            setRoom(null);
            setDrawnCardPending(null);
            setSayUnoToggled(false);
            setError(payload.message || 'You were kicked from the room.');
            break;

          case 'error':
            setError(payload.message);
            // Flash error buzzer
            if (soundEnabled) playSound('error');
            break;

          default:
            console.log('Unhandled packet:', payload);
            break;
        }
      } catch (err) {
        console.error('Failed parsing client socket packet:', err);
      }
    };

    socket.onclose = () => {
      setConnected(false);
      
      // Stop infinite background retries if the server is completely offline
      if (reconnectAttemptsRef.current >= 6) {
        setError("Unable to connect to game server. Please refresh the browser tab manually.");
        console.error("[WebSocket] Maximum connection attempts reached.");
        return;
      }

      reconnectAttemptsRef.current++;
      
      // FIX 2: Dynamic exponential backoff delay (2s, 4s, 8s, 16s...)
      // This seamlessly waits out Render's spin-up cycle without spamming requests
      const retryDelay = 2000 * Math.pow(2, reconnectAttemptsRef.current - 1);
      
      console.warn(`[WebSocket] Closed. Attempting retry #${reconnectAttemptsRef.current} in ${retryDelay / 1000}s...`);
      setTimeout(connectWS, retryDelay);
    };

    wsRef.current = socket;
  };


  // Profile setup actions
  const sendCreateRoom = () => {
    if (!connected || !wsRef.current) {
      setError('Not connected to the game server. Retrying...');
      return;
    }
    setError(null);
    wsRef.current.send(JSON.stringify({
      type: 'create_room',
      data: {
        name: profileName.trim(),
        avatar: profileAvatar,
        color: profileColor,
        maxPlayers,
      }
    }));
  };

  const updateRoomCapacity = (newCapacity: number) => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'update_capacity',
        data: { maxPlayers: newCapacity }
      }));
    }
  };

  const sendJoinRoom = (code?: string) => {
    if (!connected || !wsRef.current) {
      setError('Not connected to the game server. Retrying...');
      return;
    }
    const targetCode = code || roomCodeInput;
    if (!targetCode || targetCode.length !== 4) {
      setError('Please enter a valid 4-character Room Code.');
      return;
    }
    setError(null);
    wsRef.current.send(JSON.stringify({
      type: 'join_room',
      data: {
        roomId: targetCode.toUpperCase().trim(),
        name: profileName.trim(),
        avatar: profileAvatar,
        color: profileColor,
      }
    }));
  };

  // SOLO LAUNCHER: Onboard immediately to play against 3 bots!
  const launchQuickSolo = () => {
    if (!connected || !wsRef.current) return;
    setError(null);
    
    // 1. Send custom creation packet
    wsRef.current.send(JSON.stringify({
      type: 'create_room',
      data: {
        name: profileName.trim() || 'Champion',
        avatar: profileAvatar || '👑',
        color: profileColor || 'amber',
      }
    }));

    // Wait short delay to register success, then add 3 bots and launch
    setTimeout(() => {
      if (wsRef.current) {
        // Add 3 Bots
        wsRef.current.send(JSON.stringify({ type: 'add_bot' }));
        setTimeout(() => {
          if (wsRef.current) {
            wsRef.current.send(JSON.stringify({ type: 'add_bot' }));
            setTimeout(() => {
              if (wsRef.current) {
                wsRef.current.send(JSON.stringify({ type: 'add_bot' }));
                setTimeout(() => {
                  if (wsRef.current) wsRef.current.send(JSON.stringify({ type: 'start_game' }));
                }, 200);
              }
            }, 150);
          }
        }, 150);
      }
    }, 450);
  };

  // Lobby actions
  const addBotPlay = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'add_bot' }));
    }
  };

  const kickPlayerSeat = (playerId: string) => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'remove_player',
        data: { playerId }
      }));
    }
  };

  const startUnoMatch = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'start_game' }));
    }
  };

  const leaveActiveRoom = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'leave_room' }));
    }
  };

  const restartRoomMatch = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'restart_game' }));
    }
  };

  // Game board active play card actions
  const handlePlayCardAttempt = (card: Card) => {
    if (!room || !wsRef.current) return;
    
    // Check if it's your turn
    const activeSeatIdx = room.currentTurnIdx;
    const isMyTurn = room.players[activeSeatIdx]?.id === savedPlayerId;
    if (!isMyTurn) return;

    // Check if playable
    const isPlayable = isCardPlayableInState(card);
    if (!isPlayable) return;

    // Check Wild card activation
    if (card.color === 'black') {
      setPendingWildCardUid(card.uid);
      setIsDrawnCardChoice(false);
    } else {
      // Normal card plays
      wsRef.current.send(JSON.stringify({
        type: 'play_card',
        data: { cardUid: card.uid }
      }));
    }
  };

  // Color picker choice callback
  const handleColorSelection = (chosenColor: CardColor) => {
    if (!wsRef.current || !pendingWildCardUid) return;

    if (isDrawnCardChoice) {
      // Playing the card that was just drawn this turn
      wsRef.current.send(JSON.stringify({
        type: 'play_drawn_card',
        data: { declaredColor: chosenColor }
      }));
    } else {
      // Playing a card from hand
      wsRef.current.send(JSON.stringify({
        type: 'play_card',
        data: { 
          cardUid: pendingWildCardUid,
          declaredColor: chosenColor
        }
      }));
    }

    // Reset modals
    setPendingWildCardUid(null);
    setIsDrawnCardChoice(false);
  };

  // Draw deck draw card click
  const drawCardFromDeck = () => {
    if (!room || !wsRef.current || drawnCardPending) return;
    const isMyTurn = room.players[room.currentTurnIdx]?.id === savedPlayerId;
    if (!isMyTurn) return;

    wsRef.current.send(JSON.stringify({ type: 'draw_card' }));
  };

  // Decision options for drawn playable card
  const handlePlayDrawnPending = () => {
    if (!drawnCardPending) return;
    
    if (drawnCardPending.color === 'black') {
      setPendingWildCardUid(drawnCardPending.uid);
      setIsDrawnCardChoice(true);
    } else {
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'play_drawn_card',
          data: {}
        }));
      }
    }
  };

  const handleKeepDrawnPending = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'keep_drawn_card' }));
    }
  };

  // Toggling the UNO declaration trigger
  const handleToggleSayUno = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'say_uno' }));
    }
  };

  // Challenging a target seat
  const handleChallengeSeat = (targetId: string) => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'challenge_uno',
        data: { targetPlayerId: targetId }
      }));
    }
  };

  // Chat message send handler
  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !wsRef.current) return;
    
    wsRef.current.send(JSON.stringify({
      type: 'send_chat',
      data: { text: chatInput.trim() }
    }));
    setChatInput('');
  };

  // Copy Room Link to Clipboard
  const copyRoomLink = () => {
    const shareableUrl = `${window.location.origin}/?join=${room?.roomId}`;
    navigator.clipboard.writeText(shareableUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper validation queries
  const isCardPlayableInState = (card: Card): boolean => {
    if (!room) return false;
    
    // Check turn
    const activePlayer = room.players[room.currentTurnIdx];
    if (!activePlayer || activePlayer.id !== savedPlayerId) return false;

    // Check drawn card holds
    if (drawnCardPending) return false; // must resolve drawn card decision first

    // Wild cards are always playable
    if (card.color === 'black') return true;

    // Target matches color or value
    const targetColor = room.activeColor || room.currentCard?.color;
    const targetValue = room.currentCard?.value;

    return card.color === targetColor || card.value === targetValue;
  };

  // Separate participants
  const me = room?.players.find(p => p.id === savedPlayerId);
  const myCards = me?.hand || [];
  const otherPlayers = room?.players.filter(p => p.id !== savedPlayerId) || [];
  const isMyPlayingTurn = room ? room.players[room.currentTurnIdx]?.id === savedPlayerId : false;

  return (
    <div id="uno-applet-root" className="min-h-screen bg-[#0a0a0b] text-[#e0e0e0] font-sans overflow-x-hidden flex flex-col relative border-8 border-[#1a1a1c] selection:bg-[#d4af37] selection:text-black">
      {/* 🌌 Onyx Matrix visual overlay background */}
      <div className="absolute inset-0 opacity-10 pointer-events-none onyx-pattern" />

      {/* 🚀 GLOBAL HEADER GLOSS */}
      <header id="applet-navbar" className="flex justify-between items-center px-4 sm:px-10 py-5 border-b border-white/5 bg-[#0e0e11] sticky top-0 z-40 backdrop-blur-md">
        <div className="flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-xl border-2 border-[#d4af37]/35 bg-gradient-to-br from-[#1a1a1a] to-[#000] flex items-center justify-center shadow-lg">
            <span className="text-[#d4af37] font-serif italic text-lg font-black">U</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-md sm:text-2xl font-serif italic text-[#d4af37] tracking-wider leading-none">ONYX EDITION</h1>
            <span className="text-[9px] uppercase tracking-[0.4em] text-white/40 mt-1 leading-none">Grand Tournament Lobby</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-6 z-10">
          {/* Rules Toggle */}
          <button
            id="rules-toggle-btn"
            onClick={() => setGameRulesOpen(!gameRulesOpen)}
            className="p-1 px-3 py-1.5 rounded-full border border-white/10 hover:border-[#d4af37] text-white/60 hover:text-white text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition duration-300 bg-white/2"
          >
            <HelpCircle size={13} className="text-[#d4af37]" />
            <span className="hidden sm:inline">Rules</span>
          </button>

          {/* Sound Synthesizer toggler */}
          <button
            id="sound-synth-toggle"
            onClick={() => {
              setSoundEnabled(!soundEnabled);
              playSound('play');
            }}
            className="p-2 rounded-full border border-white/5 bg-[#141416] hover:bg-[#1a1a1c] hover:border-[#d4af37]/30 text-white/60 hover:text-white transition cursor-pointer"
            title={soundEnabled ? 'Mute Sound Effects' : 'Enable Sound Effects'}
          >
            {soundEnabled ? <Volume2 size={14} className="text-[#d4af37]" /> : <VolumeX size={14} />}
          </button>

          {/* Network Connection Badge */}
          <div className="flex items-center gap-2 bg-[#141416]/90 rounded-full py-1.5 px-4 border border-white/10">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500 animate-ping'}`} />
            <span className="text-[10px] font-bold text-white/50 tracking-wider hidden md:inline">
              {connected ? 'ENCRYPTED P2P ACTIVE' : 'CONNECTING'}
            </span>
          </div>
        </div>
      </header>

      {/* ⚠️ EMERGENCY CONVERTED OR ERROR NOTIFICATION FLYOUT */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            id="global-error-banner"
            className="mx-6 mt-4 p-3.5 bg-red-950/20 border border-red-500/30 text-red-200 text-sm rounded-xl flex items-center justify-between gap-3 shadow-lg z-33 backdrop-blur-md"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle size={18} className="text-red-400 flex-shrink-0" />
              <span>{error}</span>
            </div>
            <button id="close-error" onClick={() => setError(null)} className="text-red-400 hover:text-red-200 text-xs font-bold px-2 py-1">
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🔮 MAIN STAGE ROUTER */}
      <main id="main-content-layout" className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 flex flex-col justify-center">
        {!room ? (
          /* =========================================================
             1. LOBBY SPLASH: CHARACTER PROFILE + ROOM SELECTOR
             ========================================================= */
          <div id="lobby-splash-view" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start my-auto py-10 relative z-10">
            
            {/* LOBBY LEFT COLUMN: VISUAL PROFILE CUSTOMIZER */}
            <div className="lg:col-span-5 bg-[#0e0e11] border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col gap-6 relative">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#d4af37]/2 blur-[80px] pointer-events-none rounded-full" />
              <div>
                <h2 className="text-lg font-serif italic tracking-wider flex items-center gap-2 text-[#d4af37]">
                  <User size={18} className="text-[#d4af37]" /> CUSTOMIZE HERO PROFILE
                </h2>
                <p className="text-xs text-white/40">Choose how other players and bots will see you at the table.</p>
              </div>

              {/* Profile Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Display UserName</label>
                <div className="relative">
                  <input
                    id="profile-name-input"
                    type="text"
                    maxLength={16}
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full bg-[#050506]/90 border border-white/10 focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] rounded-xl py-2.5 px-4 text-sm text-white font-bold transition outline-none"
                    placeholder="Enter nickname..."
                  />
                  <Sparkles size={16} className="absolute right-3.5 top-3.5 text-white/20 pointer-events-none" />
                </div>
              </div>

              {/* Avatar Emoji picker */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Select Avatar Emoji ({profileAvatar})</label>
                <div className="grid grid-cols-8 gap-1.5 p-2 bg-[#050506]/60 border border-white/5 rounded-2xl max-h-36 overflow-y-auto">
                  {AVATAR_PRESETS.map((emoji) => (
                    <button
                      key={emoji}
                      id={`avatar-btn-${emoji}`}
                      onClick={() => {
                        setProfileAvatar(emoji);
                        if (soundEnabled) playSound('play');
                      }}
                      className={`
                        text-xl h-10 aspect-square rounded-xl flex items-center justify-center cursor-pointer transition duration-200
                        ${profileAvatar === emoji ? 'bg-[#d4af37] text-black scale-110 shadow-[0_4px_15px_rgba(212,175,55,0.3)]' : 'hover:bg-white/5'}
                      `}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Character Profile Theme highlight */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Name highlight Color</label>
                <div className="grid grid-cols-3 gap-2">
                  {COLOR_PRESETS.map((col) => (
                    <button
                      key={col.id}
                      id={`color-preset-${col.id}`}
                      onClick={() => {
                        setProfileColor(col.id);
                        if (soundEnabled) playSound('play');
                      }}
                      className={`
                        py-2 px-3 border rounded-xl font-bold text-xs tracking-wider transition-all duration-300 text-center cursor-pointer
                        ${profileColor === col.id ? `${col.bg} ring-2 ring-offset-2 ring-offset-[#0e0e11] ring-${col.theme}` : 'border-white/5 text-white/40 hover:border-white/10 hover:text-white'}
                      `}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* LOBBY RIGHT COLUMN: GAME MODES CONNECTS */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              
              {/* STYLISH BACKDROP BANNER FOR SOLO PLAYERS */}
              <div className="bg-gradient-to-r from-[#0e0e11] via-[#16161a] to-[#0e0e11] border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-6 relative overflow-hidden">
                <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4af37]/20 to-transparent" />
                <div className="flex flex-col gap-1.5 text-center sm:text-left">
                  <span className="text-[10px] bg-[#d4af37]/10 text-[#d4af37] font-extrabold uppercase tracking-[0.2em] py-0.5 px-2.5 rounded-full self-center sm:self-start border border-[#d4af37]/20">
                    Onboarding Booster
                  </span>
                  <h3 className="text-lg font-serif italic text-white">Want to play instantly?</h3>
                  <p className="text-xs text-white/40 max-w-sm">Skip waiting! Launch a fast Solo Game against 3 smart AI bots to test cards or rules immediately.</p>
                </div>
                <button
                  id="quick-solo-btn"
                  onClick={launchQuickSolo}
                  disabled={!connected}
                  className="w-full sm:w-auto py-3 px-6 rounded-full bg-[#d4af37] hover:bg-white text-black font-extrabold text-xs tracking-[0.2em] uppercase select-none active:scale-98 shadow-[0_10px_20px_rgba(212,175,55,0.2)] disabled:opacity-50 disabled:cursor-not-allowed transition duration-300 cursor-pointer"
                >
                  QUICK SOLO START
                </button>
              </div>

              {/* LOBBY CONNECTION GATEWAYS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* GATEWAY A: CREATE NEW ROOM */}
                <div className="bg-[#0e0e11] border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col justify-between gap-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-white/2 blur-[60px] pointer-events-none rounded-full" />
                  <div className="flex flex-col gap-2">
                    <div className="w-10 h-10 rounded-xl bg-[#d4af37]/10 text-[#d4af37] flex items-center justify-center font-bold">
                      🏠
                    </div>
                    <h3 className="text-md font-bold text-white uppercase tracking-wider">Host Multi Player Lobby</h3>
                    <p className="text-xs text-white/40">Open a dynamic game room. Share your code with friends, play together, or fill vacancies with smart bots.</p>

                    {/* Seat Capacity Selector */}
                    <div className="flex flex-col gap-1.5 mt-2">
                      <label className="text-[9px] font-bold text-[#d4af37]/50 uppercase tracking-widest">Lobby Seat Capacity</label>
                      <select
                        id="max-players-select"
                        value={maxPlayers}
                        onChange={(e) => setMaxPlayers(Number(e.target.value))}
                        className="w-full bg-[#050506]/90 border border-white/10 focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] rounded-xl py-2 px-3 text-xs text-white font-bold transition outline-none cursor-pointer"
                      >
                        {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 20].map((v) => (
                          <option key={v} value={v} className="bg-[#0e0e11] text-white">
                            {v} Seats Configuration
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    id="create-room-btn"
                    onClick={sendCreateRoom}
                    disabled={!connected}
                    className="w-full py-3 px-5 rounded-full bg-[#141416] hover:bg-[#1a1a1c] text-[#d4af37] border border-white/5 hover:border-[#d4af37]/35 font-bold text-xs uppercase tracking-[0.15em] transition duration-300 cursor-pointer"
                  >
                    Create Game Lobby
                  </button>
                </div>

                {/* GATEWAY B: JOIN EXISTING ROOM */}
                <div className="bg-[#0e0e11] border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col justify-between gap-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-white/2 blur-[60px] pointer-events-none rounded-full" />
                  <div className="flex flex-col gap-2">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
                      🔑
                    </div>
                    <h3 className="text-md font-bold text-white uppercase tracking-wider">Join Room Code</h3>
                    <p className="text-xs text-white/40">Received a 4-digit code? Paste it below to jump directly into your friend's active UNO card table.</p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <input
                      id="room-code-input"
                      type="text"
                      maxLength={4}
                      value={roomCodeInput}
                      onChange={(e) => setRoomCodeInput(e.target.value)}
                      className="w-full bg-[#050506]/95 border border-white/10 focus:border-[#d4af37] rounded-xl py-2 px-3 text-center text-sm font-bold placeholder:text-white/20 tracking-widest text-[#d4af37] outline-none transition"
                      placeholder="ENTER CODE (e.g. ABCD)"
                    />
                    <button
                      id="join-room-btn"
                      onClick={() => sendJoinRoom()}
                      disabled={!connected || !roomCodeInput}
                      className="w-full py-3 px-5 rounded-full bg-[#d4af37] hover:bg-white text-black font-extrabold text-xs uppercase tracking-[0.15em] shadow-[0_10px_20px_rgba(212,175,55,0.15)] transition duration-300 cursor-pointer"
                    >
                      Join Game Room
                    </button>
                  </div>
                </div>

              </div>
            </div>

          </div>
        ) : (
          /* =========================================================
             2. LOBBY OR ACTIVE CARD TABLE VIEW
             ========================================================= */
          <div id="active-game-stage" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch relative z-10">
            
            {/* LOBBY / TABLE MAIN SECTION: COL SPAN 8 OR 9 */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              
              {/* LOBBY / TABLE HEADER WITH CODES */}
              <div className="bg-[#0e0e11] border border-white/5 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] bg-[#d4af37]/10 text-[#d4af37] font-extrabold uppercase py-1 px-3.5 tracking-wider rounded-full border border-[#d4af37]/25">
                    {room.status === 'lobby' ? 'WAITING ROOM' : 'GAME BOARD'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-white/40 uppercase tracking-widest">ROOM CODE:</span>
                    <span className="font-mono font-extrabold text-[#d4af37] text-lg tracking-widest bg-[#050506] px-2.5 py-0.5 rounded border border-white/5">
                      {room.roomId}
                    </span>
                  </div>
                  {/* Share code */}
                  <button
                    id="copy-code-btn"
                    onClick={copyRoomLink}
                    className="p-1.5 px-3 rounded-md hover:bg-white/5 text-white/50 hover:text-[#d4af37] text-[10px] flex items-center gap-1.5 transition duration-300"
                    title="Copy full invite URL to join"
                  >
                    {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    <span className="uppercase font-bold tracking-wider">{copied ? 'Copied Link' : 'Copy Invite URL'}</span>
                  </button>
                </div>

                <button
                  id="leave-room-active-btn"
                  onClick={leaveActiveRoom}
                  className="p-1 px-[18px] py-2 rounded-full bg-[#141416] hover:bg-[#1a1a1c] text-white/60 hover:text-white text-[10px] font-bold uppercase tracking-wider border border-white/5 hover:border-white/10 flex items-center gap-1.5 transition duration-300 select-none cursor-pointer"
                >
                  <LogOut size={11} className="text-red-400" />
                  Leave Table
                </button>
              </div>

              {/* ====================
                  STAGE TYPE A: ROOM WAIT LOBBY
                  ==================== */}
              {room.status === 'lobby' && (
                <div id="lobby-waiting-panel" className="bg-[#0e0e11] border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col gap-6 flex-1 min-h-[420px] justify-between relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-48 h-48 bg-[#d4af37]/2 blur-[90px] pointer-events-none rounded-full" />
                  
                  {/* Lobby player lineup */}
                  <div className="flex flex-col gap-4 relative z-10">
                    <div className="flex justify-between items-center border-b border-white/5 pb-3">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/50 flex items-center gap-2">
                        👥 TABLE SEATS ({room.players.length}/{room.maxPlayers || 8})
                      </h3>
                      {me?.isHost && (
                        <span className="text-[10px] uppercase tracking-wider text-[#d4af37] font-bold flex items-center gap-1">🌟 Room Host</span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                      {room.players.map((p) => {
                        const isYou = p.id === savedPlayerId;
                        const matchingPreset = COLOR_PRESETS.find(col => col.id === p.color);

                        return (
                          <div
                            key={p.id}
                            id={`lobby-seat-${p.id}`}
                            className={`
                              p-4 bg-[#050506]/95 border rounded-2xl flex flex-col items-center justify-between text-center gap-2 relative backdrop-blur-sm transition duration-300
                              ${isYou ? 'border-[#d4af37] shadow-[0_0_15px_rgba(212,175,55,0.15)] ring-1 ring-[#d4af37]/30' : 'border-white/5'}
                            `}
                          >
                            {/* Kick action (Host-only, can kick bots or guests) */}
                            {me?.isHost && !isYou && (
                              <button
                                id={`kick-btn-${p.id}`}
                                onClick={() => kickPlayerSeat(p.id)}
                                className="absolute top-2 right-2 p-1.5 text-white/30 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                                title={`Remove ${p.name}`}
                              >
                                ×
                              </button>
                            )}

                            <span className="text-3xl filter drop-shadow">{p.avatar}</span>
                            
                            <div className="flex flex-col items-center">
                              <span className={`text-xs font-bold truncate ${isYou ? 'text-[#d4af37]' : 'text-zinc-200'}`}>
                                {p.name} {isYou ? '(You)' : ''}
                              </span>
                              
                              <div className="flex items-center gap-1 mt-1">
                                {p.isHost && (
                                  <span className="text-[8px] font-extrabold uppercase bg-[#d4af37]/10 border border-[#d4af37]/20 text-[#d4af37] px-1.5 py-0.5 rounded leading-none">
                                    Host 👑
                                  </span>
                                )}
                                {p.isBot && (
                                  <span className="text-[8px] font-extrabold uppercase bg-white/[0.03] border border-white/10 text-white/50 px-1.5 py-0.5 rounded leading-none">
                                    Bot 🤖
                                  </span>
                                )}
                                {!p.isHost && !p.isBot && (
                                  <span className="text-[8px] font-extrabold uppercase bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded leading-none">
                                    Guest
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* Seat vacancy placeholder grids */}
                      {Array.from({ length: Math.min(4, Math.max(0, (room.maxPlayers || 8) - room.players.length)) }).map((_, idx) => (
                        <div
                          key={`empty-${idx}`}
                          className="p-4 border-2 border-dashed border-white/5 bg-[#050506]/20 rounded-2xl flex flex-col items-center justify-center text-center gap-1.5 opacity-30 min-h-[140px]"
                        >
                          <span className="text-white/40 text-sm">➕</span>
                          <span className="text-white/30 text-[9px] font-bold font-mono tracking-[0.25em] uppercase">VACANT</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Lobby host management triggers */}
                  <div className="border-t border-white/5 pt-5 flex flex-col sm:flex-row items-center justify-between gap-4 relative z-10">
                    <p className="text-xs text-white/40 max-w-sm text-center sm:text-left">
                      💡 Invite friends by sharing the lobby code, or click <b>"Add AI Bot"</b> to populate remaining seats with computer players. At least 2 players are required to start.
                    </p>

                    <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                      {me?.isHost ? (
                        <>
                          {/* Host Capacity Adjuster */}
                          <div className="flex items-center gap-2.5 bg-[#141416] px-4 py-2.5 border border-white/10 rounded-full">
                            <span className="text-[10px] text-white/40 uppercase tracking-widest font-bold font-mono">Capacity</span>
                            <select
                              id="lobby-capacity-select"
                              value={room.maxPlayers || 8}
                              onChange={(e) => updateRoomCapacity(Number(e.target.value))}
                              className="bg-transparent text-xs text-[#d4af37] font-bold outline-none cursor-pointer"
                            >
                              {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 20].map((v) => (
                                <option key={v} value={v} className="bg-[#0e0e11] text-white">
                                  {v} Players
                                </option>
                              ))}
                            </select>
                          </div>

                          <button
                            id="add-bot-btn"
                            onClick={addBotPlay}
                            disabled={room.players.length >= (room.maxPlayers || 8)}
                            className="flex-1 sm:flex-none p-3 px-5 rounded-full bg-[#141416] hover:bg-[#1a1a1c] border border-white/10 hover:border-[#d4af37]/30 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition duration-300"
                          >
                            <Plus size={14} /> Add AI Bot 🤖
                          </button>
                          
                          <button
                            id="start-uno-match-btn"
                            onClick={startUnoMatch}
                            disabled={room.players.length < 2}
                            className="flex-1 sm:flex-none p-3 px-6 rounded-full bg-[#d4af37] hover:bg-white text-black font-extrabold text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-1.5 shadow-[0_10px_20px_rgba(212,175,55,0.2)] cursor-pointer disabled:opacity-40 transition duration-300"
                          >
                            <Play size={14} className="fill-current text-black" /> START MATCH
                          </button>
                        </>
                      ) : (
                        <div className="w-full text-center py-3 px-6 bg-[#050506]/90 rounded-full border border-white/5 text-[#d4af37]/80 font-bold text-[10px] tracking-wider uppercase">
                          ⏳ Waiting for Host to start match... Go ahead and write in chat!
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              )}

              {/* ====================
                  STAGE TYPE B: IMMERSIVE ACTIVE CARD TABLE
                  ==================== */}
              {(room.status === 'playing' || room.status === 'game_over') && (
                <div id="uno-game-table" className="bg-[#0e0e11] border-2 border-white/5 rounded-3xl p-4 sm:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative flex flex-col justify-between overflow-hidden flex-1 min-h-[500px]">
                  
                  {/* Felt table surface accent glow */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-white/[0.01] to-black/30 pointer-events-none" />

                  {/* 1. SEATS RAIL: OTHER OPPONENTS LINEUP */}
                  <div id="opponents-rail" className="flex flex-wrap justify-center gap-3 sm:gap-4 select-none mb-6 relative z-10">
                    {otherPlayers.map((p) => {
                      const isTheirTurn = room.players[room.currentTurnIdx]?.id === p.id;
                      const missingUno = p.handCount === 1 && !p.unoDeclared;

                      return (
                        <div
                          key={p.id}
                          id={`opponent-seat-${p.id}`}
                          className={`
                            p-2 bg-[#121215]/90 border rounded-xl flex items-center gap-3 relative shadow-md transition-all duration-300 min-w-[125px] max-w-[160px]
                            ${isTheirTurn ? 'border-[#d4af37] ring-2 ring-[#d4af37]/20 bg-[#121215] scale-105 shadow-[0_0_15px_rgba(212,175,55,0.15)]' : 'border-white/5'}
                          `}
                        >
                          {/* Turn indicator glow tag */}
                          {isTheirTurn && (
                            <div className="absolute -top-2.5 left-1/2 transform -translate-x-1/2 bg-[#d4af37] text-black font-extrabold text-[8px] px-2 py-0.5 rounded-full shadow tracking-wider uppercase leading-none">
                              Active
                            </div>
                          )}

                          {/* Avatar icon */}
                          <div className="relative">
                            <span className="text-2xl filter drop-shadow">{p.avatar}</span>
                            {/* Card count bubble */}
                            <span className="absolute -bottom-1 -right-1 bg-[#050506] border border-white/10 text-[#d4af37] font-extrabold text-[9px] w-5 h-5 rounded-full flex items-center justify-center shadow">
                              {p.handCount}
                            </span>
                          </div>

                          {/* Profile detail */}
                          <div className="flex-1 min-w-0 pr-1 flex flex-col justify-center">
                            <span className="text-xs font-bold truncate text-white flex items-center gap-1">
                              {p.name}
                              {p.isBot && <span title="AI Bot">🤖</span>}
                            </span>
                            
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {/* Uno state tag */}
                              {p.unoDeclared && (
                                <span className="text-[8px] font-black uppercase text-[#d4af37] leading-none tracking-wider">
                                  UNO! 🎴
                                </span>
                              )}
                              {!p.unoDeclared && p.handCount > 1 && (
                                <span className="text-[8px] font-bold text-white/30 leading-none">
                                  In Play
                                </span>
                              )}

                              {/* CHALLENGE RADAR: Displays if opp has 1 card but forgot to declare UNO! */}
                              {missingUno && (
                                <button
                                  id={`challenge-uno-btn-${p.id}`}
                                  onClick={() => handleChallengeSeat(p.id)}
                                  className="text-[8px] bg-red-950 hover:bg-red-900 border border-red-500/40 text-red-100 font-extrabold px-1.5 py-0.5 rounded-full animate-bounce transition cursor-pointer flex items-center gap-0.5 shadow-md justify-center"
                                  title="Caught them! Force them to draw 2 penalty cards"
                                >
                                  🚨 Challenge!
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 2. CENTER PILE AND ACCENTS (THE MAT) */}
                  <div id="game-felt-center" className="flex flex-col items-center justify-center my-auto py-6 relative z-10">
                    
                    {/* Direction indicators */}
                    <div className="flex items-center gap-2 mb-4 text-[10px] uppercase font-bold text-zinc-500 border border-zinc-800/80 bg-zinc-900/60 rounded-full py-1 px-3">
                      <ArrowLeftRight size={12} className={room.direction === 1 ? 'text-amber-400 rotate-0' : 'text-amber-400 rotate-180'} />
                      <span>Play Order: {room.direction === 1 ? 'Clockwise' : 'Counter-Clockwise'}</span>
                    </div>

                    <div className="flex items-center justify-center gap-8 sm:gap-12">
                      
                      {/* CARD STACK PILE: DRAW DECK */}
                      <div className="flex flex-col items-center gap-2 text-center group">
                        <div
                          id="draw-deck-card"
                          onClick={drawCardFromDeck}
                          className={`
                            w-24 h-36 border-2 border-white rounded-lg shadow-lg relative cursor-pointer select-none
                            bg-gradient-to-br from-rose-600 via-rose-700 to-rose-900 flex flex-col items-center justify-center
                            ${isMyPlayingTurn && !drawnCardPending ? 'hover:-translate-y-2 hover:scale-105 active:scale-95 ring-4 ring-amber-400/50 hover:shadow-amber-500/20' : 'opacity-75 cursor-not-allowed'}
                            transition-all duration-300
                          `}
                        >
                          {/* Uno card back glossy loop */}
                          <div className="w-4/5 h-1/2 rounded-[50%] bg-[#050506]/95 border border-white/5 shadow-md transform rotate-[-28deg] flex items-center justify-center">
                            <span className="text-[#d4af37] font-serif italic tracking-tighter text-[10px] transform rotate-[28deg] border-2 border-[#d4af37] rounded-full p-1.5 py-0.5 scale-90 select-none font-bold">
                              UNO
                            </span>
                          </div>
                          
                          {/* Stack count badge */}
                          <div className="absolute top-1.5 right-1.5 bg-[#050506]/95 text-[#d4af37] text-[8px] font-bold rounded-lg px-2 py-0.5 border border-white/10 font-mono">
                            {room.deckCount}
                          </div>

                          {isMyPlayingTurn && !drawnCardPending && (
                            <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition duration-200 pointer-events-none rounded-inherit" />
                          )}
                        </div>
                        <span className="text-[10px] font-bold text-white/20 font-mono tracking-widest uppercase">DRAW STACK</span>
                      </div>

                      {/* CARD STACK PILE: DISCARD PILE */}
                      <div className="flex flex-col items-center gap-2 text-center">
                        <div id="discard-pile-display" className="relative">
                          {room.currentCard ? (
                            <UnoCard card={room.currentCard} size="md" hoverEffect={false} disabled={true} />
                          ) : (
                            <div className="w-24 h-36 border-2 border-dashed border-white/10 bg-[#050506] rounded-xl flex items-center justify-center text-white/20 font-black text-xs">
                              Empty
                            </div>
                          )}
                          
                          {/* Discard pile offset count */}
                          {room.discardPileCount > 1 && (
                            <div className="absolute -bottom-1 -right-1 bg-[#050506] border border-white/10 text-[9px] font-bold font-mono text-[#d4af37] px-1.5 py-0.5 rounded-lg shadow-md">
                              +{room.discardPileCount - 1} cards
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] font-bold text-white/20 font-mono tracking-widest uppercase">DISCARD PILE</span>
                      </div>

                    </div>

                    {/* Active override color badge for Wild Plays */}
                    {room.activeColor && (
                      <div className="mt-4 flex items-center gap-2 bg-[#050506] border border-white/5 rounded-xl py-1.5 px-3.5 shadow-inner">
                        <span className="text-[9px] font-bold text-white/40 tracking-wider">ACTIVE COLOR:</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-3 h-3 rounded-full ${
                            room.activeColor === 'red' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]' :
                            room.activeColor === 'blue' ? 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.4)]' :
                            room.activeColor === 'green' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-[#d4af37] shadow-[0_0_8px_rgba(212,175,55,0.4)]'
                          }`} />
                          <span className="text-xs font-bold uppercase text-white font-mono tracking-wider">{room.activeColor}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3. PROMPT DECISION CENTER FOR DRAWN CARDS PLAYABILITY */}
                  <AnimatePresence>
                    {drawnCardPending && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 15 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 15 }}
                        id="drawn-card-decision-flyout"
                        className="p-5 bg-[#0e0e11] border-2 border-[#d4af37]/35 rounded-3xl w-full max-w-sm mx-auto my-4 text-center shadow-[0_15px_40px_rgba(212,175,55,0.15)] relative z-20 flex flex-col items-center gap-4"
                      >
                        <div className="flex flex-col gap-1">
                          <h4 className="text-xs font-bold uppercase tracking-[0.15em] text-[#d4af37]">⚡ DRAWN CARD PLAYABLE!</h4>
                          <p className="text-xs text-white/40">You drew a play-legal card! What would you like to do?</p>
                        </div>

                        {/* Card Preview */}
                        <UnoCard card={drawnCardPending} size="md" hoverEffect={false} disabled={true} />

                        {/* Choice Triggers */}
                        <div className="flex items-center gap-3 w-full">
                          <button
                            id="decision-keep-btn"
                            onClick={handleKeepDrawnPending}
                            className="flex-1 py-2.5 px-4 rounded-full bg-[#141416] hover:bg-[#1d1d20] border border-white/5 hover:border-white/10 font-bold text-xs uppercase tracking-wider transition duration-300 text-white/60 hover:text-white cursor-pointer"
                          >
                            Keep (Pass)
                          </button>
                          <button
                            id="decision-play-btn"
                            onClick={handlePlayDrawnPending}
                            className="flex-1 py-2.5 px-4 rounded-full bg-[#d4af37] hover:bg-white font-extrabold text-xs uppercase tracking-wider text-black shadow-[0_4px_12px_rgba(212,175,55,0.25)] transition duration-300 cursor-pointer"
                          >
                            Play Instance
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* 4. TURN STATS BAR */}
                  <div className="bg-[#0e0e11] border border-white/5 rounded-2xl p-4 text-center my-3 max-w-lg mx-auto w-full relative">
                    <div className="absolute top-0 left-0 w-16 h-16 bg-[#d4af37]/2 blur-xl pointer-events-none rounded-full" />
                    {room.status === 'playing' ? (
                      <div className="flex flex-col gap-1 relative z-10">
                        <span className="text-[9px] text-[#d4af37] uppercase font-bold tracking-[0.2em]">Game Action Log</span>
                        <p 
                          className="text-xs sm:text-sm font-bold text-white/70 italic leading-relaxed" 
                          dangerouslySetInnerHTML={{ __html: room.lastActionDescription }}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-1 relative z-10">
                        <div className="flex items-center gap-1.5">
                          <Trophy className="text-[#d4af37] fill-current" size={18} />
                          <h4 className="text-xs font-extrabold text-[#d4af37] tracking-[0.20em] uppercase">WE HAVE A WINNER!</h4>
                        </div>
                        <p className="text-sm font-bold">
                          🏆 Match won by <span className="text-[#d4af37] font-serif italic text-base">{room.winner?.name}</span>!
                        </p>
                        {me?.isHost && (
                          <button
                            id="play-again-btn"
                            onClick={restartRoomMatch}
                            className="mt-2 text-[10px] bg-[#141416] hover:bg-white text-[#d4af37] hover:text-black border border-[#d4af37]/30 hover:border-white font-extrabold py-2 px-5 rounded-full uppercase tracking-wider transition duration-300 cursor-pointer"
                          >
                            Play Again (Lobby)
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 5. BOTTOM SECTION: YOUR HAND CARDS */}
                  <div id="self-player-hand" className="relative z-10 pt-4 border-t border-white/5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                      <div>
                        <h4 className="text-xs font-bold tracking-[0.15em] text-[#d4af37]/90 uppercase">
                          🃏 YOUR HAND ({myCards.length} Cards)
                        </h4>
                        {isMyPlayingTurn && !drawnCardPending && (
                          <p className="text-[10px] text-[#d4af37] font-extrabold animate-pulse tracking-wider mt-0.5">★ YOUR TURN! Select a matching card or draw card.</p>
                        )}
                      </div>

                      {/* ACTIVE ACTION PANEL: SAY UNO TOGGLES */}
                      {room.status === 'playing' && (
                        <div className="flex items-center gap-2">
                          <button
                            id="say-uno-toggle-btn"
                            onClick={handleToggleSayUno}
                            className={`
                              py-2 px-4 rounded-full font-bold text-[10px] tracking-wider transition-all duration-300 flex items-center gap-1.5 cursor-pointer uppercase select-none
                              ${sayUnoToggled 
                                ? 'bg-[#d4af37] text-black font-extrabold shadow-[0_10px_20px_rgba(212,175,55,0.25)]' 
                                : 'bg-[#141416] text-white/40 border border-white/5 hover:border-white/10 hover:text-white'}
                            `}
                          >
                            📢 {sayUnoToggled ? 'UNO! Active' : 'SAY UNO!'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Sliding card fan containing the player's personal deck hand */}
                    <div className="relative py-4 px-2 min-h-[160px] bg-[#050506]/35 border border-white/5 rounded-2xl flex items-center justify-center overflow-x-auto overflow-y-visible">
                      {myCards.length === 0 ? (
                        <div className="text-white/20 text-xs font-bold font-mono tracking-widest text-center uppercase">
                          NO CARDS (SPECTATING / WAITING)
                        </div>
                      ) : (
                        <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2 px-10 relative">
                          <AnimatePresence mode="popLayout">
                            {myCards.map((card, idx) => {
                              const isPlayable = isCardPlayableInState(card);
                              return (
                                <motion.div
                                  key={card.uid}
                                  layout
                                  initial={{ opacity: 0, scale: 0.8, y: 40 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.8, y: -40 }}
                                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                                >
                                  <UnoCard
                                    card={card}
                                    isPlayable={isPlayable}
                                    onClick={() => handlePlayCardAttempt(card)}
                                    size="md"
                                  />
                                </motion.div>
                              );
                            })}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              )}

            </div>

            {/* LOBBY / TABLE RIGHT CONSOLE: SIDE COLUMN FOR CHAT + LOGS */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              
              {/* CHAT/LOGS PANE */}
              <div className="bg-[#0e0e11] border border-white/5 rounded-3xl p-4 flex flex-col h-full min-h-[460px] max-h-[690px] shadow-2xl relative justify-between overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/5 pb-2.5 mb-2.5">
                  <h3 className="text-[10px] font-bold tracking-[0.2em] text-white/50 uppercase flex items-center gap-1.5">
                    <MessageSquare size={13} className="text-[#d4af37]" /> TABLE TALK LOBBY
                  </h3>
                  <span className="text-[9px] bg-[#050506] border border-white/5 text-[#d4af37] px-2.5 py-0.5 rounded-full font-mono uppercase font-bold tracking-wider">
                    {chats.length} logs
                  </span>
                </div>

                {/* SCROLLER CHATS / NEWSFEED */}
                <div id="chats-scroller-box" className="flex-1 overflow-y-auto mb-4 pr-1 flex flex-col gap-2 p-1.5 bg-[#050506]/95 rounded-2xl border border-white/5 shadow-inner">
                  {chats.length === 0 ? (
                    <div className="my-auto text-white/20 text-[10px] font-bold uppercase tracking-widest text-center italic">
                      No cards played or chats sent yet... 👋
                    </div>
                  ) : (
                    chats.map((msg) => {
                      if (msg.isSystem) {
                        return (
                          <div
                            key={msg.id}
                            className="py-1 px-2.5 bg-white/[0.01] rounded-lg text-[10px] sm:text-xs leading-normal border-l-2 border-[#d4af37]/30"
                          >
                            <span className="text-white/30 pr-1.5 font-mono text-[9px]">{msg.timestamp}</span>
                            <span className="text-white/60" dangerouslySetInnerHTML={{ __html: msg.text }} />
                          </div>
                        );
                      }

                      // Normal message formatting
                      const senderPreset = COLOR_PRESETS.find(col => col.id === msg.senderColor);
                      const nameHighlightColor = senderPreset ? senderPreset.theme : 'zinc-400';

                      return (
                        <div
                          key={msg.id}
                          className="p-2 bg-white/[0.02] border border-white/5 rounded-xl leading-snug flex flex-col gap-0.5"
                        >
                          <div className="flex justify-between items-baseline">
                            <span className={`text-[10px] font-bold tracking-wide text-${nameHighlightColor}`}>
                              {msg.senderName}
                            </span>
                            <span className="text-[9px] text-white/30 font-mono">{msg.timestamp}</span>
                          </div>
                          <p id={`chat-text-${msg.id}`} className="text-xs text-white/80 font-medium break-all whitespace-pre-wrap">{msg.text}</p>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* INPUT FORM FOR CHAT */}
                <form id="chat-composer" onSubmit={sendChatMessage} className="flex gap-2 relative">
                  <input
                    id="chat-text-input"
                    type="text"
                    maxLength={100}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1 bg-[#050506] border border-white/10 focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] rounded-xl py-2 px-3 text-xs outline-none text-white placeholder:text-white/25 transition duration-300"
                    placeholder="Send message to table..."
                  />
                  <button
                    id="chat-send-btn"
                    type="submit"
                    disabled={!chatInput.trim()}
                    className="p-2.5 rounded-full bg-[#d4af37] hover:bg-white text-black disabled:opacity-40 transition duration-300 cursor-pointer"
                  >
                    <SendHorizontal size={13} className="text-black" />
                  </button>
                </form>
              </div>

            </div>

          </div>
        )}
      </main>

      {/* 🌈 COLORED QUADRANT SELECTION DIALOG (OVERLAY) */}
      <AnimatePresence>
        {pendingWildCardUid && (
          <ColorChooser
            onSelect={handleColorSelection}
            onCancel={() => {
              setPendingWildCardUid(null);
              setIsDrawnCardChoice(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* 📝 DEEP RULES MODAL */}
      <AnimatePresence>
        {gameRulesOpen && (
          <div id="rules-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md animate-fade-in p-4">
            <div className="bg-[#0e0e11] border border-white/5 rounded-3xl p-6 w-full max-w-md shadow-2xl relative max-h-[90vh] overflow-y-auto">
              <button
                id="close-rules-btn"
                onClick={() => setGameRulesOpen(false)}
                className="absolute top-4 right-4 p-2 text-white/40 hover:text-white transition text-lg"
              >
                ×
              </button>
              <h3 className="text-lg font-serif italic text-[#d4af37] mb-2 tracking-wide flex items-center gap-1.5">
                📚 TABLE RULES & CARDS
              </h3>
              <p className="text-xs text-white/40 mb-4 pb-2 border-b border-white/5">
                Play cards, match elements, trap opponents, and declare UNO before entering the final card sequence.
              </p>

              <div className="flex flex-col gap-4 text-xs text-white/60 leading-relaxed">
                <div>
                  <h4 className="font-bold text-white mb-1">🎮 Core Deck Cycle</h4>
                  <p>On your active turn, place down an element corresponding with the color or value index on top of the discard pile. If you can't play, draw. Drawn valid items may be deployed instantly.</p>
                </div>

                <div>
                  <h4 className="font-bold text-white mb-1">⚡ Interactive Spells</h4>
                  <ul className="list-disc list-inside space-y-1">
                    <li><b className="text-rose-400">Skip 🚫</b>: Disables the imminent opponent.</li>
                    <li><b className="text-sky-400">Reverse ⇅</b>: Switches sequence flow.</li>
                    <li><b className="text-[#d4af37]">Draw 2 ✌️</b>: Forces a 2 card trap and skips target player.</li>
                    <li><b className="text-emerald-400">Wild 🌈</b>: Overrides the color theme.</li>
                    <li><b className="text-purple-400">Wild Draw 4 🖐️</b>: Changes color, penalizes next seat with 4 draws, and skips.</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-bold text-white mb-1">📢 Hand Declaration Rule</h4>
                  <p>When down to 1 card, declare your victory path using <b>📢 SAY UNO!</b> prior to card deployment. Forgot? Opponents will target you with a <b>🚨 Challenge</b> trigger to penalize you with 2 extra cards.</p>
                </div>
              </div>

              <button
                id="close-rules-confirm"
                onClick={() => setGameRulesOpen(false)}
                className="w-full mt-6 py-3 bg-[#d4af37] hover:bg-white text-black text-xs font-bold uppercase tracking-widest rounded-full transition duration-300 cursor-pointer"
              >
                Enter Arena
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* FOOTER METADATA */}
      <footer id="global-game-footer" className="py-6 px-4 bg-[#050506] border-t border-white/5 text-center text-[10px] text-white/20 select-none">
        <p className="font-bold tracking-[0.25em] uppercase">Multiplayer UNO Table © 2026</p>
        <p className="mt-1 max-w-sm mx-auto">Luxury dark edition. Created with premium UI craft utilizing custom font accents and instant peer coordination.</p>
      </footer>
    </div>
  );
}
