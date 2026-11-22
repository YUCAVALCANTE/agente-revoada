// Rastreador simples por proximidade: associa detecções entre quadros e estima a velocidade
// de cada alvo. É o que permite "mirar à frente" para compensar a latência.

const centro = (c) => [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2];

export function criarRastreador({ suavizacao = 0.6, esquecerApos = 0.7, portaoMin = 45 } = {}) {
  let trilhas = [];
  let proximoId = 1;

  function prever(tr, t) {
    const dt = t - tr.t;
    return [tr.cx + tr.vx * dt, tr.cy + tr.vy * dt];
  }

  /**
   * Associa as detecções do quadro capturado no instante `t` às trilhas existentes
   * (guloso, pela menor distância à posição prevista) e atualiza as velocidades.
   * Escreve `det.trilha` em cada detecção.
   */
  function atualizar(deteccoes, t) {
    trilhas = trilhas.filter((tr) => t - tr.t <= esquecerApos);
    const pares = [];
    deteccoes.forEach((d, i) => {
      const [x, y] = centro(d.caixa);
      const tam = Math.max(d.caixa[2] - d.caixa[0], d.caixa[3] - d.caixa[1]);
      trilhas.forEach((tr, j) => {
        if (tr.classe !== d.classe) return;
        const [px, py] = prever(tr, t);
        const dist = Math.hypot(px - x, py - y);
        const portao = Math.max(portaoMin, 1.2 * tam + 0.25 * Math.hypot(tr.vx, tr.vy) * (t - tr.t));
        if (dist <= portao) pares.push([dist, i, j]);
      });
    });
    pares.sort((a, b) => a[0] - b[0]);
    const detUsada = new Set();
    const trUsada = new Set();
    for (const [, i, j] of pares) {
      if (detUsada.has(i) || trUsada.has(j)) continue;
      detUsada.add(i);
      trUsada.add(j);
      const tr = trilhas[j];
      const d = deteccoes[i];
      const [x, y] = centro(d.caixa);
      const dt = t - tr.t;
      if (dt > 1e-6) {
        const nvx = (x - tr.cx) / dt;
        const nvy = (y - tr.cy) / dt;
        const a = tr.observacoes >= 2 ? suavizacao : 1;
        tr.vx = a * nvx + (1 - a) * tr.vx;
        tr.vy = a * nvy + (1 - a) * tr.vy;
      }
      Object.assign(tr, { cx: x, cy: y, t, observacoes: tr.observacoes + 1 });
      d.trilha = tr;
    }
    deteccoes.forEach((d, i) => {
      if (detUsada.has(i)) return;
      const [x, y] = centro(d.caixa);
      const tr = { id: proximoId++, classe: d.classe, cx: x, cy: y, vx: 0, vy: 0, t, observacoes: 1 };
      trilhas.push(tr);
      d.trilha = tr;
    });
  }

  return { atualizar, prever, trilhas: () => trilhas };
}
