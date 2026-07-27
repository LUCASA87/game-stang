# Game Stang — Pontos e Caixas online

Jogue com amigos à distância e organize campeonatos (2–5 jogadores, duplas, perdedor eliminado).

## Rodar local

```bash
npm install
npm run dev
```

- Site: http://localhost:5173  
- Servidor: http://localhost:3001  

## Hospedar no GitHub Pages (público)

A Vercel não serve bem para o servidor WebSocket. Use:

| Parte | Onde |
|-------|------|
| Site (front) | **GitHub Pages** (pasta `docs/`) |
| Servidor Socket.io | **Render** (grátis) |
| Código | Repositório **público** no GitHub |

### 1. Servidor no Render

1. Suba o código no GitHub (repo público)
2. [render.com](https://render.com) → New → Web Service → conecte o repo
3. Start: `npx tsx server/index.ts`
4. Copie a URL, ex.: `https://game-stang-xxxxx.onrender.com`

### 2. Apontar o site para o servidor

Edite [`public/config.js`](public/config.js):

```js
window.GAME_STANG_SOCKET = "https://game-stang-xxxxx.onrender.com";
```

### 3. Gerar a pasta pública `docs/`

```bash
npm run build
```

Isso cria/atualiza a pasta **`docs/`** (pronta para o GitHub Pages).

### 4. Publicar no GitHub

```bash
git add .
git commit -m "Publicar Game Stang no GitHub Pages"
git push
```

No GitHub:

1. **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` → pasta **`/docs`**
4. Save

O jogo fica em:  
`https://SEU_USUARIO.github.io/SEU_REPO/`

> No plano free do Render o servidor “dorme”; a 1ª conexão pode demorar ~30s.

## Campeonato

- 2 a 5 jogadores  
- Duplas 1v1; perdedor eliminado  
- Ímpar → um jogador ganha bye  
- Cada um escolhe sua **cor**; caixas fechadas usam essa cor  
