import type {
  BracketMatchPublic,
  PlayerPublic,
  TournamentPublic,
  TournamentSize,
} from '../shared/protocol.js';
import { DEFAULT_BOXES } from '../shared/protocol.js';
import { normalizeCode, randomCode } from './codes.js';
import type { MatchState } from './engine.js';
import type { Room, RoomManager } from './rooms.js';

export interface BracketMatch {
  id: string;
  round: number;
  index: number;
  playerIds: [string | null, string | null];
  winnerId: string | null;
  roomCode: string | null;
  status: 'pending' | 'ready' | 'playing' | 'done';
  bye: boolean;
}

export interface Tournament {
  code: string;
  name: string;
  hostId: string;
  size: TournamentSize;
  boxes: number;
  status: 'lobby' | 'running' | 'finished';
  playerIds: string[];
  activeIds: string[];
  eliminatedIds: string[];
  bracket: BracketMatch[];
  championId: string | null;
  currentRound: number;
  matchSeq: number;
}

const VALID_SIZES: TournamentSize[] = [2, 3, 4, 5];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class TournamentManager {
  tournaments = new Map<string, Tournament>();
  playerTournament = new Map<string, string>();

  constructor(
    private players: Map<string, PlayerPublic>,
    private rooms: RoomManager,
  ) {}

  create(
    hostId: string,
    name: string,
    size: TournamentSize,
    boxes = DEFAULT_BOXES,
  ): Tournament {
    this.leave(hostId);
    if (!VALID_SIZES.includes(size)) {
      throw new Error('Tamanho inválido (2, 3, 4 ou 5 jogadores)');
    }
    let code = randomCode();
    while (this.tournaments.has(code) || this.rooms.get(code)) code = randomCode();
    const t: Tournament = {
      code,
      name: name.trim().slice(0, 40) || 'Campeonato',
      hostId,
      size,
      boxes: Math.min(8, Math.max(2, boxes)),
      status: 'lobby',
      playerIds: [hostId],
      activeIds: [],
      eliminatedIds: [],
      bracket: [],
      championId: null,
      currentRound: 0,
      matchSeq: 0,
    };
    this.tournaments.set(code, t);
    this.playerTournament.set(hostId, code);
    return t;
  }

  join(codeRaw: string, playerId: string): Tournament {
    const code = normalizeCode(codeRaw);
    const t = this.tournaments.get(code);
    if (!t) throw new Error('Campeonato não encontrado');
    if (t.status !== 'lobby') throw new Error('Campeonato já começou');
    if (t.playerIds.includes(playerId)) return t;
    if (t.playerIds.length >= t.size) throw new Error('Campeonato cheio');
    this.leave(playerId);
    this.rooms.leave(playerId);
    t.playerIds.push(playerId);
    this.playerTournament.set(playerId, code);
    return t;
  }

  start(hostId: string): Tournament {
    const t = this.getByPlayer(hostId);
    if (!t) throw new Error('Você não está em um campeonato');
    if (t.hostId !== hostId) throw new Error('Só o host pode iniciar');
    if (t.playerIds.length !== t.size) {
      throw new Error(`Precisa de ${t.size} jogadores (tem ${t.playerIds.length})`);
    }
    if (t.status !== 'lobby') return t;

    t.activeIds = shuffle(t.playerIds);
    t.eliminatedIds = [];
    t.bracket = [];
    t.championId = null;
    t.currentRound = 0;
    t.status = 'running';
    this.openRound(t);
    return t;
  }

  /** Monta a próxima rodada: embaralha ativos, bye se ímpar, restante em duplas 1v1. */
  private openRound(t: Tournament): void {
    if (t.activeIds.length <= 1) {
      t.championId = t.activeIds[0] ?? null;
      t.status = 'finished';
      return;
    }

    const pool = shuffle(t.activeIds);
    const round = t.currentRound;
    let index = 0;

    // Ímpar: um jogador fica de fora (bye) e avança automaticamente
    if (pool.length % 2 === 1) {
      const byeId = pool.pop()!;
      t.bracket.push({
        id: `b${++t.matchSeq}`,
        round,
        index: index++,
        playerIds: [byeId, null],
        winnerId: byeId,
        roomCode: null,
        status: 'done',
        bye: true,
      });
    }

    while (pool.length >= 2) {
      const a = pool.shift()!;
      const b = pool.shift()!;
      t.bracket.push({
        id: `b${++t.matchSeq}`,
        round,
        index: index++,
        playerIds: [a, b],
        winnerId: null,
        roomCode: null,
        status: 'ready',
        bye: false,
      });
    }

    this.launchReadyMatches(t);
  }

  private launchReadyMatches(t: Tournament): void {
    for (const bm of t.bracket) {
      if (bm.status !== 'ready' || bm.bye) continue;
      const [a, b] = bm.playerIds;
      if (!a || !b) continue;
      const room = this.rooms.createForMatch(t.boxes, a, b, {
        tournamentId: t.code,
        bracketMatchId: bm.id,
      });
      bm.roomCode = room.code;
      bm.status = 'playing';
      this.playerTournament.set(a, t.code);
      this.playerTournament.set(b, t.code);
    }
  }

  private roundMatches(t: Tournament, round: number): BracketMatch[] {
    return t.bracket.filter((m) => m.round === round && !m.bye);
  }

  onMatchFinished(_room: Room, match: MatchState): Tournament | null {
    if (!match.tournamentId || !match.bracketMatchId) return null;
    const t = this.tournaments.get(match.tournamentId);
    if (!t) return null;
    const bm = t.bracket.find((m) => m.id === match.bracketMatchId);
    if (!bm || bm.status === 'done') return t;

    const winner = match.winnerId ?? match.playerIds[0];
    const loser = match.playerIds.find((id) => id && id !== winner) ?? null;
    bm.winnerId = winner;
    bm.status = 'done';

    if (loser && !t.eliminatedIds.includes(loser)) {
      t.eliminatedIds.push(loser);
    }

    const round = bm.round;
    const fights = this.roundMatches(t, round);
    if (!fights.every((m) => m.status === 'done')) {
      return t;
    }

    // Rodada completa: vencedores + byes seguem; perdedores já estão em eliminatedIds
    const winners = fights.map((m) => m.winnerId).filter((id): id is string => Boolean(id));
    const byes = t.bracket
      .filter((m) => m.round === round && m.bye && m.winnerId)
      .map((m) => m.winnerId!);
    t.activeIds = [...winners, ...byes];
    t.currentRound = round + 1;

    if (t.activeIds.length <= 1) {
      t.championId = t.activeIds[0] ?? winner;
      t.status = 'finished';
      return t;
    }

    this.openRound(t);
    return t;
  }

  leave(playerId: string): Tournament | null {
    const code = this.playerTournament.get(playerId);
    if (!code) return null;
    const t = this.tournaments.get(code);
    this.playerTournament.delete(playerId);
    if (!t) return null;
    if (t.status === 'lobby') {
      t.playerIds = t.playerIds.filter((id) => id !== playerId);
      if (t.hostId === playerId) t.hostId = t.playerIds[0] ?? '';
      if (t.playerIds.length === 0) {
        this.tournaments.delete(code);
        return null;
      }
    }
    return t;
  }

  getByPlayer(playerId: string): Tournament | null {
    const code = this.playerTournament.get(playerId);
    return code ? this.tournaments.get(code) ?? null : null;
  }

  toPublic(t: Tournament): TournamentPublic {
    return {
      code: t.code,
      name: t.name,
      hostId: t.hostId,
      size: t.size,
      boxes: t.boxes,
      status: t.status,
      players: t.playerIds.map((id) => this.players.get(id)!).filter(Boolean),
      activeIds: [...t.activeIds],
      eliminatedIds: [...t.eliminatedIds],
      championId: t.championId,
      currentRound: t.currentRound,
      bracket: t.bracket.map(
        (m): BracketMatchPublic => ({
          id: m.id,
          round: m.round,
          index: m.index,
          playerIds: [...m.playerIds] as [string | null, string | null],
          winnerId: m.winnerId,
          roomCode: m.roomCode,
          status: m.status,
          bye: m.bye,
        }),
      ),
    };
  }
}
