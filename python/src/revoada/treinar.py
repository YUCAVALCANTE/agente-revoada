"""Treina o detector próprio (YOLOv8n a partir dos pesos COCO) nos frames sintéticos do jogo
e exporta para ONNX. Também exporta o YOLOv8n COCO original, usado como linha de base no navegador."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
PESOS = RAIZ / "dados" / "pesos"
MODELOS_WEB = RAIZ / "web" / "modelos"


def treinar(epocas: int, imgsz: int, lote: int, dispositivo: str, workers: int = 2) -> Path:
    from ultralytics import YOLO

    PESOS.mkdir(parents=True, exist_ok=True)
    modelo = YOLO(str(PESOS / "yolov8n.pt"))
    modelo.train(
        data=str(RAIZ / "dados" / "revoada" / "revoada.yaml"),
        imgsz=imgsz,
        epochs=epocas,
        batch=lote,
        device=dispositivo,
        workers=workers,
        seed=0,
        deterministic=True,
        project=str(RAIZ / "dados" / "treinos"),
        name="revoada",
        exist_ok=True,
        plots=True,
        verbose=False,
    )
    melhor = RAIZ / "dados" / "treinos" / "revoada" / "weights" / "best.pt"
    shutil.copy(melhor, PESOS / "revoada_yolov8n.pt")
    return PESOS / "revoada_yolov8n.pt"


def exportar(pesos: Path, destino: Path, imgsz: int) -> None:
    from ultralytics import YOLO

    caminho = Path(YOLO(str(pesos)).export(format="onnx", imgsz=imgsz, simplify=True, dynamic=False))
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(caminho, destino)
    print("exportado:", destino, f"{destino.stat().st_size / 1e6:.1f} MB")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--epocas", type=int, default=30)
    ap.add_argument("--imgsz", type=int, default=416)
    ap.add_argument("--lote", type=int, default=16)
    ap.add_argument("--dispositivo", default="cpu", help='"cpu" ou índice da GPU, ex.: "0"')
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--so-exportar", action="store_true")
    args = ap.parse_args()
    pesos = PESOS / "revoada_yolov8n.pt" if args.so_exportar else treinar(
        args.epocas, args.imgsz, args.lote, args.dispositivo, args.workers
    )
    exportar(pesos, MODELOS_WEB / "revoada_yolov8n.onnx", args.imgsz)
    exportar(PESOS / "yolov8n.pt", MODELOS_WEB / "coco_yolov8n.onnx", args.imgsz)


if __name__ == "__main__":
    main()
