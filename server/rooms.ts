import type { EdgeId, PlayerColor, PlayerPublic, RoomPublic } from '../shared/protocol.js';
import { DEFAULT_BOXES, TURN_TIMEOUT_MS } from '../shared/protocol.js';
import { normalizeCode, randomCode } from './codes.js';
import {
  applyMove,
  createMatch,
  forceTimeoutMove,
  type MatchState,
  toMatchPublic,
} from './engine.js';

export interface Room {
  code: string;
  hostId: string;
  boxes: number;
  playerIds: string[];
  status: 'lobby' | 'playing' | 'finished';
  match: MatchState | null;
}

export class RoomManager {
  rooms = new Map<string, Room>();
  playerRoom = new Map<string, string>();

  constructor(
    private players: Map<string, PlayerPublic>,
    private onMatchEnd?: (room: Room, match: MatchState) => void,
  ) {}

  private colorsOf(...ids: string[]): Record<string, PlayerColor> {
    const out: Record<string, PlayerColor> = {};
    for (const id of ids) {
      const c = this.players.get(id)?.color;
      if (c) out[id] = c;
    }
    return out;
  }

  create(hostId: string, boxes = DEFAULT_BOXES): Room {
    this.leave(hostId);
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const room: Room = {
      code,
      hostId,
      boxes: Math.min(8, Math.max(2, boxes)),
      playerIds: [hostId],
      status: 'lobby',
      match: null,
    };
    this.rooms.set(code, room);
    this.playerRoom.set(hostId, code);
    return room;
  }

  join(codeRaw: string, playerId: string): Room {
    const code = normalizeCode(codeRaw);
    const room = this.rooms.get(code);
    if (!room) throw new Error('Sala não encontrada');
    if (room.playerIds.includes(playerId)) return room;
    if (room.status !== 'lobby') throw new Error('Partida já começou');
    if (room.playerIds.length >= 2) throw new Error('Sala cheia');
    this.leave(playerId);
    room.playerIds.push(playerId);
    this.playerRoom.set(playerId, code);
    return room;
  }

  /** Internal: attach two known players to a fresh room (tournament). */
  createForMatch(
    boxes: number,
    p0: string,
    p1: string,
    meta: { tournamentId: string; bracketMatchId: string },
  ): Room {
    // Detach from previous rooms without forfeiting (advancing in bracket)
    for (const pid of [p0, p1]) {
      const prevCode = this.playerRoom.get(pid);
      if (!prevCode) continue;
      const prev = this.rooms.get(prevCode);
      this.playerRoom.delete(pid);
      if (!prev) continue;
      prev.playerIds = prev.playerIds.filter((id) => id !== pid);
      if (prev.playerIds.length === 0) this.rooms.delete(prevCode);
    }

    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const match = createMatch(boxes, p0, p1, meta, this.colorsOf(p0, p1));
    match.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    const room: Room = {
      code,
      hostId: p0,
      boxes,
      playerIds: [p0, p1],
      status: 'playing',
      match,
    };
    this.rooms.set(code, room);
    this.playerRoom.set(p0, code);
    this.playerRoom.set(p1, code);
    return room;
  }

  start(hostId: string): Room {
    const room = this.getByPlayer(hostId);
    if (!room) throw new Error('Você não está em uma sala');
    if (room.hostId !== hostId) throw new Error('Só o host pode iniciar');
    if (room.playerIds.length < 2) throw new Error('Falta um adversário');
    if (room.status === 'playing') return room;
    const [a, b] = room.playerIds;
    room.match = createMatch(room.boxes, a, b, undefined, this.colorsOf(a, b));
    room.match.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    room.status = 'playing';
    return room;
  }

  rematch(playerId: string): Room {
    const room = this.getByPlayer(playerId);
    if (!room) throw new Error('Você não está em uma sala');
    if (room.playerIds.length < 2) throw new Error('Falta adversário');
    if (room.match?.tournamentId) throw new Error('Revancha indisponível no torneio');
    const [a, b] = room.playerIds;
    room.match = createMatch(room.boxes, a, b, undefined, this.colorsOf(a, b));
    room.match.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    room.status = 'playing';
    return room;
  }

  play(playerId: string, edge: EdgeId): Room {
    const room = this.getByPlayer(playerId);
    if (!room?.match) throw new Error('Nenhuma partida ativa');
    const result = applyMove(room.match, playerId, edge);
    if (!result.ok) throw new Error(result.reason);
    if (room.match.status === 'finished') {
      room.status = 'finished';
      room.match.turnDeadline = null;
      this.onMatchEnd?.(room, room.match);
    } else {
      room.match.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    }
    return room;
  }

  tickTimeouts(): Room[] {
    const changed: Room[] = [];
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const m = room.match;
      if (!m || m.status !== 'playing' || !m.turnDeadline) continue;
      if (now < m.turnDeadline) continue;
      const edge = forceTimeoutMove(m);
      if (!edge || !m.currentPlayerId) continue;
      applyMove(m, m.currentPlayerId, edge);
      if ((m.status as string) === 'finished') {
        room.status = 'finished';
        m.turnDeadline = null;
        this.onMatchEnd?.(room, m);
      } else {
        m.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
      }
      changed.push(room);
    }
    return changed;
  }

  leave(playerId: string): Room | null {
    const code = this.playerRoom.get(playerId);
    if (!code) return null;
    const room = this.rooms.get(code);
    this.playerRoom.delete(playerId);
    if (!room) return null;
    room.playerIds = room.playerIds.filter((id) => id !== playerId);
    if (room.hostId === playerId) {
      room.hostId = room.playerIds[0] ?? '';
    }
    if (room.playerIds.length === 0) {
      this.rooms.delete(code);
      return null;
    }
    if (room.match && room.status === 'playing') {
      const other = room.playerIds[0];
      if (other) {
        room.match.status = 'finished';
        room.match.winnerId = other;
        room.match.currentPlayerId = null;
        room.match.turnDeadline = null;
        room.status = 'finished';
        this.onMatchEnd?.(room, room.match);
      }
    }
    return room;
  }

  getByPlayer(playerId: string): Room | null {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) ?? null : null;
  }

  get(code: string): Room | null {
    return this.rooms.get(normalizeCode(code)) ?? null;
  }

  toPublic(room: Room): RoomPublic {
    return {
      code: room.code,
      hostId: room.hostId,
      boxes: room.boxes,
      status: room.status,
      players: room.playerIds.map((id) => this.players.get(id)!).filter(Boolean),
      match: room.match ? toMatchPublic(room.match, this.players) : null,
    };
  }
}
