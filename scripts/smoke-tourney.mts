import { io, type Socket } from 'socket.io-client';
import { allEdges } from '../server/engine.ts';

type Match = {
  status: string;
  currentPlayerId: string | null;
  edges: Record<string, string>;
  boxes: number;
};

type Tourney = {
  code: string;
  status: string;
  championId: string | null;
  activeIds: string[];
  bracket: { id: string; status: string; bye?: boolean; winnerId: string | null }[];
};

type Bag = {
  s: Socket;
  send: (m: unknown) => void;
  id: string;
  name: string;
  match: Match | null;
  tourney: Tourney | null;
};

function client(name: string): Promise<Bag> {
  return new Promise((resolve, reject) => {
    const bag: Bag = {
      s: null as unknown as Socket,
      send: () => undefined,
      id: '',
      name,
      match: null,
      tourney: null,
    };
    const s = io('http://localhost:3001', { transports: ['websocket'] });
    bag.s = s;
    bag.send = (m) => s.emit('msg', m);
    s.on('connect', () => bag.send({ type: 'hello' }));
    s.on('msg', (msg: any) => {
      if (msg.type === 'helloOk') {
        bag.id = msg.playerId;
        resolve(bag);
      }
      if (msg.type === 'roomState' && msg.room?.match) bag.match = msg.room.match;
      if (msg.type === 'matchState') bag.match = msg.match;
      if (msg.type === 'tournamentState') bag.tourney = msg.tournament;
    });
    setTimeout(() => reject(new Error('timeout ' + name)), 5000);
  });
}

const players = await Promise.all([client('P0'), client('P1'), client('P2')]);
players[0].send({ type: 'createTournament', nickname: 'P0', name: 'Teste3', size: 3, boxes: 2 });
await new Promise((r) => setTimeout(r, 400));
const code = players[0].tourney?.code!;
for (let i = 1; i < 3; i++) {
  players[i].send({ type: 'joinTournament', code, nickname: `P${i}` });
}
await new Promise((r) => setTimeout(r, 400));
players[0].send({ type: 'startTournament' });
await new Promise((r) => setTimeout(r, 500));
console.log('start', players[0].tourney?.bracket);

for (let step = 0; step < 400; step++) {
  for (const p of players) {
    const m = p.match;
    if (!m || m.status !== 'playing') continue;
    if (m.currentPlayerId !== p.id) continue;
    const free = allEdges(m.boxes).filter((e) => !m.edges[e]);
    if (!free.length) continue;
    p.send({ type: 'playMove', edge: free[0] });
  }
  if (players[0].tourney?.status === 'finished') break;
  await new Promise((r) => setTimeout(r, 30));
}

console.log('final', players[0].tourney?.status, players[0].tourney?.championId, players[0].tourney?.activeIds);
for (const p of players) p.s.close();
process.exit(0);
