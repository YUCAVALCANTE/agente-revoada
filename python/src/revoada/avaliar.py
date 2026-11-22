"""Avalia os detectores nos frames de teste do jogo.

Linha de base: YOLOv8 pré-treinado no COCO (n e s). Ele não conhece "ave de papel" nem
"balão de festa", então a pergunta é: se eu tratar certas classes COCO como alvo
(bird; bird + kite; qualquer coisa), quanto ele acerta? E que classe ele dá aos alvos?

Detector próprio: YOLOv8n ajustado nos frames sintéticos do jogo.

Saída: reports/metricas_deteccao.json (+ predições brutas em dados/predicoes/).
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from revoada.metricas import avaliar, classes_atribuidas

RAIZ = Path(__file__).resolve().parents[3]
DADOS = RAIZ / "dados"
PESOS = DADOS / "pesos"

DETECTORES = {
    # nome: (pesos, imgsz, tipo)
    "coco_yolov8n_640": ("yolov8n.pt", 640, "coco"),
    "coco_yolov8s_640": ("yolov8s.pt", 640, "coco"),
    "coco_yolov8n_416": ("yolov8n.pt", 416, "coco"),
    "revoada_yolov8n_416": ("revoada_yolov8n.pt", 416, "proprio"),
}

MAPEAMENTOS_COCO = {"bird": {"bird"}, "bird+kite": {"bird", "kite"}, "qualquer classe": None}
LIMIARES = (0.05, 0.1, 0.25, 0.4, 0.5, 0.7)


def carregar_reais(split: str) -> dict[str, list[dict]]:
    rotulos = json.loads((DADOS / "revoada" / f"rotulos_{split}.json").read_text(encoding="utf-8"))
    return {nome: r["caixas"] for nome, r in rotulos.items()}


def prever(nome_det: str, split: str) -> dict[str, list[dict]]:
    cache = DADOS / "predicoes" / f"{nome_det}_{split}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    from ultralytics import YOLO

    pesos, imgsz, _ = DETECTORES[nome_det]
    modelo = YOLO(str(PESOS / pesos))
    nomes = modelo.names
    saida: dict[str, list[dict]] = {}
    pasta = DADOS / "revoada" / "images" / split
    for r in modelo.predict(source=str(pasta), imgsz=imgsz, conf=0.01, iou=0.6, max_det=100,
                            device="cpu", stream=True, verbose=False):
        caixas = r.boxes
        saida[Path(r.path).stem] = [
            {"caixa": [round(float(v), 2) for v in b], "score": round(float(s), 4), "classe": nomes[int(c)]}
            for b, s, c in zip(caixas.xyxy.tolist(), caixas.conf.tolist(), caixas.cls.tolist(), strict=True)
        ]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(saida))
    return saida


def latencia_onnx(caminho: Path, imgsz: int, repeticoes: int = 50) -> dict:
    """Tempo de inferência do ONNX no onnxruntime (CPU, 1 e todas as threads)."""
    import onnxruntime as ort

    x = np.random.default_rng(0).random((1, 3, imgsz, imgsz), dtype=np.float32)
    res = {}
    for threads in (1, 0):
        op = ort.SessionOptions()
        op.intra_op_num_threads = threads
        sess = ort.InferenceSession(str(caminho), op, providers=["CPUExecutionProvider"])
        nome = sess.get_inputs()[0].name
        for _ in range(5):
            sess.run(None, {nome: x})
        tempos = []
        for _ in range(repeticoes):
            t0 = time.perf_counter()
            sess.run(None, {nome: x})
            tempos.append((time.perf_counter() - t0) * 1000)
        res["1 thread" if threads == 1 else "todas as threads"] = {
            "mediana_ms": round(float(np.median(tempos)), 1),
            "p90_ms": round(float(np.percentile(tempos, 90)), 1),
        }
    return res


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--splits", nargs="+", default=["teste", "teste_noite"])
    args = ap.parse_args()

    resultado: dict = {"detectores": {}, "classes_atribuidas": {}, "latencia_cpu": {}}
    for split in args.splits:
        reais = carregar_reais(split)
        n_ave = sum(c["classe"] == "ave" for cs in reais.values() for c in cs)
        n_balao = sum(c["classe"] == "balao" for cs in reais.values() for c in cs)
        resultado.setdefault("conjuntos", {})[split] = {"frames": len(reais), "aves": n_ave, "baloes": n_balao}
        for nome_det, (_, _, tipo) in DETECTORES.items():
            preds = prever(nome_det, split)
            linhas = resultado["detectores"].setdefault(nome_det, {}).setdefault(split, {})
            if tipo == "coco":
                for rotulo, classes in MAPEAMENTOS_COCO.items():
                    linhas[f"ave <- {rotulo}"] = avaliar(preds, reais, classes, "ave", LIMIARES)
                    linhas[f"balao <- {rotulo}"] = avaliar(preds, reais, classes, "balao", LIMIARES)
            else:
                linhas["ave <- ave"] = avaliar(preds, reais, {"ave"}, "ave", LIMIARES)
                linhas["balao <- balao"] = avaliar(preds, reais, {"balao"}, "balao", LIMIARES)
            atrib = classes_atribuidas(preds, reais, limiar_conf=0.25)
            resultado["classes_atribuidas"].setdefault(nome_det, {})[split] = {
                k: dict(v.most_common()) for k, v in atrib.items()
            }
            print(split, nome_det, {k: round(v["ap50"], 3) for k, v in linhas.items()})

    # limiar de confiança para o agente: o de maior F1 na VALIDAÇÃO (nunca no teste)
    reais_val = carregar_reais("validacao")
    grade = tuple(round(x, 2) for x in np.arange(0.05, 0.96, 0.05))
    escolhas = {"proprio": ("revoada_yolov8n_416", {"ave"}), "coco": ("coco_yolov8n_416", {"bird", "kite"})}
    resultado["limiar_escolhido"] = {}
    for chave_det, (nome_det, classes) in escolhas.items():
        tabela = avaliar(prever(nome_det, "validacao"), reais_val, classes, "ave", grade)["por_limiar"]
        f1 = [2 * t["tp"] / max(2 * t["tp"] + t["fp"] + t["fn"], 1) for t in tabela]
        resultado["limiar_escolhido"][chave_det] = tabela[int(np.argmax(f1))]["limiar"]
    print("limiares escolhidos na validação:", resultado["limiar_escolhido"])

    for arquivo, imgsz in (("revoada_yolov8n.onnx", 416), ("coco_yolov8n.onnx", 416)):
        caminho = RAIZ / "web" / "modelos" / arquivo
        if caminho.exists():
            resultado["latencia_cpu"][arquivo] = latencia_onnx(caminho, imgsz)

    destino = RAIZ / "reports" / "metricas_deteccao.json"
    destino.parent.mkdir(exist_ok=True)
    destino.write_text(json.dumps(resultado, ensure_ascii=False, indent=1), encoding="utf-8")
    print("salvo em", destino)


if __name__ == "__main__":
    main()
