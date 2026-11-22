// Cliente do Web Worker de detecção (thread principal).

import { CLASSES_COCO } from './coco.js';

export const MODELOS = {
  proprio: {
    rotulo: 'Próprio (YOLOv8n treinado no jogo)',
    url: new URL('../../modelos/revoada_yolov8n.onnx', import.meta.url).href,
    nomes: ['ave', 'balao'],
    classesAlvo: ['ave'],
    lado: 416,
  },
  coco: {
    rotulo: 'COCO pré-treinado (YOLOv8n)',
    url: new URL('../../modelos/coco_yolov8n.onnx', import.meta.url).href,
    nomes: CLASSES_COCO,
    classesAlvo: ['bird', 'kite'],
    lado: 416,
  },
};

export function criarDetector() {
  const worker = new Worker(new URL('../detector.worker.js', import.meta.url), { type: 'module' });
  let proximo = 1;
  const pendentes = new Map();
  worker.onmessage = ({ data }) => {
    const p = pendentes.get(data.id);
    if (!p) return;
    pendentes.delete(data.id);
    if (data.tipo === 'erro') p.rejeitar(new Error(data.mensagem));
    else p.resolver(data);
  };
  // erro ao carregar o próprio Worker (ex.: CDN fora do ar): rejeita tudo que estiver pendente
  worker.onerror = (ev) => {
    ev.preventDefault();
    for (const p of pendentes.values()) p.rejeitar(new Error(ev.message || 'falha ao iniciar o Web Worker'));
    pendentes.clear();
  };
  const chamar = (msg, transferir = []) =>
    new Promise((resolver, rejeitar) => {
      const id = proximo++;
      pendentes.set(id, { resolver, rejeitar });
      worker.postMessage({ ...msg, id }, transferir);
    });

  return {
    async carregar(chave, provedores = ['webgpu', 'wasm']) {
      const m = MODELOS[chave];
      return chamar({ tipo: 'carregar', url: m.url, nomes: m.nomes, lado: m.lado, provedores });
    },
    /** fonte: canvas (ou qualquer coisa aceita por createImageBitmap). */
    async detectar(fonte, limiar) {
      const bitmap = await createImageBitmap(fonte);
      return chamar({ tipo: 'detectar', bitmap, limiar }, [bitmap]);
    },
    encerrar() {
      worker.terminate();
    },
  };
}
