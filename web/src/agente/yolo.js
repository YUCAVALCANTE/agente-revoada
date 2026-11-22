// Pré e pós-processamento do YOLOv8 exportado para ONNX (sem dependências, testável no Node).
// Saída do modelo: [1, 4 + nClasses, N] com (cx, cy, w, h) no espaço da entrada quadrada.

/** Parâmetros do letterbox: redimensiona mantendo proporção e centraliza com borda cinza. */
export function letterbox(largura, altura, lado) {
  const r = Math.min(lado / largura, lado / altura);
  const nl = Math.round(largura * r);
  const na = Math.round(altura * r);
  return { r, nl, na, padX: (lado - nl) / 2, padY: (lado - na) / 2, lado };
}

/** RGBA (Uint8ClampedArray lado×lado) -> tensor CHW float32 normalizado em [0, 1]. */
export function rgbaParaChw(rgba, lado) {
  const n = lado * lado;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[i] = rgba[i * 4] / 255;
    out[n + i] = rgba[i * 4 + 1] / 255;
    out[2 * n + i] = rgba[i * 4 + 2] / 255;
  }
  return out;
}

export function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return u > 0 ? inter / u : 0;
}

/** Supressão de não máximos por classe. */
export function nms(dets, limiarIou = 0.5) {
  const ordenadas = [...dets].sort((a, b) => b.score - a.score);
  const mantidas = [];
  for (const d of ordenadas) {
    if (mantidas.every((m) => m.idClasse !== d.idClasse || iou(m.caixa, d.caixa) < limiarIou)) mantidas.push(d);
  }
  return mantidas;
}

/**
 * Converte a saída bruta em detecções no espaço da imagem original.
 * @param {Float32Array} dados saída achatada [1, 4+nc, N]
 * @param {number[]} dims [1, 4+nc, N]
 * @param {{limiar:number, iouNms?:number, nomes:string[], lb:object, largura:number, altura:number, maxDet?:number}} op
 */
export function posprocessar(dados, dims, { limiar, iouNms = 0.5, nomes, lb, largura, altura, maxDet = 50 }) {
  const nc = dims[1] - 4;
  const n = dims[2];
  const dets = [];
  for (let i = 0; i < n; i++) {
    let melhor = -1;
    let score = 0;
    for (let c = 0; c < nc; c++) {
      const s = dados[(4 + c) * n + i];
      if (s > score) { score = s; melhor = c; }
    }
    if (score < limiar) continue;
    const cx = dados[i];
    const cy = dados[n + i];
    const w = dados[2 * n + i];
    const h = dados[3 * n + i];
    const x1 = Math.max(0, (cx - w / 2 - lb.padX) / lb.r);
    const y1 = Math.max(0, (cy - h / 2 - lb.padY) / lb.r);
    const x2 = Math.min(largura, (cx + w / 2 - lb.padX) / lb.r);
    const y2 = Math.min(altura, (cy + h / 2 - lb.padY) / lb.r);
    if (x2 <= x1 || y2 <= y1) continue;
    dets.push({ caixa: [x1, y1, x2, y2], score, idClasse: melhor, classe: nomes[melhor] ?? String(melhor) });
  }
  return nms(dets, iouNms).slice(0, maxDet);
}
