"""Métricas de detecção implementadas do zero (e testadas): IoU, casamento, AP@0,5, P/R por limiar.

Convenções:
    caixa = [x1, y1, x2, y2] em pixels
    predição = {"caixa": [...], "score": float, "classe": str}
    real (ground truth) = {"caixa": [...], "classe": str}
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

import numpy as np


def iou(a, b) -> np.ndarray:
    """Matriz IoU entre caixas a (N×4) e b (M×4)."""
    a = np.asarray(a, dtype=float).reshape(-1, 4)
    b = np.asarray(b, dtype=float).reshape(-1, 4)
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    uniao = area_a[:, None] + area_b[None, :] - inter
    return np.where(uniao > 0, inter / np.maximum(uniao, 1e-12), 0.0)


def casar(preds: list[dict], reais: list[dict], limiar_iou: float = 0.5) -> list[bool]:
    """Casamento guloso no estilo PASCAL VOC: em ordem decrescente de score, cada predição
    vira verdadeiro positivo se tiver IoU >= limiar com uma caixa real ainda livre."""
    ordem = sorted(range(len(preds)), key=lambda i: -preds[i]["score"])
    tp = [False] * len(preds)
    if not reais:
        return tp
    m = iou([preds[i]["caixa"] for i in ordem], [r["caixa"] for r in reais]) if preds else np.zeros((0, len(reais)))
    usada = np.zeros(len(reais), dtype=bool)
    for k, i in enumerate(ordem):
        candidatos = np.where(~usada, m[k], -1.0)
        j = int(np.argmax(candidatos))
        if candidatos[j] >= limiar_iou:
            usada[j] = True
            tp[i] = True
    return tp


def average_precision(scores: Iterable[float], tp: Iterable[bool], n_reais: int) -> float:
    """AP com interpolação em todos os pontos (VOC 2010+)."""
    scores = np.asarray(list(scores), dtype=float)
    tp = np.asarray(list(tp), dtype=bool)
    if n_reais == 0:
        return float("nan")
    if scores.size == 0:
        return 0.0
    ordem = np.argsort(-scores, kind="stable")
    tp = tp[ordem]
    tp_acum = np.cumsum(tp)
    fp_acum = np.cumsum(~tp)
    recall = tp_acum / n_reais
    precisao = tp_acum / np.maximum(tp_acum + fp_acum, 1e-12)
    mrec = np.concatenate([[0.0], recall, [1.0]])
    mpre = np.concatenate([[1.0], precisao, [0.0]])
    mpre = np.maximum.accumulate(mpre[::-1])[::-1]
    idx = np.where(mrec[1:] != mrec[:-1])[0]
    return float(np.sum((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]))


def _filtrar(itens: list[dict], classes: set[str] | None) -> list[dict]:
    return [x for x in itens if classes is None or x["classe"] in classes]


def avaliar(
    preds_por_imagem: dict[str, list[dict]],
    reais_por_imagem: dict[str, list[dict]],
    classes_pred: set[str] | None,
    classe_real: str,
    limiares: Iterable[float] = (0.1, 0.25, 0.5),
    limiar_iou: float = 0.5,
) -> dict:
    """Avalia a tarefa "achar `classe_real`" aceitando como predição positiva qualquer
    detecção cuja classe esteja em `classes_pred` (None = qualquer classe).

    Isso permite medir um detector COCO, que não conhece "ave de papel", perguntando:
    se eu tratar `bird` (ou `bird`+`kite`) como alvo, quanto ele acerta?
    """
    scores, tps = [], []
    n_reais = 0
    por_limiar = {t: Counter() for t in limiares}
    for nome, reais in reais_por_imagem.items():
        reais = _filtrar(reais, {classe_real})
        preds = _filtrar(preds_por_imagem.get(nome, []), classes_pred)
        n_reais += len(reais)
        tp = casar(preds, reais, limiar_iou)
        scores += [p["score"] for p in preds]
        tps += tp
        for t in limiares:
            sel = [p for p in preds if p["score"] >= t]
            tp_t = casar(sel, reais, limiar_iou)
            por_limiar[t]["tp"] += sum(tp_t)
            por_limiar[t]["fp"] += len(tp_t) - sum(tp_t)
    tabela = []
    for t in limiares:
        tp, fp = por_limiar[t]["tp"], por_limiar[t]["fp"]
        tabela.append({
            "limiar": t,
            "precisao": tp / (tp + fp) if tp + fp else float("nan"),
            "recall": tp / n_reais if n_reais else float("nan"),
            "tp": int(tp),
            "fp": int(fp),
            "fn": int(n_reais - tp),
        })
    return {"ap50": average_precision(scores, tps, n_reais), "n_reais": n_reais, "por_limiar": tabela}


def classes_atribuidas(
    preds_por_imagem: dict[str, list[dict]],
    reais_por_imagem: dict[str, list[dict]],
    limiar_conf: float = 0.25,
    limiar_iou: float = 0.5,
) -> dict[str, Counter]:
    """Para cada objeto real, qual classe o detector deu a ele: a classe da predição
    (score >= limiar_conf) com maior IoU, se IoU >= limiar_iou; senão "não detectado"."""
    resultado: dict[str, Counter] = {}
    for nome, reais in reais_por_imagem.items():
        preds = [p for p in preds_por_imagem.get(nome, []) if p["score"] >= limiar_conf]
        m = iou([r["caixa"] for r in reais], [p["caixa"] for p in preds]) if preds and reais else None
        for i, r in enumerate(reais):
            cont = resultado.setdefault(r["classe"], Counter())
            if m is None or m[i].max() < limiar_iou:
                cont["não detectado"] += 1
            else:
                cont[preds[int(np.argmax(m[i]))]["classe"]] += 1
    return resultado
