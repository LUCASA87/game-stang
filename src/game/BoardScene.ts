import Phaser from 'phaser';
import type { EdgeId, MatchPublic, PlayerColor } from '../../shared/protocol';
import { PLAYER_COLOR_NUM } from '../../shared/protocol';
import { makeEdge } from '../game/edges';

const COLORS = {
  bg: 0x163828,
  dot: 0xe8f5e9,
  lineIdle: 0x4a6b57,
  lineHover: 0xc8e6c9,
};

export type MoveCallback = (edge: EdgeId) => void;

export class BoardScene extends Phaser.Scene {
  private match: MatchPublic | null = null;
  private myId: string | null = null;
  private onMove: MoveCallback | null = null;
  private graphics!: Phaser.GameObjects.Graphics;
  private hitters: Phaser.GameObjects.Rectangle[] = [];
  private pad = 28;
  private cell = 48;

  constructor() {
    super({ key: 'Board' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.graphics = this.add.graphics();
    this.scale.on('resize', () => this.redraw());
    this.redraw();
  }

  setState(match: MatchPublic, myId: string | null, onMove: MoveCallback): void {
    this.match = match;
    this.myId = myId;
    this.onMove = onMove;
    this.redraw();
  }

  clearBoard(): void {
    this.match = null;
    this.redraw();
  }

  private layout(): void {
    if (!this.match) return;
    const boxes = this.match.boxes;
    const w = this.scale.width;
    const h = this.scale.height;
    const usable = Math.min(w, h) - this.pad * 2;
    this.cell = usable / boxes;
  }

  private pos(r: number, c: number): { x: number; y: number } {
    const boxes = this.match!.boxes;
    const boardW = this.cell * boxes;
    const boardH = this.cell * boxes;
    const ox = (this.scale.width - boardW) / 2;
    const oy = (this.scale.height - boardH) / 2;
    return { x: ox + c * this.cell, y: oy + r * this.cell };
  }

  private colorOf(playerId: string): number {
    const p = this.match?.players.find((x) => x?.id === playerId);
    const key = (p?.color ?? 'blue') as PlayerColor;
    return PLAYER_COLOR_NUM[key] ?? PLAYER_COLOR_NUM.blue;
  }

  private redraw(): void {
    this.hitters.forEach((h) => h.destroy());
    this.hitters = [];
    this.graphics.clear();
    if (!this.match) return;

    this.layout();
    const boxes = this.match.boxes;
    const myTurn =
      this.match.status === 'playing' &&
      this.myId &&
      this.match.currentPlayerId === this.myId;

    // Caixas fechadas com a cor de quem fechou
    for (const [key, owner] of Object.entries(this.match.boxesOwned)) {
      const [r, c] = key.split(':').map(Number);
      const a = this.pos(r, c);
      const col = this.colorOf(owner);
      this.graphics.fillStyle(col, 0.55);
      this.graphics.fillRect(a.x + 2, a.y + 2, this.cell - 4, this.cell - 4);
      this.graphics.lineStyle(2, col, 0.9);
      this.graphics.strokeRect(a.x + 2, a.y + 2, this.cell - 4, this.cell - 4);
    }

    const lineW = Math.max(4, this.cell * 0.08);
    for (let r = 0; r <= boxes; r++) {
      for (let c = 0; c < boxes; c++) {
        this.drawEdge(makeEdge('h', r, c), 'h', r, c, lineW, myTurn);
      }
    }
    for (let r = 0; r < boxes; r++) {
      for (let c = 0; c <= boxes; c++) {
        this.drawEdge(makeEdge('v', r, c), 'v', r, c, lineW, myTurn);
      }
    }

    const dotR = Math.max(4, this.cell * 0.09);
    for (let r = 0; r <= boxes; r++) {
      for (let c = 0; c <= boxes; c++) {
        const p = this.pos(r, c);
        this.graphics.fillStyle(COLORS.dot, 1);
        this.graphics.fillCircle(p.x, p.y, dotR);
      }
    }
  }

  private drawEdge(
    id: EdgeId,
    kind: 'h' | 'v',
    r: number,
    c: number,
    lineW: number,
    myTurn: boolean | string | null,
  ): void {
    const owner = this.match!.edges[id];
    const a = this.pos(r, c);
    const b = kind === 'h' ? this.pos(r, c + 1) : this.pos(r + 1, c);

    if (owner) {
      this.graphics.lineStyle(lineW, this.colorOf(owner), 1);
      this.graphics.beginPath();
      this.graphics.moveTo(a.x, a.y);
      this.graphics.lineTo(b.x, b.y);
      this.graphics.strokePath();
      return;
    }

    this.graphics.lineStyle(lineW * 0.7, COLORS.lineIdle, 0.55);
    this.graphics.beginPath();
    this.graphics.moveTo(a.x, a.y);
    this.graphics.lineTo(b.x, b.y);
    this.graphics.strokePath();

    if (!myTurn) return;

    const hitPad = Math.max(14, this.cell * 0.22);
    let hx: number;
    let hy: number;
    let hw: number;
    let hh: number;
    if (kind === 'h') {
      hx = (a.x + b.x) / 2;
      hy = a.y;
      hw = this.cell - 8;
      hh = hitPad;
    } else {
      hx = a.x;
      hy = (a.y + b.y) / 2;
      hw = hitPad;
      hh = this.cell - 8;
    }

    const hit = this.add
      .rectangle(hx, hy, hw, hh, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => {
      this.graphics.lineStyle(lineW, COLORS.lineHover, 0.9);
      this.graphics.beginPath();
      this.graphics.moveTo(a.x, a.y);
      this.graphics.lineTo(b.x, b.y);
      this.graphics.strokePath();
    });
    hit.on('pointerout', () => this.redraw());
    hit.on('pointerdown', () => this.onMove?.(id));
    this.hitters.push(hit);
  }
}

export function createGame(parent: string): Phaser.Game {
  const el = document.getElementById(parent);
  const w = el?.clientWidth || 360;
  const h = el?.clientHeight || 360;
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: w,
    height: h,
    backgroundColor: '#163828',
    scene: [BoardScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: { antialias: true, roundPixels: false },
  });
}
