import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { Card, CardColor, CardValue, GameRoomState, Player, ChatMessage } from './src/types';

const app = express();
const PORT = 3000;

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Multiplayer Uno Server', time: new Date() });
});

// Create HTTP server
const httpServer = createHttpServer(app);

// In-memory persistent database of game rooms
const rooms = new Map<string, {
  roomId: string;
  players: Player[];
  status: 'lobby' | 'playing' | 'game_over';
  currentTurnIdx: number;
  direction: 1 | -1;
  deck: Card[];
  discardPile: Card[];
  currentCard: Card | null;
  activeColor: CardColor | null;
  winner: Player | null;
  lastActionDescription: string;
  lastActionSound?: 'play' | 'draw' | 'uno' | 'error' | 'win' | 'start' | 'shuffle';
  chats: ChatMessage[];
  drawnCardThisTurn: Card | null; // Stores card drawn but not yet kept/played
  maxPlayers?: number;
}>();

// Map sockets to metadata
interface SocketSession {
  ws: WebSocket;
  roomId: string | null;
  playerId: string | null;
}
const socketSessions = new Map<WebSocket, SocketSession>();

// Track running timeouts for bots to prevent overlapping triggers
const botTimeouts = new Map<string, NodeJS.Timeout>();

// Helper to generate a room ID
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars (I, O, 0, 1)
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// UNO Deck Generator
function createDeck(): Card[] {
  const deck: Card[] = [];
  const COLORS: CardColor[] = ['red', 'blue', 'green', 'yellow'];
  const VALUES: CardValue[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', 'Draw2'];

  let idCounter = 1;

  for (const color of COLORS) {
    // One '0' per color
    deck.push({ uid: `card_${idCounter++}`, color, value: '0' });
    
    // Two of 1-9 per color
    for (let i = 1; i <= 9; i++) {
      const v = String(i) as CardValue;
      deck.push({ uid: `card_${idCounter++}`, color, value: v });
      deck.push({ uid: `card_${idCounter++}`, color, value: v });
    }
    
    // Two of specialized action cards per color
    for (const act of ['Skip', 'Reverse', 'Draw2'] as CardValue[]) {
      deck.push({ uid: `card_${idCounter++}`, color, value: act });
      deck.push({ uid: `card_${idCounter++}`, color, value: act });
    }
  }

  // Four of Wild and Wild Draw 4
  for (let i = 0; i < 4; i++) {
    deck.push({ uid: `card_${idCounter++}`, color: 'black', value: 'Wild' });
    deck.push({ uid: `card_${idCounter++}`, color: 'black', value: 'Wild4' });
  }

  return shuffle(deck);
}

function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Help send standardized state to players
function getSanitizedRoomState(room: ReturnType<typeof rooms.get> & {}, recipientPlayerId: string): GameRoomState {
  // Sanitize player hands so clients only see their own cards
  const playersSanitized = room.players.map((p) => {
    const isSelf = p.id === recipientPlayerId;
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      color: p.color,
      isHost: p.isHost,
      isBot: p.isBot,
      handCount: p.isBot ? (p.hand?.length || 0) : (p.hand?.length || 0),
      unoDeclared: p.unoDeclared,
      // Only include the hand for yourself (or if the game is over, reveal hands)
      hand: (isSelf || room.status === 'game_over') ? p.hand : undefined,
    };
  });

  return {
    roomId: room.roomId,
    players: playersSanitized,
    status: room.status,
    currentTurnIdx: room.currentTurnIdx,
    direction: room.direction,
    currentCard: room.currentCard,
    activeColor: room.activeColor,
    winner: room.winner,
    deckCount: room.deck.length,
    discardPileCount: room.discardPile.length,
    lastActionDescription: room.lastActionDescription,
    lastActionSound: room.lastActionSound,
    maxPlayers: room.maxPlayers || 8,
  };
}

// Broadcast game state to everyone in the room
function broadcastRoom(roomId: string, extraData?: any) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Send tailored state to each connection in this room
  for (const [ws, session] of socketSessions.entries()) {
    if (session.roomId === roomId && session.playerId) {
      try {
        const payload: any = {
          type: 'room_state',
          room: getSanitizedRoomState(room, session.playerId),
          chats: room.chats,
        };
        // Option to include drawnCardPending if it belongs to this player
        if (room.drawnCardThisTurn && room.players[room.currentTurnIdx]?.id === session.playerId) {
          payload.drawnCardPending = room.drawnCardThisTurn;
        }

        if (extraData) {
          Object.assign(payload, extraData);
        }

        ws.send(JSON.stringify(payload));
      } catch (err) {
        console.error('Broadcast failed for a socket:', err);
      }
    }
  }
}

// Helper to advance the turn
function advanceTurn(room: any, steps: number = 1) {
  const count = room.players.length;
  if (count === 0) return;
  
  // Advance by taking into account the direction
  const mod = (room.currentTurnIdx + (steps * room.direction)) % count;
  room.currentTurnIdx = mod < 0 ? mod + count : mod;
  room.drawnCardThisTurn = null; // Always reset draw cache on turn transition
  
  // Reset last action sound for the next idle action unless explicitly set
  room.lastActionSound = undefined;
}

// Draw cards helper with safe deck recycling
function drawCards(room: any, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (room.deck.length === 0) {
      if (room.discardPile.length <= 1) {
        // Can't draw anymore, deck completely dry
        break;
      }
      // Re-shuffle discard pile into draw deck
      console.log(`Shuffling discard pile into draw deck for Room ${room.roomId}`);
      const topCard = room.discardPile.pop()!;
      room.deck = shuffle(room.discardPile);
      room.discardPile = [topCard];
      room.lastActionSound = 'shuffle';
    }
    const card = room.deck.pop();
    if (card) drawn.push(card);
  }
  return drawn;
}

// Check validation of play
function isValidPlay(card: Card, activeColor: CardColor | null, currentCard: Card | null): boolean {
  if (card.color === 'black') return true; // Wild/Wild4 is always playable
  if (!currentCard) return true;
  
  const targetColor = activeColor || currentCard.color;
  return card.color === targetColor || card.value === currentCard.value;
}

// Add system chat message helper
function addSystemChat(room: any, text: string) {
  const msg: ChatMessage = {
    id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    senderName: 'SYSTEM 🔴',
    text,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    isSystem: true,
  };
  room.chats.push(msg);
  if (room.chats.length > 50) room.chats.shift();
}

// Main logic for AI Bot gameplay
function executeBotTurn(roomId: string, botPlayerId: string) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') return;

  const activePlayer = room.players[room.currentTurnIdx];
  if (!activePlayer || activePlayer.id !== botPlayerId || !activePlayer.isBot) return;

  const hand = activePlayer.hand || [];
  
  // Find playable cards
  const playableCards = hand.filter(card => isValidPlay(card, room.activeColor, room.currentCard));

  if (playableCards.length > 0) {
    // Bot chooses card to play! Priority: Action cards > high number digits
    playableCards.sort((a, b) => {
      const aIsAction = ['Skip', 'Reverse', 'Draw2', 'Wild4'].includes(a.value);
      const bIsAction = ['Skip', 'Reverse', 'Draw2', 'Wild4'].includes(b.value);
      if (aIsAction && !bIsAction) return -1;
      if (!aIsAction && bIsAction) return 1;
      return 0; // standard order
    });

    const chosenCard = playableCards[0];
    
    // Choose wild color if playing Wild or Wild4
    let chosenColor: CardColor = 'red';
    if (chosenCard.color === 'black') {
      // Pick color with most counts in bot's hand
      const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
      hand.forEach((card) => {
        if (card.color !== 'black') {
          counts[card.color]++;
        }
      });
      const entries = Object.entries(counts) as [CardColor, number][];
      entries.sort((a, b) => b[1] - a[1]);
      chosenColor = entries[0][0]; // highest count
    }

    // Play card
    activePlayer.hand = hand.filter(c => c.uid !== chosenCard.uid);
    activePlayer.handCount = activePlayer.hand.length;
    
    // If playing card leaves them with exactly 1 card, they say UNO! (100% of the time, bots never forget unless we make them lazy—it's cleaner if they do)
    if (activePlayer.hand.length === 1) {
      activePlayer.unoDeclared = true;
      room.lastActionSound = 'uno';
      addSystemChat(room, `🤖 Bot ${activePlayer.name} declared UNO! 🎴`);
    } else {
      activePlayer.unoDeclared = false;
    }

    const previousCard = room.currentCard;
    room.discardPile.push(chosenCard);
    room.currentCard = chosenCard;
    room.activeColor = chosenCard.color === 'black' ? chosenColor : null;
    room.lastActionSound = room.lastActionSound === 'uno' ? 'uno' : 'play';

    let actionLabel = `${activePlayer.name} played **${chosenCard.color.toUpperCase()} ${chosenCard.value}**`;
    if (chosenCard.color === 'black') {
      actionLabel = `${activePlayer.name} played **${chosenCard.value}**, choosing **${chosenColor.toUpperCase()}**`;
    }
    room.lastActionDescription = actionLabel;

    // Check game over
    if (activePlayer.hand.length === 0) {
      room.status = 'game_over';
      room.winner = activePlayer;
      room.lastActionSound = 'win';
      room.lastActionDescription = `🏆 Game Over! ${activePlayer.name} won the UNO match!`;
      addSystemChat(room, `🎉 Bot ${activePlayer.name} wins the match!`);
      broadcastRoom(roomId);
      return;
    }

    // Apply special actions
    applyCardSideEffects(room, chosenCard, chosenColor);

  } else {
    // Bot has to draw card!
    const drawn = drawCards(room, 1);
    if (drawn.length > 0) {
      const card = drawn[0];
      
      // Bot checks if drawn card is playable immediately
      if (isValidPlay(card, room.activeColor, room.currentCard)) {
        // Play it immediately!
        let chosenColor: CardColor = 'red';
        if (card.color === 'black') {
          const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
          hand.forEach(c => c.color !== 'black' && counts[c.color]++);
          const entries = Object.entries(counts) as [CardColor, number][];
          entries.sort((a, b) => b[1] - a[1]);
          chosenColor = entries[0][0];
        }

        room.discardPile.push(card);
        room.currentCard = card;
        room.activeColor = card.color === 'black' ? chosenColor : null;
        room.lastActionSound = 'play';
        activePlayer.unoDeclared = false; // drawn card was played

        let drawPlayLabel = `🤖 ${activePlayer.name} drew and played **${card.color.toUpperCase()} ${card.value}**`;
        if (card.color === 'black') {
          drawPlayLabel = `🤖 ${activePlayer.name} drew and played **${card.value}**, choosing **${chosenColor.toUpperCase()}**`;
        }
        room.lastActionDescription = drawPlayLabel;

        applyCardSideEffects(room, card, chosenColor);
      } else {
        // Just keep the card and end turn
        hand.push(card);
        activePlayer.hand = hand;
        activePlayer.handCount = hand.length;
        activePlayer.unoDeclared = false;
        
        room.lastActionDescription = `🤖 ${activePlayer.name} had no playable card, so they drew one and passed.`;
        room.lastActionSound = 'draw';
        advanceTurn(room);
      }
    } else {
      room.lastActionDescription = `🤖 ${activePlayer.name} passed (no cards left in draw deck!).`;
      advanceTurn(room);
    }
  }

  broadcastRoom(roomId);
  
  // Trigger next bot if it's their turn
  const nextPlayer = room.players[room.currentTurnIdx];
  if (nextPlayer && nextPlayer.isBot && room.status === 'playing') {
    triggerBotTurnSequence(roomId, nextPlayer.id);
  }
}

// Central bot scheduling mechanism
function triggerBotTurnSequence(roomId: string, botId: string) {
  // Clear any existing timeout for this room to avoid double ticks
  if (botTimeouts.has(roomId)) {
    clearTimeout(botTimeouts.get(roomId));
    botTimeouts.delete(roomId);
  }

  const timeout = setTimeout(() => {
    executeBotTurn(roomId, botId);
  }, 1600);
  botTimeouts.set(roomId, timeout);
}

// Side effects logic: Skip, Reverse, Draw2, Wild4, etc.
function applyCardSideEffects(room: any, card: Card, chosenColor: CardColor) {
  switch (card.value) {
    case 'Skip':
      // Skips next player. We advance once for play, another once for skip.
      advanceTurn(room, 1);
      const skippedPlayer = room.players[room.currentTurnIdx];
      room.lastActionDescription += ` | Skipped **${skippedPlayer.name}**! 🚫`;
      addSystemChat(room, `🚫 ${skippedPlayer.name} was skipped!`);
      advanceTurn(room, 1);
      break;

    case 'Reverse':
      if (room.players.length === 2) {
        // In 2 player game, Reverse behaves exactly like Skip
        advanceTurn(room, 1);
        const skippedP = room.players[room.currentTurnIdx];
        room.lastActionDescription += ` | Skipped **${skippedP.name}**! 🚫`;
        addSystemChat(room, `🚫 ${skippedP.name} is skipped!`);
        advanceTurn(room, 1);
      } else {
        // Flip direction
        room.direction = room.direction === 1 ? -1 : 1;
        room.lastActionDescription += ` | Reversed directon of play! 🔄`;
        addSystemChat(room, `🔄 Order direction was reversed!`);
        advanceTurn(room, 1);
      }
      break;

    case 'Draw2':
      // Get next player index to draw cards and skip their turn
      advanceTurn(room, 1);
      const victim = room.players[room.currentTurnIdx];
      const penaltyCards = drawCards(room, 2);
      
      victim.hand = [...(victim.hand || []), ...penaltyCards];
      victim.handCount = victim.hand.length;
      victim.unoDeclared = false;

      room.lastActionDescription += ` | Forced **${victim.name}** to draw 2 and skip! ✌️`;
      addSystemChat(room, `✌️ ${victim.name} drew 2 and was skipped!`);
      advanceTurn(room, 1); // skip victim turn
      break;

    case 'Wild4':
      // Get next player index
      advanceTurn(room, 1);
      const draw4Victim = room.players[room.currentTurnIdx];
      const draw4Cards = drawCards(room, 4);

      draw4Victim.hand = [...(draw4Victim.hand || []), ...draw4Cards];
      draw4Victim.handCount = draw4Victim.hand.length;
      draw4Victim.unoDeclared = false;

      room.lastActionDescription += ` | Forced **${draw4Victim.name}** to draw 4 and skip! 🖐️`;
      addSystemChat(room, `🖐️ ${draw4Victim.name} drew 4 and was skipped!`);
      advanceTurn(room, 1); // skip victim turn
      break;

    default:
      // Just standard number card, advance turn by 1
      advanceTurn(room, 1);
      break;
  }
}

// Websocket logic
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  // Init session
  socketSessions.set(ws, { ws, roomId: null, playerId: null });
  console.log('New WebSocket user connected');

  ws.on('message', (messageString) => {
    try {
      const packet = JSON.parse(messageString.toString());
      const { type, data } = packet;
      const session = socketSessions.get(ws);
      if (!session) return;

      switch (type) {
        // CREATE A NEW LOBBY
        case 'create_room': {
          const roomId = generateRoomCode();
          const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          
          const creator: Player = {
            id: playerId,
            name: data.name?.trim() || `Host_${Math.floor(Math.random() * 899 + 100)}`,
            avatar: data.avatar || '👑',
            color: data.color || 'blue',
            isHost: true,
            isBot: false,
            handCount: 0,
            hand: [],
            unoDeclared: false,
          };

          const reqMax = Number(data.maxPlayers);
          const maxPlayersLimit = (!isNaN(reqMax) && reqMax >= 2) ? reqMax : 8;

          rooms.set(roomId, {
            roomId,
            players: [creator],
            status: 'lobby',
            currentTurnIdx: 0,
            direction: 1,
            deck: [],
            discardPile: [],
            currentCard: null,
            activeColor: null,
            winner: null,
            lastActionDescription: 'Room created. Welcome to UNO!',
            lastActionSound: 'shuffle',
            chats: [],
            drawnCardThisTurn: null,
            maxPlayers: maxPlayersLimit,
          });

          session.roomId = roomId;
          session.playerId = playerId;

          const room = rooms.get(roomId)!;
          addSystemChat(room, `👋 ${creator.name} opened the room Lobby! Seat capacity set to **${maxPlayersLimit} players**. Room Code: ${roomId}`);

          // Reply with confirmation
          ws.send(JSON.stringify({
            type: 'join_success',
            roomId,
            playerId,
            isHost: true,
          }));

          broadcastRoom(roomId);
          break;
        }

        // JOIN EXISTING LOBBY WITH A CODE
        case 'join_room': {
          const rId = data.roomId?.toUpperCase().trim();
          const room = rooms.get(rId);

          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: `Room Code "${rId}" not found!` }));
            return;
          }

          if (room.status === 'playing' && !data.reconnectPlayerId) {
            ws.send(JSON.stringify({ type: 'error', message: 'This game has already started!' }));
            return;
          }

          let playerId = data.reconnectPlayerId;
          let isHost = false;

          // Attempt reconnection recovery back to active seat
          if (playerId && room.players.find(p => p.id === playerId)) {
            const reconnectingPlayer = room.players.find(p => p.id === playerId)!;
            session.roomId = rId;
            session.playerId = playerId;
            isHost = reconnectingPlayer.isHost;

            addSystemChat(room, `⚡ ${reconnectingPlayer.name} reconnected to their seat.`);
            
            ws.send(JSON.stringify({
              type: 'join_success',
              roomId: rId,
              playerId,
              isHost,
            }));

            broadcastRoom(rId);
            return;
          }

          // Otherwise, join as a new player
          const limit = room.maxPlayers || 8;
          if (room.players.length >= limit) {
            ws.send(JSON.stringify({ type: 'error', message: `Room lobby is full! (Max ${limit} players)` }));
            return;
          }

          playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          const newPlayer: Player = {
            id: playerId,
            name: data.name?.trim() || `Player_${Math.floor(Math.random() * 899 + 100)}`,
            avatar: data.avatar || '🦊',
            color: data.color || 'purple',
            isHost: false,
            isBot: false,
            handCount: 0,
            hand: [],
            unoDeclared: false,
          };

          room.players.push(newPlayer);
          session.roomId = rId;
          session.playerId = playerId;

          addSystemChat(room, `🚪 ${newPlayer.name} joined the lobby.`);

          ws.send(JSON.stringify({
            type: 'join_success',
            roomId: rId,
            playerId,
            isHost: false,
          }));

          broadcastRoom(rId);
          break;
        }

        // ADD BOT TO THE ROOM (Host only)
        case 'add_bot': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          // Check permissions
          const hostPlayer = room.players.find(p => p.id === session.playerId);
          if (!hostPlayer || !hostPlayer.isHost) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only hosts can add bots!' }));
            return;
          }

          const limit = room.maxPlayers || 8;
          if (room.players.length >= limit) {
            ws.send(JSON.stringify({ type: 'error', message: `Cannot add bot, room is full (Max ${limit} players).` }));
            return;
          }

          const botAvatars = ['🤖', '🐱', '🦖', '🦁', '🦄', '🐼', '🐙', '🐸'];
          const botNames = ['RoboUno', 'ByteSize', 'Chipster', 'Nvidia', 'Gemibot', 'Quantum', 'Pixel', 'BitFlip'];
          const usedNames = new Set(room.players.map(p => p.name));
          const freeName = botNames.find(n => !usedNames.has(n)) || `Bot_${room.players.length}`;
          const randAvatar = botAvatars[Math.floor(Math.random() * botAvatars.length)];

          const botPlay: Player = {
            id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            name: freeName,
            avatar: randAvatar,
            color: 'zinc',
            isHost: false,
            isBot: true,
            handCount: 0,
            hand: [],
            unoDeclared: false,
          };

          room.players.push(botPlay);
          addSystemChat(room, `🤖 ${botPlay.name} (AI Bot) has been added to the game lobby.`);
          broadcastRoom(rId!);
          break;
        }

        // UPDATE ROOM CAPACITY (Host only)
        case 'update_capacity': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          const hostPlayer = room.players.find(p => p.id === session.playerId);
          if (!hostPlayer || !hostPlayer.isHost) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only hosts can change room capacity!' }));
            return;
          }

          const newMax = Number(data.maxPlayers);
          if (isNaN(newMax) || newMax < 2) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid capacity size!' }));
            return;
          }

          if (room.players.length > newMax) {
            ws.send(JSON.stringify({ type: 'error', message: `Cannot set capacity to ${newMax} because there are already ${room.players.length} active players!` }));
            return;
          }

          room.maxPlayers = newMax;
          addSystemChat(room, `⚙️ Host updated the room seat capacity to **${newMax} players**.`);
          broadcastRoom(rId!);
          break;
        }

        // KICK / REMOVE PLAYER OR BOT (Host only)
        case 'remove_player': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          const hostPlayer = room.players.find(p => p.id === session.playerId);
          if (!hostPlayer || !hostPlayer.isHost) return;

          const targetId = data.playerId;
          if (targetId === session.playerId) return; // Cannot kick yourself

          const kickedPlayer = room.players.find(p => p.id === targetId);
          if (!kickedPlayer) return;

          room.players = room.players.filter(p => p.id !== targetId);
          addSystemChat(room, `🚪 ${kickedPlayer.name} was removed from the lobby.`);

          // If playing and the kicked player was the active turn, advance turn or reset
          if (room.status === 'playing') {
            if (room.currentTurnIdx >= room.players.length) {
              room.currentTurnIdx = 0;
            }
            // Trigger next bot if it's bot turn
            const activePlayer = room.players[room.currentTurnIdx];
            if (activePlayer && activePlayer.isBot) {
              triggerBotTurnSequence(rId!, activePlayer.id);
            }
          }

          // Disconnect client socket from this room
          for (const [sWs, sSession] of socketSessions.entries()) {
            if (sSession.playerId === targetId) {
              sSession.roomId = null;
              sSession.playerId = null;
              try {
                sWs.send(JSON.stringify({ type: 'kicked', message: 'You were kicked from the room.' }));
              } catch (_) {}
            }
          }

          broadcastRoom(rId!);
          break;
        }

        // START GAME
        case 'start_game': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          const hostPlayer = room.players.find(p => p.id === session.playerId);
          if (!hostPlayer || !hostPlayer.isHost) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only hosts can start the game!' }));
            return;
          }

          if (room.players.length < 2) {
            ws.send(JSON.stringify({ type: 'error', message: 'At least 2 players (including bots) are required to start!' }));
            return;
          }

          // Generate Deck
          room.deck = createDeck();
          room.discardPile = [];
          
          // Deal 7 cards to each player
          for (const player of room.players) {
            player.hand = drawCards(room, 7);
            player.handCount = player.hand.length;
            player.unoDeclared = false;
          }

          // Locate starting card: must NOT be Wild or Wild Draw 4
          let startCard = room.deck.pop();
          while (startCard && startCard.color === 'black') {
            room.deck.unshift(startCard); // add back to other end
            startCard = room.deck.pop();
          }

          if (!startCard) {
            startCard = { uid: 'card_fallback', color: 'red', value: '4' };
          }

          room.discardPile.push(startCard);
          room.currentCard = startCard;
          room.activeColor = null;
          room.status = 'playing';
          room.winner = null;
          room.currentTurnIdx = 0; // Host goes first
          room.direction = 1;
          room.lastActionSound = 'start';
          room.lastActionDescription = '🎮 Game has started! It is your turn!';

          addSystemChat(room, `🎮 Match started! Top card is **${startCard.color.toUpperCase()} ${startCard.value}**.`);

          // Apply initial card effects if first card is Skip/Reverse/Draw2
          if (startCard.value === 'Skip') {
            room.currentTurnIdx = 1 % room.players.length;
            room.lastActionDescription = `Starting card was Skip! **${room.players[0].name}** was skipped. **${room.players[room.currentTurnIdx].name}** goes first.`;
            addSystemChat(room, `🚫 ${room.players[0].name} was skipped at turn zero!`);
          } else if (startCard.value === 'Reverse') {
            room.direction = -1;
            room.currentTurnIdx = room.players.length - 1; // last player starts
            room.lastActionDescription = `Starting card was Reverse! Play proceeds counter-clockwise. **${room.players[room.currentTurnIdx].name}** goes first.`;
            addSystemChat(room, `🔄 Order is reversed: going counter-clockwise.`);
          } else if (startCard.value === 'Draw2') {
            const victim = room.players[0];
            const draws = drawCards(room, 2);
            victim.hand = [...(victim.hand || []), ...draws];
            victim.handCount = victim.hand.length;
            
            room.currentTurnIdx = 1 % room.players.length;
            room.lastActionDescription = `Starting card was Draw2! **${victim.name}** drew 2 cards and was skipped. **${room.players[room.currentTurnIdx].name}** goes first.`;
            addSystemChat(room, `✌️ ${victim.name} drew 2 cards at start!`);
          }

          broadcastRoom(rId!);

          // If the starting turn belongs to a bot, schedule bot play
          const firstPlayer = room.players[room.currentTurnIdx];
          if (firstPlayer && firstPlayer.isBot) {
            triggerBotTurnSequence(rId!, firstPlayer.id);
          }
          break;
        }

        // PLAY A CARD
        case 'play_card': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          if (room.status !== 'playing') return;

          const activeSeatPlayer = room.players[room.currentTurnIdx];
          if (!activeSeatPlayer || activeSeatPlayer.id !== session.playerId) {
            ws.send(JSON.stringify({ type: 'error', message: "It is not your turn!" }));
            return;
          }

          const cardUid = data.cardUid;
          const declaredColor = data.declaredColor as CardColor | undefined;

          const hand = activeSeatPlayer.hand || [];
          const cardIdx = hand.findIndex(c => c.uid === cardUid);

          if (cardIdx === -1) {
            ws.send(JSON.stringify({ type: 'error', message: "You don't have this card!" }));
            return;
          }

          const cardToPlay = hand[cardIdx];

          // Check valid play
          if (!isValidPlay(cardToPlay, room.activeColor, room.currentCard)) {
            ws.send(JSON.stringify({ type: 'error', message: "Card mismatch color or number!" }));
            return;
          }

          if (cardToPlay.color === 'black' && !declaredColor) {
            ws.send(JSON.stringify({ type: 'error', message: "Please specify a color for wild action!" }));
            return;
          }

          // Play the card!
          activeSeatPlayer.hand = hand.filter(c => c.uid !== cardUid);
          activeSeatPlayer.handCount = activeSeatPlayer.hand.length;

          // Double check UNO rule: Playing your card leaves you with 1 card.
          // Player must set safe flag via Client "SAY UNO" action before playing card, or we can check.
          const leftWithCardCount = activeSeatPlayer.hand.length;
          const unoToggled = activeSeatPlayer.unoDeclared;

          if (leftWithCardCount === 1 && !unoToggled) {
            // Player played down to 1 card but DID NOT set UNO declaration trigger
            activeSeatPlayer.unoDeclared = false;
            room.lastActionSound = 'play';
            // Mark last action so others can safely challenge them
          } else if (leftWithCardCount === 1 && unoToggled) {
            // Player successfully declared UNO
            room.lastActionSound = 'uno';
            addSystemChat(room, `🎴 ${activeSeatPlayer.name} declared **UNO**!`);
          } else {
            // Safe, reset declared flag
            activeSeatPlayer.unoDeclared = false;
            room.lastActionSound = 'play';
          }

          room.discardPile.push(cardToPlay);
          room.currentCard = cardToPlay;
          // Wild card overrides active Color
          room.activeColor = cardToPlay.color === 'black' ? declaredColor! : null;

          let actText = `${activeSeatPlayer.name} played **${cardToPlay.color.toUpperCase()} ${cardToPlay.value}**`;
          if (cardToPlay.color === 'black') {
            actText = `${activeSeatPlayer.name} played **${cardToPlay.value}**, choosing **${declaredColor!.toUpperCase()}**`;
          }
          room.lastActionDescription = actText;

          // If winner wins!
          if (activeSeatPlayer.hand.length === 0) {
            room.status = 'game_over';
            room.winner = activeSeatPlayer;
            room.lastActionSound = 'win';
            room.lastActionDescription = `🏆 Game Over! ${activeSeatPlayer.name} won the UNO match!`;
            addSystemChat(room, `🎉 ${activeSeatPlayer.name} won the game! 🏆`);
            broadcastRoom(rId!);
            return;
          }

          // Apply card Side effects and advance turn
          applyCardSideEffects(room, cardToPlay, declaredColor || 'red');
          broadcastRoom(rId!);

          // Schedule next bot if active turn belongs to AI bot
          const nextP = room.players[room.currentTurnIdx];
          if (nextP && nextP.isBot && room.status === 'playing') {
            triggerBotTurnSequence(rId!, nextP.id);
          }
          break;
        }

        // DRAW CARD FROM DECK
        case 'draw_card': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          if (room.status !== 'playing') return;

          const activeSeatPlayer = room.players[room.currentTurnIdx];
          if (!activeSeatPlayer || activeSeatPlayer.id !== session.playerId) {
            ws.send(JSON.stringify({ type: 'error', message: 'It is not your turn!' }));
            return;
          }

          if (room.drawnCardThisTurn) {
            ws.send(JSON.stringify({ type: 'error', message: 'You already drew a card this turn!' }));
            return;
          }

          const drawn = drawCards(room, 1);
          if (drawn.length > 0) {
            const card = drawn[0];
            room.drawnCardThisTurn = card; // Hold in temporary hand transition cache
            
            room.lastActionDescription = `${activeSeatPlayer.name} drew a card.`;
            room.lastActionSound = 'draw';
            activeSeatPlayer.unoDeclared = false; // drew cards resets uno declaration

            // If card is playable, we don't automatically advance turn.
            // We broadcast state back showing the drawn card so UI can prompt "Play" or "Keep"
            const isPlayable = isValidPlay(card, room.activeColor, room.currentCard);

            if (!isPlayable) {
              // Forced keep because not playable, push to hand directly and end turn
              activeSeatPlayer.hand = [...(activeSeatPlayer.hand || []), card];
              activeSeatPlayer.handCount = activeSeatPlayer.hand.length;
              room.drawnCardThisTurn = null;
              
              room.lastActionDescription = `${activeSeatPlayer.name} drew a card (not playable, auto-keeping) and passed.`;
              advanceTurn(room);
              broadcastRoom(rId!);

              // Proceed with bot if it's bot turn
              const nextP = room.players[room.currentTurnIdx];
              if (nextP && nextP.isBot && room.status === 'playing') {
                triggerBotTurnSequence(rId!, nextP.id);
              }
            } else {
              // Present choices inside UI. Send custom state
              broadcastRoom(rId!);
            }
          } else {
            // Deck is completely dry, just pass
            room.lastActionDescription = `${activeSeatPlayer.name} tried to draw a card but draw deck was completely dry. Passed.`;
            advanceTurn(room);
            broadcastRoom(rId!);

            // Bot check
            const nextP = room.players[room.currentTurnIdx];
            if (nextP && nextP.isBot && room.status === 'playing') {
              triggerBotTurnSequence(rId!, nextP.id);
            }
          }
          break;
        }

        // DECISION: KEEP DRAWN CARD (PASS TURN)
        case 'keep_drawn_card': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          if (room.status !== 'playing') return;

          const activeSeatPlayer = room.players[room.currentTurnIdx];
          if (!activeSeatPlayer || activeSeatPlayer.id !== session.playerId) return;

          const card = room.drawnCardThisTurn;
          if (!card) return;

          // Push into actual hand
          activeSeatPlayer.hand = [...(activeSeatPlayer.hand || []), card];
          activeSeatPlayer.handCount = activeSeatPlayer.hand.length;
          room.drawnCardThisTurn = null;

          room.lastActionDescription = `${activeSeatPlayer.name} chose to keep the drawn card and passed.`;
          room.lastActionSound = 'draw';

          advanceTurn(room);
          broadcastRoom(rId!);

          // Proceed with bot if appropriate
          const nextP = room.players[room.currentTurnIdx];
          if (nextP && nextP.isBot && room.status === 'playing') {
            triggerBotTurnSequence(rId!, nextP.id);
          }
          break;
        }

        // DECISION: PLAY DRAWN CARD
        case 'play_drawn_card': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          if (room.status !== 'playing') return;

          const activeSeatPlayer = room.players[room.currentTurnIdx];
          if (!activeSeatPlayer || activeSeatPlayer.id !== session.playerId) return;

          const card = room.drawnCardThisTurn;
          if (!card) return;

          const declaredColor = data.declaredColor as CardColor | undefined;
          if (card.color === 'black' && !declaredColor) {
            ws.send(JSON.stringify({ type: 'error', message: 'Specify color choice for Wild card play!' }));
            return;
          }

          // Play it
          room.drawnCardThisTurn = null;
          room.discardPile.push(card);
          room.currentCard = card;
          room.activeColor = card.color === 'black' ? declaredColor! : null;
          room.lastActionSound = 'play';

          let note = `${activeSeatPlayer.name} drew and played **${card.color.toUpperCase()} ${card.value}**`;
          if (card.color === 'black') {
            note = `${activeSeatPlayer.name} drew and played **${card.value}**, choosing **${declaredColor!.toUpperCase()}**`;
          }
          room.lastActionDescription = note;

          // Apply special actions
          applyCardSideEffects(room, card, declaredColor || 'red');
          broadcastRoom(rId!);

          // Proceed with bot if appropriate
          const nextP = room.players[room.currentTurnIdx];
          if (nextP && nextP.isBot && room.status === 'playing') {
            triggerBotTurnSequence(rId!, nextP.id);
          }
          break;
        }

        // SAY UNO TOGGLE (declares intention prior to playing a card)
        case 'say_uno': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          const player = room.players.find(p => p.id === session.playerId);
          if (!player) return;

          player.unoDeclared = !player.unoDeclared; // toggle
          room.lastActionSound = player.unoDeclared ? 'uno' : undefined;
          
          if (player.unoDeclared) {
            addSystemChat(room, `📢 ${player.name} declared **UNO** input! Quick, play your matching card!`);
          }
          broadcastRoom(rId!);
          break;
        }

        // CHALLENGE A PLAYER THAT FORGOT TO DECLARE UNO
        case 'challenge_uno': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          if (room.status !== 'playing') return;

          const challenger = room.players.find(p => p.id === session.playerId);
          if (!challenger) return;

          const targetPlayerId = data.targetPlayerId;
          const victim = room.players.find(p => p.id === targetPlayerId);

          if (!victim) return;

          // Player had 1 card but did not declare UNO!
          const victimCardsLength = victim.hand?.length || 0;
          if (victimCardsLength === 1 && !victim.unoDeclared) {
            // Successful challenge! Victim draws 2 penalty cards
            const draws = drawCards(room, 2);
            victim.hand = [...(victim.hand || []), ...draws];
            victim.handCount = victim.hand.length;
            
            // Re-broadcast
            room.lastActionSound = 'error';
            room.lastActionDescription = `🚨 Challenge Successful! **${challenger.name}** caught **${victim.name}** forgetting UNO! drawn 2 penalty cards.`;
            addSystemChat(room, `🚨 SHAME! ${challenger.name} caught ${victim.name} with 1 card! Drawn 2 cards.`);
            broadcastRoom(rId!);
          } else {
            // Unsuccessful challenge: Challenger draws 1 card penalty for false accusation!
            const faultDraw = drawCards(room, 1);
            challenger.hand = [...(challenger.hand || []), ...faultDraw];
            challenger.handCount = challenger.hand.length;

            room.lastActionSound = 'error';
            room.lastActionDescription = `⚠️ False alarm! **${challenger.name}** wrongly challenged **${victim.name}** and drew 1 card penalty.`;
            addSystemChat(room, `⚠️ False challenge! ${challenger.name} drew 1 card penalty.`);
            broadcastRoom(rId!);
          }
          break;
        }

        // FORCE RESTART CURRENT ROOM (Host only)
        case 'restart_game': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          const hostPlayer = room.players.find(p => p.id === session.playerId);
          if (!hostPlayer || !hostPlayer.isHost) return;

          // Clear running timers
          if (botTimeouts.has(rId!)) {
            clearTimeout(botTimeouts.get(rId!));
            botTimeouts.delete(rId!);
          }

          // Reset to lobby
          room.status = 'lobby';
          room.winner = null;
          room.currentCard = null;
          room.activeColor = null;
          room.deck = [];
          room.discardPile = [];
          room.lastActionDescription = 'Match restarted. Let us play again!';
          room.lastActionSound = 'shuffle';
          for (const p of room.players) {
            p.hand = [];
            p.handCount = 0;
            p.unoDeclared = false;
          }

          addSystemChat(room, `🏁 Host ${hostPlayer.name} reset the lobby to start fresh.`);
          broadcastRoom(rId!);
          break;
        }

        // SEND A ROOM CHAT MESSAGE
        case 'send_chat': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          const sender = room.players.find(p => p.id === session.playerId);
          if (!sender) return;

          const trimmedText = data.text?.substring(0, 120).trim();
          if (!trimmedText) return;

          const chatMsg: ChatMessage = {
            id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            senderName: sender.name,
            senderColor: sender.color,
            text: trimmedText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isSystem: false,
          };

          room.chats.push(chatMsg);
          if (room.chats.length > 50) room.chats.shift();

          broadcastRoom(rId!);
          break;
        }

        // PLAYER VOLUNTARILY LEAVES ROOM
        case 'leave_room': {
          const rId = session.roomId;
          const room = rooms.get(rId || '');
          if (!room || !session.playerId) return;

          const leavingPlayerName = room.players.find(p => p.id === session.playerId)?.name || 'Someone';

          room.players = room.players.filter(p => p.id !== session.playerId);
          addSystemChat(room, `🚪 ${leavingPlayerName} left the room.`);

          // If room becomes totally empty of human players, clean it up!
          const humanLeft = room.players.some(p => !p.isBot);
          if (!humanLeft) {
            if (botTimeouts.has(rId!)) {
              clearTimeout(botTimeouts.get(rId!));
              botTimeouts.delete(rId!);
            }
            rooms.delete(rId!);
            console.log(`Lobby ${rId} completely deleted (no humans remaining)`);
          } else {
            // Re-delegate host if remaining was host
            const hasHost = room.players.some(p => p.isHost && !p.isBot);
            if (!hasHost) {
              const firstHuman = room.players.find(p => !p.isBot);
              if (firstHuman) {
                firstHuman.isHost = true;
                addSystemChat(room, `👑 ${firstHuman.name} is now the host of this Room.`);
              }
            }

            // Adjust turn pointer if out of bounds
            if (room.status === 'playing') {
              if (room.currentTurnIdx >= room.players.length) {
                room.currentTurnIdx = 0;
              }
              const activeP = room.players[room.currentTurnIdx];
              if (activeP && activeP.isBot) {
                triggerBotTurnSequence(rId!, activeP.id);
              }
            }

            broadcastRoom(rId!);
          }

          // Reset session
          session.roomId = null;
          session.playerId = null;
          ws.send(JSON.stringify({ type: 'left_success' }));
          break;
        }

        default:
          console.log(`Unknown event message: ${type}`);
          break;
      }

    } catch (err) {
      console.error('Socket message parse error:', err);
    }
  });

  ws.on('close', () => {
    // Locate session
    const session = socketSessions.get(ws);
    if (session && session.roomId && session.playerId) {
      const room = rooms.get(session.roomId);
      if (room) {
        const dP = room.players.find(p => p.id === session.playerId);
        if (dP) {
          // Instead of immediate deletion, give player 30s to reconnect
          addSystemChat(room, `⚠️ ${dP.name} disconnected. Waiting for reconnection...`);
          broadcastRoom(session.roomId);

          // Standard room cleaning: If everyone leaves the room forever, clean it up on delay.
          setTimeout(() => {
            const currentRoom = rooms.get(session.roomId || '');
            if (currentRoom) {
              // check if socket is still dead and not reconnected
              const stillMissing = !Array.from(socketSessions.values()).some(
                s => s.roomId === session.roomId && s.playerId === session.playerId
              );

              if (stillMissing) {
                currentRoom.players = currentRoom.players.filter(p => p.id !== session.playerId);
                addSystemChat(currentRoom, `🚪 ${dP.name} was removed from room because of disconnect timeout.`);
                
                const humansLeft = currentRoom.players.some(p => !p.isBot);
                if (!humansLeft) {
                  if (botTimeouts.has(session.roomId!)) {
                    clearTimeout(botTimeouts.get(session.roomId!));
                    botTimeouts.delete(session.roomId!);
                  }
                  rooms.delete(session.roomId!);
                  console.log(`Lobby ${session.roomId} completely cleaned up due to persistent inactivity.`);
                } else {
                  // Re-allocate host if host left
                  const activeHost = currentRoom.players.some(p => p.isHost && !p.isBot);
                  if (!activeHost) {
                    const firstNonBot = currentRoom.players.find(p => !p.isBot);
                    if (firstNonBot) {
                      firstNonBot.isHost = true;
                      addSystemChat(currentRoom, `👑 ${firstNonBot.name} is now host.`);
                    }
                  }

                  // Adjust turns
                  if (currentRoom.status === 'playing') {
                    if (currentRoom.currentTurnIdx >= currentRoom.players.length) {
                      currentRoom.currentTurnIdx = 0;
                    }
                    const nowP = currentRoom.players[currentRoom.currentTurnIdx];
                    if (nowP && nowP.isBot) {
                      triggerBotTurnSequence(session.roomId!, nowP.id);
                    }
                  }
                  broadcastRoom(session.roomId!);
                }
              }
            }
          }, 30000); // 30 seconds wait
        }
      }
    }
    socketSessions.delete(ws);
    console.log('Socket disconnected and cleaned up');
  });
});

// Serve static build from dist in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const viteInstance = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    // Mount Vite asset serving
    app.use(viteInstance.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Handle Websocket upgrade
  httpServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // Start listening
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`UNO Multiplayer Server running on port ${PORT}`);
  });
}

startServer();
