export type CardColor = 'red' | 'blue' | 'green' | 'yellow' | 'black';
export type CardValue = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'Skip' | 'Reverse' | 'Draw2' | 'Wild' | 'Wild4';

export interface Card {
  uid: string;
  color: CardColor;
  value: CardValue;
}

export interface Player {
  id: string; // Socket connection ID or guest/host ID
  name: string;
  avatar: string; // Emoji reference
  color: string;  // Tailwind theme accent (e.g., violet, amber, Emerald, etc.)
  isHost: boolean;
  isBot: boolean;
  handCount: number; // Synced so other players know card counts
  hand?: Card[];     // Detailed cards (only sent to the actual player)
  unoDeclared: boolean;
}

export interface ChatMessage {
  id: string;
  senderName: string;
  senderColor?: string;
  text: string;
  timestamp: string;
  isSystem: boolean;
}

export interface GameRoomState {
  roomId: string;
  players: Player[];
  status: 'lobby' | 'playing' | 'game_over';
  currentTurnIdx: number;
  direction: 1 | -1;
  currentCard: Card | null;
  activeColor: CardColor | null;
  winner: Player | null;
  deckCount: number;
  discardPileCount: number;
  lastActionDescription: string; // Descriptive text of what just happened for the log (e.g. "Bot 1 played Red Skip!", "Player Alice declared UNO!")
  lastActionSound?: 'play' | 'draw' | 'uno' | 'error' | 'win' | 'start' | 'shuffle'; // Sound cues for audio-visual richness
  maxPlayers?: number;
}
