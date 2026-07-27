import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '../../shared/protocol';

const STORAGE_KEY = 'game_stang_player_id';

declare global {
  interface Window {
    GAME_STANG_SOCKET?: string;
  }
}

export type MsgHandler = (msg: ServerToClient) => void;

export function resolveSocketUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;

  const fromWindow = window.GAME_STANG_SOCKET?.trim();
  if (fromWindow) return fromWindow;

  const fromEnv = import.meta.env.VITE_SOCKET_URL as string | undefined;
  if (fromEnv?.trim()) return fromEnv.trim();

  // Local: fala direto com o servidor (evita falha do proxy em outra porta)
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:3001';
  }

  return undefined;
}

export function needsRemoteSocket(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host.endsWith('github.io') || (!!host && host !== 'localhost' && host !== '127.0.0.1');
}

export class NetClient {
  socket: Socket;
  playerId: string | null = null;
  private handlers = new Set<MsgHandler>();
  readonly socketUrl: string | undefined;
  private readyWaiters: Array<() => void> = [];

  constructor() {
    this.socketUrl = resolveSocketUrl();
    const skip = needsRemoteSocket() && !this.socketUrl;

    this.socket = io(this.socketUrl ?? undefined, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: !skip,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 800,
    });

    this.socket.on('connect', () => {
      const saved = localStorage.getItem(STORAGE_KEY) || undefined;
      this.sendRaw({ type: 'hello', playerId: saved });
    });

    this.socket.on('msg', (msg: ServerToClient) => {
      if (msg.type === 'helloOk') {
        this.playerId = msg.playerId;
        localStorage.setItem(STORAGE_KEY, msg.playerId);
        const waiters = this.readyWaiters.splice(0);
        waiters.forEach((w) => w());
      }
      for (const h of this.handlers) h(msg);
    });
  }

  get missingServerConfig(): boolean {
    return needsRemoteSocket() && !this.socketUrl;
  }

  get ready(): boolean {
    return this.socket.connected && !!this.playerId;
  }

  /** Espera conectar + helloOk (até timeout ms). */
  whenReady(timeoutMs = 8000): Promise<boolean> {
    if (this.missingServerConfig) return Promise.resolve(false);
    if (this.ready) return Promise.resolve(true);

    if (!this.socket.connected) {
      this.socket.connect();
    }

    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      const onReady = () => {
        cleanup();
        resolve(true);
      };

      const cleanup = () => {
        window.clearTimeout(timer);
        this.readyWaiters = this.readyWaiters.filter((w) => w !== onReady);
      };

      this.readyWaiters.push(onReady);

      // Se já conectou mas ainda sem hello, reenvia
      if (this.socket.connected && !this.playerId) {
        const saved = localStorage.getItem(STORAGE_KEY) || undefined;
        this.sendRaw({ type: 'hello', playerId: saved });
      }
    });
  }

  on(handler: MsgHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private sendRaw(msg: ClientToServer): void {
    this.socket.emit('msg', msg);
  }

  send(msg: ClientToServer): boolean {
    if (!this.socket.connected) return false;
    this.socket.emit('msg', msg);
    return true;
  }

  get connected(): boolean {
    return this.socket.connected;
  }
}
