import math

import numpy as np
import pytest
from revoada.dataset import linha_yolo, para_yolo
from revoada.metricas import avaliar, average_precision, casar, classes_atribuidas, iou


def P(caixa, score, classe="ave"):
    return {"caixa": caixa, "score": score, "classe": classe}


def R(caixa, classe="ave"):
    return {"caixa": caixa, "classe": classe}


def test_iou_casos_basicos():
    m = iou([[0, 0, 10, 10]], [[0, 0, 10, 10], [5, 0, 15, 10], [20, 20, 30, 30]])
    assert m.shape == (1, 3)
    assert m[0, 0] == pytest.approx(1.0)
    assert m[0, 1] == pytest.approx(50 / 150)
    assert m[0, 2] == 0.0


def test_iou_caixa_degenerada_nao_divide_por_zero():
    assert iou([[0, 0, 0, 0]], [[0, 0, 0, 0]])[0, 0] == 0.0


def test_casar_usa_cada_real_uma_vez_e_prioriza_score():
    reais = [R([0, 0, 10, 10])]
    preds = [P([0, 0, 10, 10], 0.6), P([0, 0, 10, 10], 0.9)]
    assert casar(preds, reais) == [False, True]


def test_casar_respeita_limiar_de_iou():
    reais = [R([0, 0, 10, 10])]
    assert casar([P([5, 0, 15, 10], 0.9)], reais, 0.5) == [False]
    assert casar([P([5, 0, 15, 10], 0.9)], reais, 0.3) == [True]


def test_ap_perfeito_e_vazio():
    assert average_precision([0.9, 0.8], [True, True], 2) == pytest.approx(1.0)
    assert average_precision([], [], 3) == 0.0
    assert math.isnan(average_precision([], [], 0))


def test_ap_exemplo_conhecido():
    # ranking: TP, FP, TP com 2 reais -> precisão interpolada 1,0 até recall 0,5 e 2/3 até 1,0
    ap = average_precision([0.9, 0.8, 0.7], [True, False, True], 2)
    assert ap == pytest.approx(0.5 * 1.0 + 0.5 * 2 / 3)


def test_ap_metade_do_recall():
    assert average_precision([0.9], [True], 2) == pytest.approx(0.5)


def test_avaliar_filtra_classes_do_detector():
    reais = {"a": [R([0, 0, 10, 10]), R([50, 50, 60, 60], "balao")]}
    preds = {"a": [P([0, 0, 10, 10], 0.9, "kite"), P([50, 50, 60, 60], 0.8, "sports ball")]}
    so_bird = avaliar(preds, reais, {"bird"}, "ave")
    assert so_bird["ap50"] == 0.0
    bird_kite = avaliar(preds, reais, {"bird", "kite"}, "ave")
    assert bird_kite["ap50"] == pytest.approx(1.0)
    qualquer = avaliar(preds, reais, None, "ave")
    linha = qualquer["por_limiar"][0]
    assert (linha["tp"], linha["fp"], linha["fn"]) == (1, 1, 0)


def test_avaliar_limiar_reduz_recall():
    reais = {"a": [R([0, 0, 10, 10]), R([20, 0, 30, 10])]}
    preds = {"a": [P([0, 0, 10, 10], 0.9), P([20, 0, 30, 10], 0.2)]}
    r = avaliar(preds, reais, {"ave"}, "ave", limiares=(0.1, 0.5))
    assert [x["recall"] for x in r["por_limiar"]] == [1.0, 0.5]


def test_classes_atribuidas():
    reais = {"a": [R([0, 0, 10, 10]), R([50, 50, 60, 60]), R([80, 80, 90, 90], "balao")]}
    preds = {"a": [P([0, 0, 10, 10], 0.9, "kite"), P([50, 50, 60, 60], 0.1, "bird")]}
    c = classes_atribuidas(preds, reais, limiar_conf=0.25)
    assert c["ave"]["kite"] == 1
    assert c["ave"]["não detectado"] == 1
    assert c["balao"]["não detectado"] == 1


def test_conversao_yolo():
    assert para_yolo([0, 0, 640, 480], 640, 480) == (0.5, 0.5, 1.0, 1.0)
    assert linha_yolo("balao", [64, 48, 128, 96], 640, 480).startswith("1 0.150000 0.150000 0.100000 0.100000")
    np.testing.assert_allclose(para_yolo([10, 20, 30, 60], 100, 100), (0.2, 0.4, 0.2, 0.4))
