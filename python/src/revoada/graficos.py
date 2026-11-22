"""Figuras do relatório (reports/figures) e o resumo usado pela página (web/resultados.json)."""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

RAIZ = Path(__file__).resolve().parents[3]
FIG = RAIZ / "reports" / "figures"
AZUL, CINZA, CINZA_CLARO, TINTA, MUDO = "#007aff", "#8e8e93", "#c7c7cc", "#1c1c1e", "#6c6c70"
NOMES_POL = {"maiorConfianca": "Maior confiança", "maisPerto": "Mais perto da mira", "antecipacao": "Antecipação"}
NOMES_DET = {
    "coco_yolov8n_640": "COCO YOLOv8n (640 px)",
    "coco_yolov8s_640": "COCO YOLOv8s (640 px)",
    "coco_yolov8n_416": "COCO YOLOv8n (416 px)",
    "revoada_yolov8n_416": "Treinado no jogo YOLOv8n (416 px)",
}

plt.rcParams.update({
    "font.family": "sans-serif", "font.size": 10, "axes.edgecolor": CINZA_CLARO, "axes.labelcolor": MUDO,
    "xtick.color": MUDO, "ytick.color": MUDO, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": "#e5e5ea", "grid.linewidth": 0.8, "axes.axisbelow": True,
    "figure.dpi": 110, "savefig.dpi": 150, "savefig.bbox": "tight",
})


def _ler(nome: str) -> dict:
    return json.loads((RAIZ / "reports" / nome).read_text(encoding="utf-8"))


def _no_limiar(tabela: list[dict], limiar: float) -> dict:
    return min(tabela, key=lambda t: abs(t["limiar"] - limiar))


def fig_classes(det: dict) -> None:
    atrib = det["classes_atribuidas"]["coco_yolov8n_640"]["teste"]
    fig, eixos = plt.subplots(1, 2, figsize=(10, 3.4))
    for ax, classe, titulo in zip(eixos, ["ave", "balao"], ["Aves de papel", "Balões"], strict=True):
        cont = atrib[classe]
        total = sum(cont.values())
        itens = sorted(cont.items(), key=lambda kv: -kv[1])[:7]
        rot = [k for k, _ in itens][::-1]
        val = [v / total for _, v in itens][::-1]
        cores = [AZUL if r in ("bird", "kite") else CINZA_CLARO for r in rot]
        ax.barh(rot, val, color=cores, height=0.65)
        for i, v in enumerate(val):
            ax.text(v + 0.01, i, f"{v:.0%}", va="center", color=TINTA, fontsize=9)
        ax.set_xlim(0, 1.08)
        ax.xaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1, decimals=0))
        ax.set_title(f"{titulo} (n = {total})", loc="left", color=TINTA, fontsize=11)
        ax.grid(axis="y", visible=False)
    fig.suptitle("Que classe o YOLOv8n COCO dá a cada objeto real (confiança ≥ 0,25, IoU ≥ 0,5)",
                 x=0.01, ha="left", color=TINTA, fontsize=12)
    fig.tight_layout()
    fig.savefig(FIG / "classes_coco.png")
    plt.close(fig)


def fig_pr(det: dict) -> None:
    fig, eixos = plt.subplots(1, 2, figsize=(10, 3.6), sharey=True)
    series = [
        ("revoada_yolov8n_416", "ave <- ave", "Treinado no jogo", AZUL, "-"),
        ("coco_yolov8n_640", "ave <- bird+kite", "COCO n, bird+kite", CINZA, "-"),
        ("coco_yolov8s_640", "ave <- bird+kite", "COCO s, bird+kite", CINZA, "--"),
        ("coco_yolov8n_640", "ave <- bird", "COCO n, só bird", CINZA_CLARO, "-"),
    ]
    for ax, campo, titulo in zip(eixos, ["precisao", "recall"], ["Precisão", "Recall"], strict=True):
        for nome, chave, rotulo, cor, estilo in series:
            tab = det["detectores"][nome]["teste"][chave]["por_limiar"]
            ax.plot([t["limiar"] for t in tab], [t[campo] for t in tab], estilo, color=cor, lw=2, marker="o", ms=4,
                    label=rotulo)
        ax.set_title(f"{titulo} da classe ave × limiar de confiança", loc="left", color=TINTA, fontsize=11)
        ax.set_xlabel("limiar de confiança")
        ax.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1, decimals=0))
        ax.set_ylim(0, 1.02)
    eixos[1].legend(frameon=False, loc="lower left")
    fig.tight_layout()
    fig.savefig(FIG / "precisao_recall_limiar.png")
    plt.close(fig)


def fig_politicas(exp: dict) -> None:
    dets = [("oraculo", "Caixas reais (teto)"), ("proprio", "Detector treinado no jogo"), ("coco", "Detector COCO (bird/kite)")]
    dets = [d for d in dets if any(linha["detector"] == d[0] for linha in exp["linhas"])]
    fig, eixos = plt.subplots(1, len(dets), figsize=(4 * len(dets), 3.6), sharey=True, squeeze=False)
    estilos = {"maiorConfianca": (CINZA, "-"), "maisPerto": (CINZA, "--"), "antecipacao": (AZUL, "-")}
    for ax, (det, titulo) in zip(eixos[0], dets, strict=True):
        for pol, rotulo in NOMES_POL.items():
            ls = [linha for linha in exp["linhas"] if linha["detector"] == det and linha["politica"] == pol]
            ls.sort(key=lambda linha: linha["latencia_ms"])
            x = [linha["latencia_ms"] for linha in ls]
            cor, estilo = estilos[pol]
            ax.fill_between(x, [linha["precisao_ic95"][0] for linha in ls], [linha["precisao_ic95"][1] for linha in ls],
                            color=cor, alpha=0.12, lw=0)
            ax.plot(x, [linha["precisao"] for linha in ls], estilo, color=cor, lw=2, marker="o", ms=4, label=rotulo)
        ax.set_title(titulo, loc="left", color=TINTA, fontsize=11)
        ax.set_xlabel("latência de percepção (ms)")
        ax.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1, decimals=0))
        ax.set_ylim(0, 1)
    eixos[0][0].set_ylabel("precisão (acertos ÷ tiros)")
    eixos[0][-1].legend(frameon=False)
    fig.suptitle("Precisão dos tiros × latência, por política (faixas: IC 95% por bootstrap nos episódios)",
                 x=0.01, ha="left", color=TINTA, fontsize=12)
    fig.tight_layout()
    fig.savefig(FIG / "politicas_latencia.png")
    plt.close(fig)


def fig_deslocamento(exp: dict) -> None:
    det = "proprio" if any(linha["detector"] == "proprio" for linha in exp["linhas"]) else "oraculo"
    ls = [linha for linha in exp["linhas"] if linha["detector"] == det]
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    for pol, (cor, estilo) in {"maiorConfianca": (CINZA, "-"), "antecipacao": (AZUL, "-")}.items():
        sel = sorted([linha for linha in ls if linha["politica"] == pol], key=lambda linha: linha["latencia_ms"])
        ax.plot([s["latencia_ms"] for s in sel], [s["erro_mira_px_mediana"] for s in sel], estilo, color=cor, lw=2,
                marker="o", ms=4, label=f"{NOMES_POL[pol]}: erro do clique")
    sel = sorted([linha for linha in ls if linha["politica"] == "maiorConfianca"], key=lambda linha: linha["latencia_ms"])
    ax.plot([s["latencia_ms"] for s in sel], [s["deslocamento_alvo_px_mediana"] for s in sel], ":", color=TINTA, lw=1.5,
            label="quanto a ave andou da captura ao tiro")
    ax.axhline(14, color=CINZA_CLARO, lw=1)
    ax.text(2, 15, "meia altura do corpo de uma ave média (≈14 px)", color=MUDO, fontsize=8)
    ax.set_xlabel("latência de percepção (ms)")
    ax.set_ylabel("pixels (mediana)")
    ax.set_title("Distância entre o clique e o centro da ave no instante do tiro", loc="left", color=TINTA, fontsize=11)
    ax.legend(frameon=False, fontsize=8)
    fig.tight_layout()
    fig.savefig(FIG / "erro_mira_latencia.png")
    plt.close(fig)


def fig_exemplos(det: dict) -> None:
    """Quadros de teste com as caixas reais e as detecções dos dois modelos."""
    reais = json.loads((RAIZ / "dados" / "revoada" / "rotulos_teste.json").read_text(encoding="utf-8"))
    preds = {n: json.loads((RAIZ / "dados" / "predicoes" / f"{n}_teste.json").read_text(encoding="utf-8"))
             for n in ("coco_yolov8n_640", "revoada_yolov8n_416")}
    limiar = det.get("limiar_escolhido", {})
    nomes = ["teste_200003", "teste_200011", "teste_200024"]
    fig, eixos = plt.subplots(len(nomes), 2, figsize=(10, 3.9 * len(nomes)))
    for i, nome in enumerate(nomes):
        img = plt.imread(RAIZ / "dados" / "revoada" / "images" / "teste" / f"{nome}.png")
        for j, (modelo, titulo, lim) in enumerate([
            ("coco_yolov8n_640", "COCO YOLOv8n", 0.25),
            ("revoada_yolov8n_416", "Treinado no jogo", limiar.get("proprio", 0.5)),
        ]):
            ax = eixos[i][j]
            ax.imshow(img)
            ax.axis("off")
            for c in reais[nome]["caixas"]:
                x1, y1, x2, y2 = c["caixa"]
                ax.add_patch(Rectangle((x1, y1), x2 - x1, y2 - y1, fill=False, ec="white", lw=1.2, ls="--"))
            for p in preds[modelo].get(nome, []):
                if p["score"] < lim:
                    continue
                x1, y1, x2, y2 = p["caixa"]
                alvo = p["classe"] in ("ave", "bird", "kite")
                cor = AZUL if alvo else "#636366"
                ax.add_patch(Rectangle((x1, y1), x2 - x1, y2 - y1, fill=False, ec=cor, lw=2))
                ax.text(x1, y1 - 3, f"{p['classe']} {p['score']:.2f}", color="white", fontsize=7,
                        bbox={"fc": cor, "ec": "none", "pad": 1.2})
            if i == 0:
                ax.set_title(f"{titulo} (limiar {lim:.2f})", color=TINTA, fontsize=11)
    fig.suptitle("Tracejado branco: caixa real do jogo. Azul: detecção tratada como alvo. Cinza: outra classe.",
                 x=0.01, ha="left", color=MUDO, fontsize=10)
    fig.tight_layout()
    fig.savefig(FIG / "exemplos_deteccoes.png")
    plt.close(fig)


def resumo_web(det: dict, exp: dict | None) -> None:
    lim = det["limiar_escolhido"]
    atrib = det["classes_atribuidas"]["coco_yolov8n_640"]["teste"]["ave"]
    total = sum(atrib.values())
    linhas_det = []
    for nome, chave, rotulo, destaque in [
        ("coco_yolov8n_640", "ave <- bird", "COCO YOLOv8n · bird", False),
        ("coco_yolov8n_640", "ave <- bird+kite", "COCO YOLOv8n · bird ou kite", False),
        ("coco_yolov8s_640", "ave <- bird+kite", "COCO YOLOv8s · bird ou kite", False),
        ("coco_yolov8n_640", "ave <- qualquer classe", "COCO YOLOv8n · qualquer classe", False),
        ("revoada_yolov8n_416", "ave <- ave", "Treinado no jogo · ave", True),
    ]:
        d = det["detectores"][nome]
        t = _no_limiar(d["teste"][chave]["por_limiar"], lim["proprio"] if destaque else 0.25)
        linhas_det.append({
            "rotulo": rotulo, "destaque": destaque, "ap50_teste": d["teste"][chave]["ap50"],
            "ap50_noite": d["teste_noite"][chave]["ap50"], "precisao": t["precisao"], "recall": t["recall"],
        })
    saida = {
        "limiares": lim,
        "classesCoco": {"n": det["conjuntos"]["teste"]["frames"],
                        "ave": [[k, v / total] for k, v in sorted(atrib.items(), key=lambda kv: -kv[1])[:6]]},
        "deteccao": linhas_det,
        # recorte usado pelo card da página inicial (yucavalcante.com)
        "vitrine": [
            {"classe": "não detectada" if k == "não detectado" else k, "n": v, "fracao": round(v / total, 4)}
            for k, v in sorted(atrib.items(), key=lambda kv: -kv[1])
            if k in ("não detectado", "kite", "airplane", "bird")
        ],
        "latencias": [],
        "politicas": {},
        "episodios": 0,
    }
    if exp:
        saida["latencias"] = sorted({linha["latencia_ms"] for linha in exp["linhas"]})
        saida["episodios"] = max(linha["episodios"] for linha in exp["linhas"])
        for linha in exp["linhas"]:
            saida["politicas"].setdefault(linha["detector"], {}).setdefault(linha["politica"], []).append(
                {k: linha[k] for k in ("latencia_ms", "precisao", "precisao_ic95", "abates_por_minuto", "baloes_por_minuto")})
        for pols in saida["politicas"].values():
            for v in pols.values():
                v.sort(key=lambda x: x["latencia_ms"])
    (RAIZ / "web" / "resultados.json").write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> None:
    FIG.mkdir(parents=True, exist_ok=True)
    det = _ler("metricas_deteccao.json")
    fig_classes(det)
    fig_pr(det)
    fig_exemplos(det)
    exp = None
    if (RAIZ / "reports" / "experimento_politicas.json").exists():
        exp = _ler("experimento_politicas.json")
        fig_politicas(exp)
        fig_deslocamento(exp)
    resumo_web(det, exp)
    print("figuras em", FIG)


if __name__ == "__main__":
    main()
