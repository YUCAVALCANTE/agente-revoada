"""Experimento de políticas de mira × latência, com o detector real rodando no navegador.

Para cada (detector, política, latência, semente) roda um episódio de Revoada em relógio
virtual (web/experimento.html). O mesmo conjunto de sementes é usado em todas as
combinações, então as comparações são pareadas: mesma partida, só muda a decisão.

Saída: dados/experimento/episodios.jsonl (bruto, retomável) e reports/experimento_politicas.json (resumo).
"""

from __future__ import annotations

import argparse
import json

import numpy as np

from revoada.dataset import RAIZ, iniciar_servidor

POLITICAS = ["maiorConfianca", "maisPerto", "antecipacao"]
LATENCIAS = [0.0, 0.05, 0.1, 0.2, 0.3]
BRUTO = RAIZ / "dados" / "experimento" / "episodios.jsonl"


def limiares_escolhidos() -> dict[str, float]:
    """Limiar de confiança de cada detector, escolhido na validação (máximo F1)."""
    arq = RAIZ / "reports" / "metricas_deteccao.json"
    padrao = {"oraculo": 0.5, "proprio": 0.5, "coco": 0.25}
    if arq.exists():
        padrao.update(json.loads(arq.read_text(encoding="utf-8")).get("limiar_escolhido", {}))
    return padrao


def chave(ep: dict) -> tuple:
    return (ep["detector"], ep["politica"], round(ep["latencia"], 3), ep["semente"])


def rodar(detectores: list[str], sementes: list[int], duracao: float, porta: int = 8798) -> None:
    from playwright.sync_api import sync_playwright

    BRUTO.parent.mkdir(parents=True, exist_ok=True)
    feitos = set()
    if BRUTO.exists():
        feitos = {chave(json.loads(linha)) for linha in BRUTO.read_text().splitlines() if linha}
    limiares = limiares_escolhidos()
    proc = iniciar_servidor(porta, isolado=True)
    try:
        with sync_playwright() as p:
            navegador = p.chromium.launch()
            pagina = navegador.new_page()
            pagina.goto(f"http://localhost:{porta}/experimento.html")
            pagina.wait_for_function("window.pronto === true")
            with BRUTO.open("a") as saida:
                for det in detectores:
                    for lat in LATENCIAS:
                        for pol in POLITICAS:
                            for s in sementes:
                                op = {"detector": det, "politica": pol, "latencia": lat, "semente": s,
                                      "duracao": duracao, "limiar": limiares[det]}
                                if chave(op) in feitos:
                                    continue
                                r = pagina.evaluate("(op) => window.rodarEpisodioNoNavegador(op)", op)
                                r.update({"detector": det, "limiar": limiares[det], "duracao": duracao})
                                saida.write(json.dumps(r) + "\n")
                                saida.flush()
                            print(det, lat, pol, "ok", flush=True)
            navegador.close()
    finally:
        proc.terminate()


def ic_bootstrap(valores: np.ndarray, n: int = 2000, semente: int = 0) -> tuple[float, float]:
    """IC de 95% da média por bootstrap sobre episódios."""
    rng = np.random.default_rng(semente)
    medias = rng.choice(valores, size=(n, len(valores)), replace=True).mean(axis=1)
    return float(np.percentile(medias, 2.5)), float(np.percentile(medias, 97.5))


def resumir() -> dict:
    episodios = [json.loads(linha) for linha in BRUTO.read_text().splitlines() if linha]
    grupos: dict[tuple, list[dict]] = {}
    for ep in episodios:
        grupos.setdefault((ep["detector"], ep["politica"], ep["latencia"]), []).append(ep)
    linhas = []
    for (det, pol, lat), eps in sorted(grupos.items()):
        tiros = np.array([e["tiros"] for e in eps], dtype=float)
        acertos = np.array([e["acertos"] for e in eps], dtype=float)
        prec = acertos / np.maximum(tiros, 1)
        abates = np.array([e["abatesPorMinuto"] for e in eps])
        baloes = np.array([e["baloes"] for e in eps], dtype=float) / np.array([e["duracao"] for e in eps]) * 60
        registro = [t for e in eps for t in e["registro"]]
        desloc = [t["deslocamentoPx"] for t in registro if t["deslocamentoPx"] is not None]
        erro = [t["erroPx"] for t in registro if t["erroPx"] is not None]
        atraso = [t["atraso"] for t in registro]
        lo, hi = ic_bootstrap(prec)
        linhas.append({
            "detector": det, "politica": pol, "latencia_ms": round(lat * 1000),
            "episodios": len(eps),
            "precisao": float(prec.mean()), "precisao_ic95": [lo, hi],
            "abates_por_minuto": float(abates.mean()), "abates_ic95": list(ic_bootstrap(abates)),
            "baloes_por_minuto": float(baloes.mean()),
            "tiros_por_minuto": float((tiros / np.array([e["duracao"] for e in eps]) * 60).mean()),
            "deslocamento_alvo_px_mediana": float(np.median(desloc)) if desloc else None,
            "erro_mira_px_mediana": float(np.median(erro)) if erro else None,
            "atraso_captura_tiro_ms_mediana": float(np.median(atraso) * 1000) if atraso else None,
            "inferencia_ms_mediana": float(np.median([e.get("msInferenciaMediana", 0) for e in eps])),
        })
    resumo = {"linhas": linhas, "limiares": limiares_escolhidos()}
    destino = RAIZ / "reports" / "experimento_politicas.json"
    destino.write_text(json.dumps(resumo, ensure_ascii=False, indent=1))
    print("salvo em", destino)
    return resumo


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--detectores", nargs="+", default=["oraculo", "proprio", "coco"])
    ap.add_argument("--sementes", type=int, default=10)
    ap.add_argument("--duracao", type=float, default=30)
    ap.add_argument("--so-resumir", action="store_true")
    args = ap.parse_args()
    if not args.so_resumir:
        rodar(args.detectores, list(range(1, args.sementes + 1)), args.duracao)
    resumir()


if __name__ == "__main__":
    main()
