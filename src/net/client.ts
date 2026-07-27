import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '../../shared/protocol';

const STORAGE_KEY = 'game_stang_player_id';

declare global {
  interface Window {
    GAME_STANG_SOCKET?: string;
  }
}

export type MsgHandler = (msg: ServerToClient) => void;

function resolveSocketUrl(): string | undefined {
  const fromWindow = typeof window !== 'undefined' ? window.GAME_STANG_SOCKET?.trim() : '';
  if (fromWindow) return fromWindow;
  const fromEnv = import.meta.env.VITE_SOCKET_URL as string | undefined;
  if (fromEnv?.trim()) return fromEnv.trim();
  // Local: deixa undefined para o Vite fazer proxy de /socket.io
  return undefined;
}

export class NetClient {
  socket: Socket;
  playerId: string | null = null;
  private handlers = new Set<MsgHandler>();

  constructor() {
    const url = resolveSocketUrl();
    this.socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    this.socket.on('connect', () => {
      const saved = localStorage.getItem(STORAGE_KEY) || undefined;
      this.send({ type: 'hello', playerId: saved });
    });

    this.socket.on('msg', (msg: ServerToClient) => {
      if (msg.type === 'helloOk') {
        this.playerId = msg.playerId;
        localStorage.setItem(STORAGE_KEY, msg.playerId);
      }
      for (const h of this.handlers) h(msg);
    });
  }

  on(handler: MsgHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: ClientToServer): void {
    this.socket.emit('msg', msg);
  }

  get connected(): boolean {
    return this.socket.connected;
  }
}
