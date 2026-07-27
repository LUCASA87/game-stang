import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import type { ClientToServer, PlayerColor, PlayerPublic, ServerToClient } from '../shared/protocol.js';
import { isPlayerColor } from '../shared/protocol.js';
import { normalizeCode } from './codes.js';
import { RoomManager } from './rooms.js';
import { TournamentManager } from './tournaments.js';

const PORT = Number(process.env.PORT) || 3001;

const players = new Map<string, PlayerPublic>();
const socketToPlayer = new Map<string, string>();
const playerSockets = new Map<string, Set<string>>();

const rooms = new RoomManager(players, (room, match) => {
  const t = tournaments.onMatchFinished(room, match);
  if (t) {
    emitTournament(t.code);
    for (const bm of t.bracket) {
      if (bm.roomCode && bm.status === 'playing') emitRoom(bm.roomCode);
    }
  }
  // Only emit old room if players are still attached to it
  if (rooms.get(room.code)) emitRoom(room.code);
});

const tournaments = new TournamentManager(players, rooms);

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Game Stang server OK');
});

const io = new Server(httpServer, {
  cors: { origin: '*' },
});

function send(socket: Socket, msg: ServerToClient): void {
  socket.emit('msg', msg);
}

function emitToPlayer(playerId: string, msg: ServerToClient): void {
  const socks = playerSockets.get(playerId);
  if (!socks) return;
  for (const sid of socks) io.sockets.sockets.get(sid)?.emit('msg', msg);
}

function emitRoom(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  const pub = rooms.toPublic(room);
  for (const pid of room.playerIds) {
    emitToPlayer(pid, { type: 'roomState', room: pub });
    if (room.match) {
      emitToPlayer(pid, { type: 'matchState', match: pub.match! });
    }
  }
}

function emitTournament(code: string): void {
  const t = tournaments.tournaments.get(code);
  if (!t) return;
  const pub = tournaments.toPublic(t);
  for (const pid of t.playerIds) {
    emitToPlayer(pid, { type: 'tournamentState', tournament: pub });
  }
  // Also notify anyone currently in a bracket match room
  for (const bm of t.bracket) {
    if (!bm.roomCode) continue;
    const room = rooms.get(bm.roomCode);
    if (!room) continue;
    for (const pid of room.playerIds) {
      emitToPlayer(pid, { type: 'tournamentState', tournament: pub });
    }
  }
}

function ensurePlayer(playerId: string, nickname?: string): PlayerPublic {
  let p = players.get(playerId);
  if (!p) {
    p = {
      id: playerId,
      nickname: nickname?.trim().slice(0, 20) || '',
      color: null,
      connected: true,
    };
    players.set(playerId, p);
  } else {
    if (nickname?.trim()) p.nickname = nickname.trim().slice(0, 20);
    p.connected = true;
  }
  return p;
}

function assertColorFree(playerIds: string[], color: PlayerColor, exceptId?: string): void {
  for (const id of playerIds) {
    if (exceptId && id === exceptId) continue;
    const p = players.get(id);
    if (p?.color === color) {
      throw new Error('Essa cor já foi escolhida. Escolha outra.');
    }
  }
}

function peerIdsForColor(playerId: string): string[] {
  const room = rooms.getByPlayer(playerId);
  if (room) return room.playerIds;
  const t = tournaments.getByPlayer(playerId);
  if (t) return t.playerIds;
  return [];
}

function assertAllReady(playerIds: string[]): void {
  for (const id of playerIds) {
    const p = players.get(id);
    if (!p?.nickname?.trim() || p.nickname.trim().length < 2) {
      throw new Error('Todos precisam definir o nome antes de iniciar');
    }
    if (!p.color) throw new Error('Todos precisam escolher uma cor antes de iniciar');
  }
}

function bindSocket(socket: Socket, playerId: string): void {
  socketToPlayer.set(socket.id, playerId);
  let set = playerSockets.get(playerId);
  if (!set) {
    set = new Set();
    playerSockets.set(playerId, set);
  }
  set.add(socket.id);
}

io.on('connection', (socket) => {
  socket.on('msg', (raw: ClientToServer) => {
    try {
      handle(socket, raw);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erro';
      send(socket, { type: 'error', message });
    }
  });

  socket.on('disconnect', () => {
    const playerId = socketToPlayer.get(socket.id);
    socketToPlayer.delete(socket.id);
    if (!playerId) return;
    const set = playerSockets.get(playerId);
    set?.delete(socket.id);
    if (set && set.size === 0) {
      playerSockets.delete(playerId);
      const p = players.get(playerId);
      if (p) p.connected = false;
      const room = rooms.getByPlayer(playerId);
      if (room) emitRoom(room.code);
      const t = tournaments.getByPlayer(playerId);
      if (t) emitTournament(t.code);
    }
  });
});

function handle(socket: Socket, msg: ClientToServer): void {
  if (msg.type === 'hello') {
    const playerId = msg.playerId && players.has(msg.playerId) ? msg.playerId : randomUUID();
    ensurePlayer(playerId);
    bindSocket(socket, playerId);
    send(socket, { type: 'helloOk', playerId });

    const room = rooms.getByPlayer(playerId);
    if (room) {
      send(socket, { type: 'roomState', room: rooms.toPublic(room) });
      if (room.match) {
        send(socket, {
          type: 'matchState',
          match: rooms.toPublic(room).match!,
        });
      }
    }
    const t = tournaments.getByPlayer(playerId);
    if (t) send(socket, { type: 'tournamentState', tournament: tournaments.toPublic(t) });
    return;
  }

  const playerId = socketToPlayer.get(socket.id);
  if (!playerId) throw new Error('Conecte-se primeiro (hello)');

  switch (msg.type) {
    case 'createRoom': {
      const p = ensurePlayer(playerId, msg.nickname);
      p.color = null;
      const room = rooms.create(playerId, msg.boxes);
      emitRoom(room.code);
      break;
    }
    case 'joinRoom': {
      const p = ensurePlayer(playerId, msg.nickname);
      const code = normalizeCode(msg.code);
      const already = rooms.getByPlayer(playerId);
      // Reentrar na mesma sala (refresh) NÃO pode apagar a cor — senão o tabuleiro vira azul
      if (!already || already.code !== code) {
        p.color = null;
      }
      const room = rooms.join(msg.code, playerId);
      emitRoom(room.code);
      break;
    }
    case 'setColor': {
      if (!isPlayerColor(msg.color)) throw new Error('Escolha uma cor válida');
      const peers = peerIdsForColor(playerId);
      if (peers.length === 0) throw new Error('Entre em uma sala primeiro');
      assertColorFree(peers, msg.color, playerId);
      const p = ensurePlayer(playerId);
      p.color = msg.color;
      const room = rooms.getByPlayer(playerId);
      if (room) emitRoom(room.code);
      const t = tournaments.getByPlayer(playerId);
      if (t) emitTournament(t.code);
      break;
    }
    case 'setNickname': {
      const nick = msg.nickname?.trim().slice(0, 20);
      if (!nick || nick.length < 2) throw new Error('Digite seu nome (mín. 2 letras)');
      const p = ensurePlayer(playerId);
      p.nickname = nick;
      const room = rooms.getByPlayer(playerId);
      if (room) emitRoom(room.code);
      const t = tournaments.getByPlayer(playerId);
      if (t) emitTournament(t.code);
      break;
    }
    case 'startRoom': {
      const room = rooms.getByPlayer(playerId);
      if (!room) throw new Error('Você não está em uma sala');
      assertAllReady(room.playerIds);
      rooms.start(playerId);
      emitRoom(room.code);
      break;
    }
    case 'playMove': {
      const room = rooms.play(playerId, msg.edge);
      emitRoom(room.code);
      if (room.match?.tournamentId) emitTournament(room.match.tournamentId);
      break;
    }
    case 'rematch': {
      const room = rooms.rematch(playerId);
      emitRoom(room.code);
      break;
    }
    case 'leave': {
      const room = rooms.leave(playerId);
      const t = tournaments.leave(playerId);
      const p = players.get(playerId);
      if (p) p.color = null;
      send(socket, { type: 'left' });
      if (room) emitRoom(room.code);
      if (t) emitTournament(t.code);
      break;
    }
    case 'createTournament': {
      const p = ensurePlayer(playerId, msg.nickname);
      p.color = null;
      const t = tournaments.create(playerId, msg.name, msg.size, msg.boxes);
      emitTournament(t.code);
      break;
    }
    case 'joinTournament': {
      const p = ensurePlayer(playerId, msg.nickname);
      const code = normalizeCode(msg.code);
      const already = tournaments.getByPlayer(playerId);
      if (!already || already.code !== code) {
        p.color = null;
      }
      const t = tournaments.join(msg.code, playerId);
      emitTournament(t.code);
      break;
    }
    case 'startTournament': {
      const t = tournaments.getByPlayer(playerId);
      if (!t) throw new Error('Você não está em um campeonato');
      assertAllReady(t.playerIds);
      tournaments.start(playerId);
      emitTournament(t.code);
      for (const bm of t.bracket) {
        if (bm.roomCode) emitRoom(bm.roomCode);
      }
      break;
    }
    default:
      throw new Error('Comando desconhecido');
  }
}

setInterval(() => {
  const changed = rooms.tickTimeouts();
  for (const room of changed) {
    emitRoom(room.code);
    if (room.match?.tournamentId) emitTournament(room.match.tournamentId);
  }
}, 1000);

httpServer.listen(PORT, () => {
  console.log(`Game Stang server on http://localhost:${PORT}`);
});
