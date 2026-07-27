/** Shared client/server protocol for Game Stang */

export const BRAND = 'Game Stang';
export const DEFAULT_BOXES = 5;
export const TURN_TIMEOUT_MS = 60_000;
export const CODE_LENGTH = 4;

/** Campeonato: 2 a 5 jogadores, eliminação em duplas (1v1) */
export type TournamentSize = 2 | 3 | 4 | 5;

export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

export const PLAYER_COLORS: PlayerColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
];

export const PLAYER_COLOR_HEX: Record<PlayerColor, string> = {
  red: '#e53935',
  blue: '#1e88e5',
  green: '#43a047',
  yellow: '#fdd835',
  purple: '#8e24aa',
  orange: '#fb8c00',
};

export const PLAYER_COLOR_LABEL: Record<PlayerColor, string> = {
  red: 'Vermelho',
  blue: 'Azul',
  green: 'Verde',
  yellow: 'Amarelo',
  purple: 'Roxo',
  orange: 'Laranja',
};

/** Phaser / canvas number form */
export const PLAYER_COLOR_NUM: Record<PlayerColor, number> = {
  red: 0xe53935,
  blue: 0x1e88e5,
  green: 0x43a047,
  yellow: 0xfdd835,
  purple: 0x8e24aa,
  orange: 0xfb8c00,
};

export function isPlayerColor(v: unknown): v is PlayerColor {
  return typeof v === 'string' && (PLAYER_COLORS as string[]).includes(v);
}

export type EdgeKind = 'h' | 'v';

/** Horizontal: h:row:col — Vertical: v:row:col */
export type EdgeId = `${EdgeKind}:${number}:${number}`;

export interface PlayerPublic {
  id: string;
  nickname: string;
  /** null = ainda não escolheu na sala */
  color: PlayerColor | null;
  connected: boolean;
}

export interface MatchScores {
  [playerId: string]: number;
}

export interface MatchPublic {
  id: string;
  boxes: number;
  edges: Record<string, string>;
  boxesOwned: Record<string, string>;
  scores: MatchScores;
  currentPlayerId: string | null;
  status: 'waiting' | 'playing' | 'finished';
  winnerId: string | null;
  turnDeadline: number | null;
  players: [PlayerPublic | null, PlayerPublic | null];
  tournamentId?: string;
  bracketMatchId?: string;
}

export interface RoomPublic {
  code: string;
  hostId: string;
  players: PlayerPublic[];
  status: 'lobby' | 'playing' | 'finished';
  boxes: number;
  match: MatchPublic | null;
}

export interface BracketMatchPublic {
  id: string;
  round: number;
  index: number;
  playerIds: [string | null, string | null];
  winnerId: string | null;
  roomCode: string | null;
  status: 'pending' | 'ready' | 'playing' | 'done';
  bye?: boolean;
}

export interface TournamentPublic {
  code: string;
  name: string;
  hostId: string;
  size: TournamentSize;
  boxes: number;
  status: 'lobby' | 'running' | 'finished';
  players: PlayerPublic[];
  activeIds: string[];
  eliminatedIds: string[];
  bracket: BracketMatchPublic[];
  championId: string | null;
  currentRound: number;
}

export type ClientToServer =
  | { type: 'hello'; playerId?: string }
  | { type: 'createRoom'; nickname: string; boxes?: number }
  | { type: 'joinRoom'; code: string; nickname: string }
  | { type: 'setColor'; color: PlayerColor }
  | { type: 'startRoom' }
  | { type: 'playMove'; edge: EdgeId }
  | { type: 'rematch' }
  | { type: 'leave' }
  | {
      type: 'createTournament';
      nickname: string;
      name: string;
      size: TournamentSize;
      boxes?: number;
    }
  | { type: 'joinTournament'; code: string; nickname: string }
  | { type: 'startTournament' };

export type ServerToClient =
  | { type: 'helloOk'; playerId: string }
  | { type: 'error'; message: string }
  | { type: 'roomState'; room: RoomPublic }
  | { type: 'tournamentState'; tournament: TournamentPublic }
  | { type: 'matchState'; match: MatchPublic }
  | { type: 'left' };
