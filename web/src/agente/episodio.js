// Episódio do agente em relógio virtual: o mundo só anda quando o agente "gasta" tempo.
// Isso torna o experimento determinístico e independente da velocidade da máquina:
// a latência é um parâmetro controlado, não um acidente do hardware.

import { criarMundo, atualizar, disparar, caixasReais } from '../jogo/mundo.js';
import { criarRastreador } from './rastreador.js';
import { escolherAlvo } from './politicas.js';
import { iou } from './yolo.js';

export const PADRAO = {
  duracao: 60, // segundos de jogo
  vMira: 4000, // px/s: velocidade da mira (mouse movido por software)
  recarga: 0.25, // s entre tiros
  periodoQuadro: 1 / 15, // intervalo mínimo entre capturas (no máximo 15 quadros/s)
  limiar: 0.5,
  maxAves: 3,
  maxBaloes: 2,
};

/** Detector "oráculo": devolve as caixas reais. Serve de teto e para testar as políticas. */
export function detectorOraculo() {
  return (mundo) => caixasReais(mundo).map((c) => ({ caixa: c.caixa, score: 1, classe: c.classe }));
}

const centro = (c) => [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2];

/**
 * @param {object} op
 * @param {(mundo) => Promise<object[]>|object[]} op.detectar recebe o mundo (para desenhar o quadro) e devolve detecções
 * @param {string} op.politica
 * @param {number} op.latencia atraso de percepção em segundos (captura -> decisão)
 */
export async function rodarEpisodio(op) {
  const o = { ...PADRAO, ...op };
  const mundo = criarMundo({ semente: o.semente, cena: o.cena || 'dia', maxAves: o.maxAves, maxBaloes: o.maxBaloes });
  const rastreador = criarRastreador();
  const mira = { x: 320, y: 240 };
  let prontoEm = 0;
  const registro = [];
  let quadros = 0;

  while (mundo.t < o.duracao) {
    const tObs = mundo.t;
    const reaisNaCaptura = caixasReais(mundo);
    const deteccoes = await o.detectar(mundo);
    quadros++;
    atualizar(mundo, o.latencia);
    rastreador.atualizar(deteccoes, tObs);

    let atirou = false;
    if (mundo.t >= prontoEm) {
      const escolha = escolherAlvo(o.politica, {
        deteccoes,
        mira,
        atrasoPercepcao: mundo.t - tObs,
        vMira: o.vMira,
        classesAlvo: o.classesAlvo,
        limiar: o.limiar,
      });
      if (escolha) {
        const [px, py] = escolha.ponto;
        atualizar(mundo, Math.hypot(px - mira.x, py - mira.y) / o.vMira);
        mira.x = px;
        mira.y = py;
        // qual objeto real o agente estava mirando (maior IoU no quadro capturado)?
        let real = null;
        let melhor = 0.3;
        for (const r of reaisNaCaptura) {
          const v = iou(r.caixa, escolha.deteccao.caixa);
          if (v > melhor) { melhor = v; real = r; }
        }
        const agora = real ? caixasReais(mundo).find((r) => r.id === real.id) : null;
        const atraso = mundo.t - tObs;
        const r = disparar(mundo, px, py);
        registro.push({
          t: +mundo.t.toFixed(3),
          atraso: +atraso.toFixed(3),
          resultado: r.resultado,
          classeMirada: real ? real.classe : 'nada',
          // distância entre o clique e o centro do alvo no instante do tiro
          erroPx: agora ? +Math.hypot(px - centro(agora.caixa)[0], py - centro(agora.caixa)[1]).toFixed(1) : null,
          // quanto o alvo andou entre a captura e o tiro
          deslocamentoPx: agora
            ? +Math.hypot(centro(agora.caixa)[0] - centro(real.caixa)[0], centro(agora.caixa)[1] - centro(real.caixa)[1]).toFixed(1)
            : null,
        });
        prontoEm = mundo.t + o.recarga;
        atirou = true;
      }
    }
    if (!atirou) atualizar(mundo, Math.max(0, o.periodoQuadro - o.latencia));
  }
  const p = mundo.placar;
  return {
    semente: o.semente,
    politica: o.politica,
    latencia: o.latencia,
    quadros,
    ...p,
    precisao: p.tiros ? p.acertos / p.tiros : 0,
    abatesPorMinuto: (p.acertos / o.duracao) * 60,
    registro,
  };
}
