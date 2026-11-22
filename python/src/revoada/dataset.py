"""Gera frames rotulados de Revoada usando o próprio jogo (canvas) num Chromium headless.

O jogo é a fonte da verdade: a página `web/dataset.html` desenha cada cena e devolve
as caixas reais calculadas a partir da mesma geometria usada no desenho.

Saída no formato YOLO (ultralytics):
    dados/revoada/images/<split>/<nome>.png
    dados/revoada/labels/<split>/<nome>.txt   -> "classe cx cy w h" normalizados
    dados/revoada/rotulos_<split>.json        -> caixas em pixels (usado na avaliação)
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
CLASSES = ["ave", "balao"]

# Sementes disjuntas por partição; "teste_noite" usa uma cena que o treino nunca viu.
SPLITS = {
    "treino": (1, 3000, None),
    "validacao": (100_001, 500, None),
    "teste": (200_001, 1000, None),
    "teste_noite": (300_001, 500, "noite"),
}


def para_yolo(caixa: list[float], largura: int, altura: int) -> tuple[float, float, float, float]:
    """Converte [x1, y1, x2, y2] em pixels para (cx, cy, w, h) normalizados."""
    x1, y1, x2, y2 = caixa
    return ((x1 + x2) / 2 / largura, (y1 + y2) / 2 / altura, (x2 - x1) / largura, (y2 - y1) / altura)


def linha_yolo(classe: str, caixa: list[float], largura: int, altura: int) -> str:
    cx, cy, w, h = para_yolo(caixa, largura, altura)
    return f"{CLASSES.index(classe)} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"


def iniciar_servidor(porta: int, isolado: bool = False) -> subprocess.Popen:
    cmd = ["node", str(RAIZ / "scripts" / "servidor.mjs"), str(porta)] + (["--isolado"] if isolado else [])
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    time.sleep(0.8)
    return proc


def gerar(destino: Path, splits: list[str], porta: int = 8799) -> None:
    from playwright.sync_api import sync_playwright

    servidor = iniciar_servidor(porta)
    try:
        with sync_playwright() as p:
            navegador = p.chromium.launch()
            pagina = navegador.new_page()
            pagina.goto(f"http://localhost:{porta}/dataset.html")
            pagina.wait_for_function("window.pronto === true")
            for split in splits:
                inicio, n, cena = SPLITS[split]
                (destino / "images" / split).mkdir(parents=True, exist_ok=True)
                (destino / "labels" / split).mkdir(parents=True, exist_ok=True)
                rotulos = {}
                for semente in range(inicio, inicio + n):
                    r = pagina.evaluate("([s, c]) => window.gerarFrame(s, c)", [semente, cena])
                    nome = f"{split}_{semente}"
                    png = base64.b64decode(r["imagem"].split(",", 1)[1])
                    (destino / "images" / split / f"{nome}.png").write_bytes(png)
                    linhas = [linha_yolo(c["classe"], c["caixa"], r["largura"], r["altura"]) for c in r["caixas"]]
                    (destino / "labels" / split / f"{nome}.txt").write_text("\n".join(linhas))
                    rotulos[nome] = {"cena": r["cena"], "caixas": r["caixas"]}
                (destino / f"rotulos_{split}.json").write_text(json.dumps(rotulos))
                print(f"{split}: {n} frames")
            navegador.close()
    finally:
        servidor.terminate()

    (destino / "revoada.yaml").write_text(
        f"path: {destino.as_posix()}\ntrain: images/treino\nval: images/validacao\ntest: images/teste\n"
        "names:\n  0: ave\n  1: balao\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--destino", type=Path, default=RAIZ / "dados" / "revoada")
    ap.add_argument("--splits", nargs="+", default=list(SPLITS))
    args = ap.parse_args()
    gerar(args.destino, args.splits)


if __name__ == "__main__":
    main()
