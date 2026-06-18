from pathlib import Path

WIDTH = 480
HEIGHT = 270
COLORS = [(11, 11, 18), (242, 242, 247), (255, 122, 122), (70, 211, 154)]


def word(n: int) -> bytes:
    return bytes((n & 255, (n >> 8) & 255))


class Bits:
    def __init__(self) -> None:
        self.bytes: list[int] = []
        self.cur = 0
        self.used = 0

    def write(self, code: int, size: int) -> None:
        self.cur |= code << self.used
        self.used += size
        while self.used >= 8:
            self.bytes.append(self.cur & 255)
            self.cur >>= 8
            self.used -= 8

    def finish(self) -> list[int]:
        if self.used:
            self.bytes.append(self.cur & 255)
        return self.bytes


def lzw(indices: list[int]) -> list[int]:
    min_size = 2
    clear = 1 << min_size
    end = clear + 1
    out = Bits()
    size = min_size + 1
    next_code = end + 1
    since_clear = 0

    def reset() -> tuple[int, int, int]:
        out.write(clear, size)
        return min_size + 1, end + 1, 0

    size, next_code, since_clear = reset()
    for idx in indices:
        if since_clear >= 120:
            size, next_code, since_clear = reset()
        out.write(idx, size)
        next_code += 1
        since_clear += 1
        if next_code == 1 << size and size < 12:
            size += 1
    out.write(end, size)
    return out.finish()


def blocks(data: list[int]) -> bytes:
    out = bytearray()
    for i in range(0, len(data), 255):
        chunk = data[i : i + 255]
        out.append(len(chunk))
        out.extend(chunk)
    out.append(0)
    return bytes(out)


def rect(pixels: list[int], x: int, y: int, w: int, h: int, color: int) -> None:
    for yy in range(max(0, y), min(HEIGHT, y + h)):
        for xx in range(max(0, x), min(WIDTH, x + w)):
            pixels[yy * WIDTH + xx] = color


def frame(t: int) -> list[int]:
    pixels = [0] * (WIDTH * HEIGHT)
    rect(pixels, 24, 20, 432, 46, 1)
    rect(pixels, 38, 86, 185, 116, 1)
    rect(pixels, 257, 86, 185, 116, 1)
    rect(pixels, 72, 225, 336, 16, 1)
    rect(pixels, 76, 229, 150 + t * 12, 8, 3)
    for i in range(7):
        rect(pixels, 62 + ((t * 18 + i * 34) % 145), 150, 18, 8, 2)
        rect(pixels, 398 - ((t * 18 + i * 34) % 145), 171, 18, 8, 3)
    return pixels


gif = bytearray(b"GIF89a")
gif.extend(word(WIDTH))
gif.extend(word(HEIGHT))
gif.extend((0x81, 0, 0))
for rgb in COLORS:
    gif.extend(rgb)
gif.extend(b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00")

for i in range(12):
    gif.extend(b"\x21\xf9\x04\x04\x08\x00\x00\x00")
    gif.extend(b"\x2c" + word(0) + word(0) + word(WIDTH) + word(HEIGHT) + b"\x00")
    gif.append(2)
    gif.extend(blocks(lzw(frame(i))))

gif.append(0x3B)
out = Path("docs/assets/flow.gif")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(gif)
print(f"wrote {out} ({out.stat().st_size} bytes)")
