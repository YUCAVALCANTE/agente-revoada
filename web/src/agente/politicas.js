// Políticas de decisão: dado o que o detector viu, onde clicar?

import { LARGURA, ALTURA } from '../jogo/mundo.js';

export const POLITICAS = {
  maiorConfianca: 'Maior confiança',
  maisPerto: 'Mais perto da mira',
  antecipacao: 'Mira com antecipação',
};

const centro = (c) => [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2];
const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

export function candidatos(deteccoes, { classesAlvo, limiar }) {
  return deteccoes.filter((d) => d.score >= limiar && (!classesAlvo || classesAlvo.includes(d.classe)));
}

/**
 * Ponto de interceptação: onde o alvo estará quando o tiro sair.
 * O tiro sai depois de `atrasoPercepcao` (captura -> decisão) mais o tempo de levar a mira
 * até lá (distância / vMira). Como o segundo termo depende do ponto, itera algumas vezes.
 */
export function interceptar(c, v, mira, atrasoPercepcao, vMira, iteracoes = 4) {
  let p = c;
  let tau = atrasoPercepcao;
  for (let k = 0; k < iteracoes; k++) {
    tau = atrasoPercepcao + Math.hypot(p[0] - mira.x, p[1] - mira.y) / vMira;
    p = [c[0] + v[0] * tau, c[1] + v[1] * tau];
  }
  return { ponto: [limitar(p[0], 0, LARGURA), limitar(p[1], 0, ALTURA)], tau };
}

/**
 * Escolhe o alvo e o ponto do clique.
 * @param {keyof POLITICAS} politica
 * @param {{deteccoes:object[], mira:{x:number,y:number}, atrasoPercepcao:number, vMira:number,
 *          classesAlvo?:string[], limiar:number}} ctx
 * @returns {{ponto:[number,number], deteccao:object, tau:number} | null}
 */
export function escolherAlvo(politica, ctx) {
  const lista = candidatos(ctx.deteccoes, ctx);
  if (!lista.length) return null;
  const dist = (d) => {
    const [x, y] = centro(d.caixa);
    return Math.hypot(x - ctx.mira.x, y - ctx.mira.y);
  };
  if (politica === 'maiorConfianca') {
    const d = lista.reduce((a, b) => (b.score > a.score ? b : a));
    return { ponto: centro(d.caixa), deteccao: d, tau: ctx.atrasoPercepcao + dist(d) / ctx.vMira };
  }
  if (politica === 'maisPerto') {
    const d = lista.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    return { ponto: centro(d.caixa), deteccao: d, tau: ctx.atrasoPercepcao + dist(d) / ctx.vMira };
  }
  if (politica === 'antecipacao') {
    let melhor = null;
    for (const d of lista) {
      const v = d.trilha && d.trilha.observacoes >= 2 ? [d.trilha.vx, d.trilha.vy] : [0, 0];
      const r = interceptar(centro(d.caixa), v, ctx.mira, ctx.atrasoPercepcao, ctx.vMira);
      // prefere alvos já rastreados (velocidade conhecida) e, entre eles, o de interceptação mais rápida
      const custo = r.tau + (d.trilha && d.trilha.observacoes >= 2 ? 0 : 0.25);
      if (!melhor || custo < melhor.custo) melhor = { ...r, deteccao: d, custo };
    }
    return { ponto: melhor.ponto, deteccao: melhor.deteccao, tau: melhor.tau };
  }
  throw new Error(`política desconhecida: ${politica}`);
}
