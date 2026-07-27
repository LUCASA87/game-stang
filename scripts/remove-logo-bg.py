"""Replace Game Stang logo, remove black background, crop."""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

SRC = Path(
    r"C:\Users\Micro\.cursor\projects\c-Users-Micro-Desktop-Trabalhos-Jogo\assets"
    r"\c__Users_Micro_AppData_Roaming_Cursor_User_workspaceStorage_86d0941df6a8b9fbdcc43b032a72f9f3"
    r"_images_uiytutyu-9d94b893-bf4c-491c-8cf7-24102762e5d9.png"
)
OUTS = [
    Path(r"c:\Users\Micro\Desktop\Trabalhos\Jogo\public\logo-game-stang.png"),
    Path(r"c:\Users\Micro\Desktop\Trabalhos\Jogo\docs\logo-game-stang.png"),
]


def is_bg(rgb: tuple[int, int, int]) -> bool:
    r, g, b = rgb
    # solid black / near-black backdrop
    if max(r, g, b) <= 35:
        return True
    # light gray card
    if abs(r - g) <= 22 and abs(g - b) <= 22 and min(r, g, b) >= 140:
        return True
    # dark green frame leftovers
    if g >= r + 8 and g >= b + 5 and r <= 110 and g <= 160 and b <= 100 and (r + g + b) < 280:
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

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    band = max(16, min(w, h) // 10)
    for y in range(h):
        for x in range(w):
            if x < band or y < band or x >= w - band or y >= h - band:
                if not visited[x][y]:
                    seed(x, y)

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[nx][ny]:
                visited[nx][ny] = True
                if is_bg(px[nx, ny][:3]):
                    q.append((nx, ny))
    return img


def crop_alpha(img: Image.Image, pad: int = 4) -> Image.Image:
    bbox = img.split()[-1].getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    return img.crop(
        (
            max(0, l - pad),
            max(0, t - pad),
            min(img.width, r + pad),
            min(img.height, b + pad),
        )
    )


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    print("in", img.size, "corner", img.getpixel((2, 2)))
    img = flood_bg(img)
    img = crop_alpha(img)
    hist = img.split()[-1].histogram()
    print("out", img.size, "transparent", hist[0], "opaque", sum(hist[200:]))
    for out in OUTS:
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, "PNG", optimize=True)
        print("wrote", out)


if __name__ == "__main__":
    main()
