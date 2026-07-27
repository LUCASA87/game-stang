import type { EdgeId, EdgeKind, MatchPublic, MatchScores, PlayerPublic } from '../shared/protocol.js';

export function parseEdge(edge: EdgeId): { kind: EdgeKind; r: number; c: number } | null {
  const m = /^(h|v):(\d+):(\d+)$/.exec(edge);
  if (!m) return null;
  return { kind: m[1] as EdgeKind, r: Number(m[2]), c: Number(m[3]) };
}

export function makeEdge(kind: EdgeKind, r: number, c: number): EdgeId {
  return `${kind}:${r}:${c}`;
}

export function allEdges(boxes: number): EdgeId[] {
  const edges: EdgeId[] = [];
  for (let r = 0; r <= boxes; r++) {
    for (let c = 0; c < boxes; c++) edges.push(makeEdge('h', r, c));
  }
  for (let r = 0; r < boxes; r++) {
    for (let c = 0; c <= boxes; c++) edges.push(makeEdge('v', r, c));
  }
  return edges;
}

export function isValidEdge(boxes: number, edge: EdgeId): boolean {
  const p = parseEdge(edge);
  if (!p) return false;
  if (p.kind === 'h') return p.r >= 0 && p.r <= boxes && p.c >= 0 && p.c < boxes;
  return p.r >= 0 && p.r < boxes && p.c >= 0 && p.c <= boxes;
}

function boxKey(r: number, c: number): string {
  return `${r}:${c}`;
}

/** Returns box keys completed by placing this edge (that were empty). */
export function completedBoxes(
  boxes: number,
  edges: Record<string, string>,
  edge: EdgeId,
): string[] {
  const p = parseEdge(edge);
  if (!p) return [];
  const has = (e: EdgeId) => Boolean(edges[e] || e === edge);
  const done: string[] = [];

  if (p.kind === 'h') {
    // box above
    if (p.r > 0) {
      const r = p.r - 1;
      const c = p.c;
      if (
        has(makeEdge('h', r, c)) &&
        has(makeEdge('h', r + 1, c)) &&
        has(makeEdge('v', r, c)) &&
        has(makeEdge('v', r, c + 1))
      ) {
        done.push(boxKey(r, c));
      }
    }
    // box below
    if (p.r < boxes) {
      const r = p.r;
      const c = p.c;
      if (
        has(makeEdge('h', r, c)) &&
        has(makeEdge('h', r + 1, c)) &&
        has(makeEdge('v', r, c)) &&
        has(makeEdge('v', r, c + 1))
      ) {
        done.push(boxKey(r, c));
      }
    }
  } else {
    // box left
    if (p.c > 0) {
      const r = p.r;
      const c = p.c - 1;
      if (
        has(makeEdge('h', r, c)) &&
        has(makeEdge('h', r + 1, c)) &&
        has(makeEdge('v', r, c)) &&
        has(makeEdge('v', r, c + 1))
      ) {
        done.push(boxKey(r, c));
      }
    }
    // box right
    if (p.c < boxes) {
      const r = p.r;
      const c = p.c;
      if (
        has(makeEdge('h', r, c)) &&
        has(makeEdge('h', r + 1, c)) &&
        has(makeEdge('v', r, c)) &&
        has(makeEdge('v', r, c + 1))
      ) {
        done.push(boxKey(r, c));
      }
    }
  }

  return done;
}

export interface MatchState {
  id: string;
  boxes: number;
  edges: Record<string, string>;
  boxesOwned: Record<string, string>;
  scores: MatchScores;
  currentPlayerId: string | null;
  status: 'waiting' | 'playing' | 'finished';
  winnerId: string | null;
  turnDeadline: number | null;
  playerIds: [string | null, string | null];
  tournamentId?: string;
  bracketMatchId?: string;
}

let matchSeq = 0;

export function createMatch(
  boxes: number,
  p0: string,
  p1: string,
  meta?: { tournamentId?: string; bracketMatchId?: string },
): MatchState {
  return {
    id: `m${++matchSeq}`,
    boxes,
    edges: {},
    boxesOwned: {},
    scores: { [p0]: 0, [p1]: 0 },
    currentPlayerId: Math.random() < 0.5 ? p0 : p1,
    status: 'playing',
    winnerId: null,
    turnDeadline: null,
    playerIds: [p0, p1],
    tournamentId: meta?.tournamentId,
    bracketMatchId: meta?.bracketMatchId,
  };
}

export function applyMove(
  match: MatchState,
  playerId: string,
  edge: EdgeId,
): { ok: true; extraTurn: boolean } | { ok: false; reason: string } {
  if (match.status !== 'playing') return { ok: false, reason: 'Partida encerrada' };
  if (match.currentPlayerId !== playerId) return { ok: false, reason: 'Não é sua vez' };
  if (!isValidEdge(match.boxes, edge)) return { ok: false, reason: 'Jogada inválida' };
  if (match.edges[edge]) return { ok: false, reason: 'Linha já preenchida' };

  match.edges[edge] = playerId;
  const newBoxes = completedBoxes(match.boxes, match.edges, edge).filter(
    (k) => !match.boxesOwned[k],
  );

  for (const k of newBoxes) {
    match.boxesOwned[k] = playerId;
    match.scores[playerId] = (match.scores[playerId] ?? 0) + 1;
  }

  const totalBoxes = match.boxes * match.boxes;
  const claimed = Object.keys(match.boxesOwned).length;
  if (claimed >= totalBoxes) {
    match.status = 'finished';
    const [a, b] = match.playerIds;
    const sa = a ? match.scores[a] ?? 0 : 0;
    const sb = b ? match.scores[b] ?? 0 : 0;
    if (sa > sb) match.winnerId = a;
    else if (sb > sa) match.winnerId = b;
    else match.winnerId = null; // empate
    match.currentPlayerId = null;
    match.turnDeadline = null;
    return { ok: true, extraTurn: false };
  }

  if (newBoxes.length === 0) {
    const other = match.playerIds.find((id) => id && id !== playerId) ?? null;
    match.currentPlayerId = other;
  }

  return { ok: true, extraTurn: newBoxes.length > 0 };
}

export function forceTimeoutMove(match: MatchState): EdgeId | null {
  if (match.status !== 'playing' || !match.currentPlayerId) return null;
  const free = allEdges(match.boxes).filter((e) => !match.edges[e]);
  if (free.length === 0) return null;
  return free[Math.floor(Math.random() * free.length)];
}

export function toMatchPublic(
  match: MatchState,
  players: Map<string, PlayerPublic>,
): MatchPublic {
  return {
    id: match.id,
    boxes: match.boxes,
    edges: { ...match.edges },
    boxesOwned: { ...match.boxesOwned },
    scores: { ...match.scores },
    currentPlayerId: match.currentPlayerId,
    status: match.status,
    winnerId: match.winnerId,
    turnDeadline: match.turnDeadline,
    players: [
      match.playerIds[0] ? players.get(match.playerIds[0]) ?? null : null,
      match.playerIds[1] ? players.get(match.playerIds[1]) ?? null : null,
    ],
    tournamentId: match.tournamentId,
    bracketMatchId: match.bracketMatchId,
  };
}
