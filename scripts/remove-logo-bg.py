"""Remove solid background from Game Stang logo and crop to content."""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

SRC = Path(
    r"C:\Users\Micro\.cursor\projects\c-Users-Micro-Desktop-Trabalhos-Jogo\assets"
    r"\c__Users_Micro_AppData_Roaming_Cursor_User_workspaceStorage_86d0941df6a8b9fbdcc43b032a72f9f3"
    r"_images__C5B41B31-95F1-47FA-83D1-2D0E4964599F_-8b34544c-426a-4a46-93c6-6847e1d64003.png"
)
OUTS = [
    Path(r"c:\Users\Micro\Desktop\Trabalhos\Jogo\public\logo-game-stang.png"),
    Path(r"c:\Users\Micro\Desktop\Trabalhos\Jogo\docs\logo-game-stang.png"),
]


def is_bg(rgb: tuple[int, int, int]) -> bool:
    r, g, b = rgb
    # light gray / off-white card
    if abs(r - g) <= 22 and abs(g - b) <= 22 and min(r, g, b) >= 140:
        return True
    # dark forest green (page / frame), including very dark greens
    if g >= r + 8 and g >= b + 5 and r <= 110 and g <= 160 and b <= 100 and (r + g + b) < 280:
        return True
    # near-black leftover mats (not headset: those are inside logo, flood won't reach if we only start from bg)
    if max(r, g, b) <= 28:
        return True
    return False


def flood_bg(img: Image.Image) -> Image.Image:
    px = img.load()
    w, h = img.size
    visited = [[False] * h for _ in range(w)]
    q: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        if visited[x][y]:
            return
        visited[x][y] = True
        if is_bg(px[x, y][:3]):
            q.append((x, y))

    step = 1
    for x in range(0, w, step):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(0, h, step):
        seed(0, y)
        seed(w - 1, y)

    # gray panel often sits inset — seed a band around the border
    band = max(12, min(w, h) // 8)
    for y in range(h):
        for x in range(w):
            if x < band or y < band or x >= w - band or y >= h - band:
                if not visited[x][y]:
                    seed(x, y)

    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[nx][ny]:
                visited[nx][ny] = True
                if is_bg(px[nx, ny][:3]):
                    q.append((nx, ny))
    return img


def crop_alpha(img: Image.Image, pad: int = 4) -> Image.Image:
    bbox = img.getbbox()  # uses alpha in RGBA
    if not bbox:
        # fallback via alpha channel
        bbox = img.split()[-1].getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(img.width, r + pad)
    b = min(img.height, b + pad)
    return img.crop((l, t, r, b))


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    print("in", img.size)
    img = flood_bg(img)
    img = crop_alpha(img)
    alpha = img.split()[-1]
    hist = alpha.histogram()
    print("out size", img.size, "transparent", hist[0], "opaque", sum(hist[200:]))

    for out in OUTS:
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, "PNG", optimize=True)
        print("wrote", out)


if __name__ == "__main__":
    main()
