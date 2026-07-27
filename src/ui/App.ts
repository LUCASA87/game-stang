import type {
  MatchPublic,
  PlayerColor,
  RoomPublic,
  TournamentPublic,
  TournamentSize,
} from '../../shared/protocol';
import {
  PLAYER_COLOR_HEX,
  PLAYER_COLOR_LABEL,
  PLAYER_COLORS,
  type ServerToClient,
} from '../../shared/protocol';
import { NetClient } from '../net/client';
import { BoardScene, createGame } from '../game/BoardScene';
import type Phaser from 'phaser';

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function showScreen(id: string): void {
  document.querySelectorAll<HTMLElement>('.screen').forEach((el) => {
    const on = el.id === id;
    el.classList.toggle('active', on);
    el.hidden = !on;
  });
  document.body.classList.toggle('on-menu', id === 'screen-menu');
}

function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  window.setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

/** Confirmação dentro do jogo (sem alert/confirm do navegador). */
function askConfirm(title: string, text: string, okLabel = 'Confirmar'): Promise<boolean> {
  const modal = $('game-modal');
  const titleEl = $('game-modal-title');
  const textEl = $('game-modal-text');
  const okBtn = $('game-modal-ok') as HTMLButtonElement;
  const cancelBtn = $('game-modal-cancel') as HTMLButtonElement;

  titleEl.textContent = title;
  textEl.textContent = text;
  okBtn.textContent = okLabel;
  modal.hidden = false;

  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      modal.hidden = true;
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      resolve(value);
    };
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
    modal.onclick = (e) => {
      if (e.target === modal) finish(false);
    };
  });
}

function nickname(): string {
  const v = ($('nickname') as HTMLInputElement).value.trim();
  return v || 'Jogador';
}

function qs(): URLSearchParams {
  return new URLSearchParams(location.search);
}

export class App {
  private net = new NetClient();
  private room: RoomPublic | null = null;
  private tournament: TournamentPublic | null = null;
  private match: MatchPublic | null = null;
  private game: Phaser.Game | null = null;

  start(): void {
    const savedNick = localStorage.getItem('game_stang_nick');
    if (savedNick) ($('nickname') as HTMLInputElement).value = savedNick;

    showScreen('screen-menu');
    this.bindUi();
    this.net.on((msg) => this.onMsg(msg));

    this.net.socket.on('connect', () => {
      $('conn').textContent = 'online';
      $('conn').classList.add('online');
      $('conn').classList.remove('offline');
    });
    this.net.socket.on('disconnect', () => {
      $('conn').textContent = 'offline';
      $('conn').classList.add('offline');
      $('conn').classList.remove('online');
    });
    this.net.socket.on('connect_error', () => {
      $('conn').textContent = 'sem servidor';
      $('conn').classList.add('offline');
      $('conn').classList.remove('online');
    });

    if (this.net.missingServerConfig) {
      $('conn').textContent = 'configure o servidor';
      $('conn').classList.add('offline');
      toast('Edite docs/config.js com a URL do Render e faça novo build/push.');
    } else if (!this.net.connected) {
      // dá um tempo; se não conectar, avisa
      window.setTimeout(() => {
        if (!this.net.connected) {
          $('conn').textContent = 'sem servidor';
          $('conn').classList.add('offline');
        }
      }, 4000);
    }

    this.net.on((msg) => {
      if (msg.type !== 'helloOk') return;
      $('conn').textContent = 'online';
      $('conn').classList.add('online');
      $('conn').classList.remove('offline');
      // Espera roomState/tournamentState do hello antes de tentar join pela URL
      // (senão o joinRoom zera a cor no meio da partida)
      window.setTimeout(() => this.tryJoinFromUrl(), 150);
    });
  }

  private tryJoinFromUrl(): void {
    const p = qs();
    const room = p.get('room');
    const tourney = p.get('tournament');
    if (room && !this.room) {
      void this.runOnline(() => {
        if (this.room) return;
        this.net.send({ type: 'joinRoom', code: room, nickname: nickname() });
      });
    } else if (tourney && !this.tournament) {
      void this.runOnline(() => {
        if (this.tournament) return;
        this.net.send({ type: 'joinTournament', code: tourney, nickname: nickname() });
      });
    }
  }

  private bindUi(): void {
    $('nickname').addEventListener('change', () => {
      localStorage.setItem('game_stang_nick', nickname());
    });

    $('btn-create-room').onclick = () => this.toggleForm('form-create-room');
    $('confirm-create-room').onclick = () => {
      if (!this.requireMenuName()) return;
      void this.runOnline(() => {
        const boxes = Number(($('room-boxes') as HTMLSelectElement).value);
        this.net.send({ type: 'createRoom', nickname: nickname(), boxes });
      });
    };

    $('btn-join-room').onclick = () => this.toggleForm('form-join-room');
    $('confirm-join-room').onclick = () => {
      if (!this.requireMenuName()) return;
      void this.runOnline(() => {
        const code = ($('join-room-code') as HTMLInputElement).value;
        this.net.send({ type: 'joinRoom', code, nickname: nickname() });
      });
    };

    $('btn-create-tourney').onclick = () => this.toggleForm('form-create-tourney');
    $('confirm-create-tourney').onclick = () => {
      if (!this.requireMenuName()) return;
      void this.runOnline(() => {
        const name = ($('tourney-name') as HTMLInputElement).value || 'Campeonato';
        const size = Number(($('tourney-size') as HTMLSelectElement).value) as TournamentSize;
        const boxes = Number(($('tourney-boxes') as HTMLSelectElement).value);
        this.net.send({ type: 'createTournament', nickname: nickname(), name, size, boxes });
      });
    };

    $('btn-join-tourney').onclick = () => this.toggleForm('form-join-tourney');
    $('confirm-join-tourney').onclick = () => {
      if (!this.requireMenuName()) return;
      void this.runOnline(() => {
        const code = ($('join-tourney-code') as HTMLInputElement).value;
        this.net.send({ type: 'joinTournament', code, nickname: nickname() });
      });
    };

    $('btn-start-room').onclick = () => {
      void this.runOnline(() => this.net.send({ type: 'startRoom' }));
    };
    $('btn-leave-room').onclick = () => this.leaveAll();
    $('copy-room-link').onclick = () => this.copyLink('room');
    $('btn-save-room-name').onclick = () => this.saveLobbyName('room-nickname');

    $('btn-start-tourney').onclick = () => {
      void this.runOnline(() => this.net.send({ type: 'startTournament' }));
    };
    $('btn-leave-tourney').onclick = () => this.leaveAll();
    $('copy-tourney-link').onclick = () => this.copyLink('tournament');
    $('btn-save-tourney-name').onclick = () => this.saveLobbyName('tourney-nickname');

    $('btn-rematch').onclick = () => {
      void this.runOnline(() => this.net.send({ type: 'rematch' }));
    };
    $('btn-leave-match').onclick = () => this.leaveAll();
    $('btn-abandon').onclick = () => this.abandonMatch();
    $('btn-back-bracket').onclick = () => {
      if (this.tournament) {
        this.renderTournament();
        showScreen('screen-tourney');
      }
    };
  }

  private async abandonMatch(): Promise<void> {
    if (!this.match || this.match.status !== 'playing') {
      this.leaveAll();
      return;
    }
    const ok = await askConfirm(
      'Abandonar partida?',
      'O adversário vence e você sai da sala.',
      'Abandonar',
    );
    if (!ok) return;
    this.leaveAll();
  }

  /** Garante servidor online antes de criar/entrar. */
  private async runOnline(action: () => void): Promise<void> {
    if (this.net.missingServerConfig) {
      $('conn').textContent = 'configure o servidor';
      toast('No GitHub Pages precisa do servidor Render em config.js');
      return;
    }

    $('conn').textContent = 'conectando…';
    $('conn').classList.add('offline');
    $('conn').classList.remove('online');

    const ok = await this.net.whenReady(10000);
    if (!ok) {
      $('conn').textContent = 'sem servidor';
      toast('Servidor offline. No PC rode: npm run dev');
      return;
    }

    $('conn').textContent = 'online';
    $('conn').classList.add('online');
    $('conn').classList.remove('offline');
    action();
  }

  private saveLobbyName(inputId: string): void {
    const nick = ($(inputId) as HTMLInputElement).value.trim();
    if (nick.length < 2) {
      toast('Digite seu nome (mín. 2 letras)');
      return;
    }
    localStorage.setItem('game_stang_nick', nick);
    ($('nickname') as HTMLInputElement).value = nick;
    void this.runOnline(() => this.net.send({ type: 'setNickname', nickname: nick }));
  }

  private hasValidName(p: { nickname: string } | undefined): boolean {
    return !!p?.nickname?.trim() && p.nickname.trim().length >= 2;
  }

  private requireMenuName(): boolean {
    const nick = nickname();
    if (nick.length < 2) {
      toast('Digite seu nome no menu (mín. 2 letras)');
      ($('nickname') as HTMLInputElement).focus();
      return false;
    }
    localStorage.setItem('game_stang_nick', nick);
    return true;
  }

  /** Cores já usadas por outros jogadores do lobby */
  private takenColors(players: { id: string; color: PlayerColor | null }[]): Set<PlayerColor> {
    const taken = new Set<PlayerColor>();
    for (const p of players) {
      if (p.color && p.id !== this.net.playerId) taken.add(p.color);
    }
    return taken;
  }

  private renderLobbyColorPicker(
    containerId: string,
    players: { id: string; color: PlayerColor | null }[],
    inLobby: boolean,
  ): void {
    const box = $(containerId);
    const me = players.find((p) => p.id === this.net.playerId);
    const taken = this.takenColors(players);
    box.innerHTML = '';
    box.parentElement?.toggleAttribute('hidden', !inLobby);

    for (const c of PLAYER_COLORS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isTaken = taken.has(c);
      const isMine = me?.color === c;
      btn.className =
        'color-swatch' + (isMine ? ' selected' : '') + (isTaken ? ' taken' : '');
      btn.style.background = PLAYER_COLOR_HEX[c];
      btn.title = isTaken ? `${PLAYER_COLOR_LABEL[c]} (já usada)` : PLAYER_COLOR_LABEL[c];
      btn.disabled = isTaken || !inLobby;
      btn.onclick = () => {
        if (isTaken) return;
        void this.runOnline(() => this.net.send({ type: 'setColor', color: c }));
      };
      box.appendChild(btn);
    }
  }

  private toggleForm(id: string): void {
    const forms = $('menu-forms');
    forms.hidden = false;
    ['form-create-room', 'form-join-room', 'form-create-tourney', 'form-join-tourney'].forEach((fid) => {
      $(fid).hidden = fid !== id;
    });
  }

  private leaveAll(): void {
    this.net.send({ type: 'leave' });
    this.room = null;
    this.tournament = null;
    this.match = null;
    this.destroyGame();
    history.replaceState({}, '', location.pathname);
    showScreen('screen-menu');
  }

  private copyLink(kind: 'room' | 'tournament'): void {
    const code = kind === 'room' ? this.room?.code : this.tournament?.code;
    if (!code) return;
    const url = `${location.origin}${location.pathname}?${kind}=${code}`;
    navigator.clipboard?.writeText(url).then(
      () => toast('Link copiado!'),
      () => toast(url),
    );
  }

  private onMsg(msg: ServerToClient): void {
    switch (msg.type) {
      case 'error':
        toast(msg.message);
        break;
      case 'roomState':
        this.room = msg.room;
        this.setUrlParam('room', msg.room.code);
        if (msg.room.match && msg.room.status !== 'lobby') {
          this.match = msg.room.match;
          this.enterMatch();
        } else {
          this.renderRoom();
          showScreen('screen-room');
        }
        break;
      case 'matchState':
        this.match = msg.match;
        this.enterMatch();
        break;
      case 'tournamentState':
        this.tournament = msg.tournament;
        this.setUrlParam('tournament', msg.tournament.code);
        // If we have an active match in this tournament, stay on match
        if (this.match?.tournamentId === msg.tournament.code && this.match.status === 'playing') {
          this.renderTournament();
          break;
        }
        if (this.match?.status === 'finished' && this.match.tournamentId) {
          this.renderTournament();
          // keep match end visible unless user goes back
          break;
        }
        this.renderTournament();
        if (!this.match || this.match.status !== 'playing') {
          showScreen('screen-tourney');
        }
        break;
      case 'left':
        this.room = null;
        this.tournament = null;
        this.match = null;
        this.destroyGame();
        showScreen('screen-menu');
        break;
    }
  }

  private setUrlParam(key: string, value: string): void {
    const u = new URL(location.href);
    u.searchParams.set(key, value);
    if (key === 'room') u.searchParams.delete('tournament');
    if (key === 'tournament') u.searchParams.delete('room');
    history.replaceState({}, '', u.toString());
  }

  private renderRoom(): void {
    if (!this.room) return;
    $('room-code').textContent = this.room.code;
    const ul = $('room-players');
    ul.innerHTML = '';
    for (const p of this.room.players) {
      const li = document.createElement('li');
      const host = p.id === this.room.hostId ? ' · host' : '';
      const you = p.id === this.net.playerId ? ' (você)' : '';
      const hex = p.color ? PLAYER_COLOR_HEX[p.color] : '#666';
      const name = this.hasValidName(p) ? p.nickname : 'sem nome';
      const colorLabel = p.color ? PLAYER_COLOR_LABEL[p.color] : 'sem cor';
      li.innerHTML = `<span><i class="color-dot" style="background:${hex}"></i>${name}${you}${host}</span><span>${colorLabel}</span>`;
      ul.appendChild(li);
    }

    const inLobby = this.room.status === 'lobby';
    $('room-profile').hidden = !inLobby;
    this.renderLobbyColorPicker('room-color-picker', this.room.players, inLobby);

    const me = this.room.players.find((p) => p.id === this.net.playerId);
    const nickInput = $('room-nickname') as HTMLInputElement;
    if (inLobby && document.activeElement !== nickInput) {
      nickInput.value = this.hasValidName(me) ? me!.nickname : nickname() || '';
    }

    const allReady =
      this.room.players.every((p) => this.hasValidName(p) && p.color) &&
      this.room.players.length === 2;
    const isHost = this.room.hostId === this.net.playerId;
    ($('btn-start-room') as HTMLButtonElement).disabled = !(isHost && allReady);

    if (!this.hasValidName(me)) {
      $('room-hint').textContent = 'Digite seu nome e clique em Salvar nome.';
    } else if (!me?.color) {
      $('room-hint').textContent = 'Escolha uma cor livre para continuar.';
    } else if (this.room.players.length < 2) {
      $('room-hint').textContent = 'Compartilhe o código/link e aguarde o amigo.';
    } else if (!allReady) {
      $('room-hint').textContent = 'Aguardando todos definirem nome e cor…';
    } else if (isHost) {
      $('room-hint').textContent = 'Pronto! Clique em Iniciar.';
    } else {
      $('room-hint').textContent = 'Aguardando o host iniciar…';
    }
  }

  private renderTournament(): void {
    if (!this.tournament) return;
    const t = this.tournament;
    $('tourney-title').textContent = t.name;
    $('tourney-code').textContent = t.code;
    const ul = $('tourney-players');
    ul.innerHTML = '';
    for (const p of t.players) {
      const li = document.createElement('li');
      const host = p.id === t.hostId ? ' · host' : '';
      const you = p.id === this.net.playerId ? ' (você)' : '';
      const out = t.eliminatedIds?.includes(p.id) ? 'eliminado' : t.activeIds?.includes(p.id) || t.status === 'lobby' ? (p.connected ? 'online' : 'ausente') : '';
      const champ = p.id === t.championId ? ' · campeão' : '';
      const hex = p.color ? PLAYER_COLOR_HEX[p.color] : '#666';
      const name = this.hasValidName(p) ? p.nickname : 'sem nome';
      const colorLabel = p.color ? PLAYER_COLOR_LABEL[p.color] : 'sem cor';
      li.innerHTML = `<span><i class="color-dot" style="background:${hex}"></i>${name}${you}${host}${champ}</span><span>${out || colorLabel}</span>`;
      if (t.eliminatedIds?.includes(p.id)) li.style.opacity = '0.55';
      ul.appendChild(li);
    }

    const inLobby = t.status === 'lobby';
    $('tourney-color-wrap').hidden = !inLobby;
    this.renderLobbyColorPicker('tourney-color-picker', t.players, inLobby);

    const me = t.players.find((p) => p.id === this.net.playerId);
    const nickInput = $('tourney-nickname') as HTMLInputElement;
    if (inLobby && document.activeElement !== nickInput) {
      nickInput.value = this.hasValidName(me) ? me!.nickname : nickname() || '';
    }

    const allReady = t.players.every((p) => this.hasValidName(p) && p.color);
    const isHost = t.hostId === this.net.playerId;
    ($('btn-start-tourney') as HTMLButtonElement).disabled = !(
      isHost &&
      inLobby &&
      t.players.length === t.size &&
      allReady
    );
    ($('btn-start-tourney') as HTMLButtonElement).hidden = !inLobby;

    if (t.status === 'lobby') {
      if (!this.hasValidName(me)) {
        $('tourney-hint').textContent = `Digite seu nome e Salvar · ${t.players.length}/${t.size}`;
      } else if (!me?.color) {
        $('tourney-hint').textContent = `Escolha uma cor livre · ${t.players.length}/${t.size}`;
      } else if (!allReady) {
        $('tourney-hint').textContent = `Aguardando nome e cor · ${t.players.length}/${t.size}`;
      } else {
        $('tourney-hint').textContent = `${t.players.length}/${t.size} prontos · duplas 1v1, perdedor eliminado`;
      }
    } else if (t.status === 'finished') {
      const champ = t.players.find((p) => p.id === t.championId);
      $('tourney-hint').textContent = champ
        ? `Campeão: ${champ.nickname}`
        : 'Campeonato encerrado';
    } else {
      const vivos = t.activeIds?.length ?? 0;
      $('tourney-hint').textContent = `Rodada ${(t.currentRound ?? 0) + 1} · ${vivos} ainda na disputa`;
    }

    const nick = (id: string | null) => {
      if (!id) return '—';
      return t.players.find((p) => p.id === id)?.nickname ?? id.slice(0, 6);
    };

    const bracket = $('bracket');
    bracket.innerHTML = '';
    if (!t.bracket.length) return;

    const rounds = Math.max(...t.bracket.map((m) => m.round));
    for (let r = 0; r <= rounds; r++) {
      const wrap = document.createElement('div');
      wrap.className = 'bracket-round';
      const title = document.createElement('h3');
      const isLast = r === rounds && t.status === 'finished';
      title.textContent = isLast
        ? 'Final'
        : t.activeIds?.length === 2 && r === t.currentRound
          ? `Rodada ${r + 1} (final)`
          : `Rodada ${r + 1}`;
      wrap.appendChild(title);
      for (const m of t.bracket.filter((b) => b.round === r)) {
        const div = document.createElement('div');
        div.className = 'bm';
        const mine =
          m.playerIds.includes(this.net.playerId) || this.match?.bracketMatchId === m.id;
        if (mine) div.classList.add('mine');
        if (m.bye) {
          div.innerHTML = `${nick(m.playerIds[0])} <strong>· bye (avança)</strong>`;
        } else {
          const status =
            m.status === 'done'
              ? ` → ${nick(m.winnerId)} (eliminou ${nick(m.playerIds.find((id) => id && id !== m.winnerId) ?? null)})`
              : m.status === 'playing'
                ? ' (jogando)'
                : m.status === 'ready'
                  ? ' (pronta)'
                  : '';
          div.innerHTML = `${nick(m.playerIds[0])}<span class="vs">vs</span>${nick(m.playerIds[1])}<strong>${status}</strong>`;
        }
        wrap.appendChild(div);
      }
      bracket.appendChild(wrap);
    }
  }

  private enterMatch(): void {
    if (!this.match) return;
    showScreen('screen-match');
    this.ensureGame();
    this.renderMatchHud();

    const scene = this.game?.scene.getScene('Board') as BoardScene | undefined;
    scene?.setState(this.match, this.net.playerId, (edge) => {
      this.net.send({ type: 'playMove', edge });
    });

    const ended = this.match.status === 'finished';
    $('match-end').hidden = !ended;
    $('match-playing-actions').hidden = ended;
    if (ended) {
      const w = this.match.winnerId;
      const me = this.net.playerId;
      const inTourney = Boolean(this.match.tournamentId);
      let text = 'Empate!';
      if (w === me) text = inTourney ? 'Você venceu a dupla!' : 'Você venceu!';
      else if (w) {
        const name = this.match.players.find((p) => p?.id === w)?.nickname ?? 'Adversário';
        text = inTourney ? `Eliminado por ${name}` : `${name} venceu`;
      }
      $('match-end-text').textContent = text;
      $('btn-rematch').hidden = inTourney;
      $('btn-back-bracket').hidden = !inTourney;
    }
  }

  refreshHud(): void {
    this.renderMatchHud();
  }

  private renderMatchHud(): void {
    if (!this.match) return;
    const [p0, p1] = this.match.players;
    const s0 = p0 ? this.match.scores[p0.id] ?? 0 : 0;
    const s1 = p1 ? this.match.scores[p1.id] ?? 0 : 0;
    const score0 = $('score-p0');
    const score1 = $('score-p1');
    const board = score0.parentElement;
    const currentId = this.match.currentPlayerId;
    const current = this.match.players.find((p) => p?.id === currentId) ?? null;
    const turnColor = current?.color ? PLAYER_COLOR_HEX[current.color] : 'var(--accent)';

    score0.className = 'score' + (p0?.id === currentId && this.match.status === 'playing' ? ' active' : '');
    score1.className = 'score' + (p1?.id === currentId && this.match.status === 'playing' ? ' active' : '');
    const c0 = p0?.color ? PLAYER_COLOR_HEX[p0.color] : '#4fc3f7';
    const c1 = p1?.color ? PLAYER_COLOR_HEX[p1.color] : '#ff8a65';
    score0.style.borderLeft = `4px solid ${c0}`;
    score1.style.borderLeft = `4px solid ${c1}`;
    score0.style.setProperty('--turn-color', c0);
    score1.style.setProperty('--turn-color', c1);
    score0.textContent = `${p0?.nickname ?? '—'} · ${s0}`;
    score1.textContent = `${s1} · ${p1?.nickname ?? '—'}`;
    score1.style.textAlign = 'right';
    if (board) board.style.setProperty('--turn-color', turnColor);

    const turn = $('turn-label');
    if (this.match.status === 'finished') {
      turn.textContent = 'Fim';
      turn.style.color = '';
    } else {
      const name = current?.nickname?.trim() || 'Jogador';
      const left = this.match.turnDeadline
        ? Math.max(0, Math.ceil((this.match.turnDeadline - Date.now()) / 1000))
        : 0;
      const mine = currentId === this.net.playerId;
      turn.textContent = mine ? `Sua vez · ${name} · ${left}s` : `Vez de ${name} · ${left}s`;
      turn.style.whiteSpace = '';
      turn.style.color = turnColor;
    }
  }

  private ensureGame(): void {
    if (this.game) return;
    this.game = createGame('game-container');
  }

  private destroyGame(): void {
    if (!this.game) return;
    this.game.destroy(true);
    this.game = null;
    $('game-container').innerHTML = '';
  }
}

setInterval(() => {
  const app = (window as unknown as { __app?: App }).__app;
  app?.refreshHud();
}, 500);
