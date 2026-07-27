import { io, type Socket } from 'socket.io-client';

type Bag = { s: Socket; send: (m: unknown) => void; id: string };

function client(): Promise<Bag> {
  return new Promise((resolve, reject) => {
    const s = io('http://localhost:3001', { transports: ['websocket'] });
    const send = (m: unknown) => s.emit('msg', m);
    s.on('connect', () => send({ type: 'hello' }));
    s.on('msg', (msg: { type: string; playerId?: string; message?: string }) => {
      if (msg.type === 'helloOk' && msg.playerId) resolve({ s, send, id: msg.playerId });
      if (msg.type === 'error') console.log('ERR', msg.message);
    });
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
}

const a = await client();
const b = await client();

let roomCode = '';
a.s.on('msg', (msg: { type: string; room?: { code: string; players: unknown[]; status: string }; match?: { edges: object; scores: object } }) => {
  if (msg.type === 'roomState' && msg.room) {
    roomCode = msg.room.code;
    console.log('A room', msg.room.code, msg.room.players.length, msg.room.status);
  }
  if (msg.type === 'matchState' && msg.match) {
    console.log('A match edges', Object.keys(msg.match.edges).length, msg.match.scores);
  }
});

b.s.on('msg', (msg: { type: string; room?: { players: unknown[]; status: string } }) => {
  if (msg.type === 'roomState' && msg.room) {
    console.log('B room players', msg.room.players.length, msg.room.status);
  }
});

a.send({ type: 'createRoom', nickname: 'Ana', boxes: 3 });
await new Promise((r) => setTimeout(r, 400));
console.log('joining', roomCode);
b.send({ type: 'joinRoom', code: roomCode, nickname: 'Bob' });
await new Promise((r) => setTimeout(r, 400));
a.send({ type: 'startRoom' });
await new Promise((r) => setTimeout(r, 400));
a.send({ type: 'playMove', edge: 'h:0:0' });
await new Promise((r) => setTimeout(r, 400));
console.log('smoke ok');
a.s.close();
b.s.close();
process.exit(0);
