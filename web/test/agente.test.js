import { test } from 'node:test';
import assert from 'node:assert/strict';

import { criarRng } from '../src/jogo/rng.js';
import { caixaDe, acertou, formasDe } from '../src/jogo/formas.js';
import { criarMundo, atualizar, disparar, caixasReais, novaAve, novoBalao, cenaAleatoria, LARGURA } from '../src/jogo/mundo.js';
import { letterbox, posprocessar, nms, rgbaParaChw } from '../src/agente/yolo.js';
import { criarRastreador } from '../src/agente/rastreador.js';
import { escolherAlvo, interceptar, candidatos } from '../src/agente/politicas.js';
import { rodarEpisodio, detectorOraculo } from '../src/agente/episodio.js';

const det = (caixa, score = 0.9, classe = 'ave') => ({ caixa, score, classe });

test('rng é determinístico pela semente', () => {
  const a = criarRng(42);
  const b = criarRng(42);
  const c = criarRng(43);
  const sa = Array.from({ length: 5 }, a);
  assert.deepEqual(sa, Array.from({ length: 5 }, b));
  assert.notDeepEqual(sa, Array.from({ length: 5 }, c));
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});

test('caixa real contém todos os pontos do desenho e o centro do corpo é acerto', () => {
  const mundo = criarMundo({ semente: 1, maxAves: 0, maxBaloes: 0 });
  const ave = novaAve(mundo, { x: 300, y: 200, vx: 100, vy: 0, rumo: 0 });
  const [x1, y1, x2, y2] = caixaDe(ave);
  for (const p of formasDe(ave).filter((f) => f.caixa)) {
    for (const [x, y] of p.pontos) assert.ok(x >= x1 - 1e-9 && x <= x2 + 1e-9 && y >= y1 - 1e-9 && y <= y2 + 1e-9);
  }
  assert.ok(acertou(ave, 300, 200));
  assert.ok(!acertou(ave, 300, 200 + 80));
});

test('mundo com a mesma semente evolui igual', () => {
  const a = criarMundo({ semente: 7 });
  const b = criarMundo({ semente: 7 });
  atualizar(a, 5);
  atualizar(b, 5);
  assert.deepEqual(caixasReais(a), caixasReais(b));
  assert.ok(caixasReais(a).length > 0);
});

test('caixas reais ficam dentro da tela', () => {
  for (let s = 1; s <= 50; s++) {
    for (const c of caixasReais(cenaAleatoria(s))) {
      const [x1, y1, x2, y2] = c.caixa;
      assert.ok(x1 >= 0 && y1 >= 0 && x2 <= LARGURA && y2 <= 480 && x2 > x1 && y2 > y1);
    }
  }
});

test('disparo em ave pontua, em balão penaliza, no vazio erra', () => {
  const mundo = criarMundo({ semente: 1, maxAves: 0, maxBaloes: 0 });
  novaAve(mundo, { x: 100, y: 100, vx: 100, vy: 0, rumo: 0 });
  novoBalao(mundo, { x0: 400, x: 400, y: 200 });
  assert.equal(disparar(mundo, 100, 100).resultado, 'ave');
  assert.equal(disparar(mundo, 400, 200).resultado, 'balao');
  assert.equal(disparar(mundo, 600, 50).resultado, 'erro');
  assert.deepEqual(
    { tiros: mundo.placar.tiros, acertos: mundo.placar.acertos, baloes: mundo.placar.baloes, erros: mundo.placar.erros },
    { tiros: 3, acertos: 1, baloes: 1, erros: 1 },
  );
});

test('letterbox de 640x480 para 416', () => {
  const lb = letterbox(640, 480, 416);
  assert.equal(lb.nl, 416);
  assert.equal(lb.na, 312);
  assert.equal(lb.padY, 52);
  assert.equal(lb.padX, 0);
});

test('rgbaParaChw separa canais', () => {
  const t = rgbaParaChw(new Uint8ClampedArray([255, 0, 51, 255, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]), 2);
  assert.deepEqual(Array.from(t.slice(0, 4)), [1, 0, 0, 0]);
  assert.deepEqual(Array.from(t.slice(4, 8)), [0, 1, 0, 0]);
  assert.ok(Math.abs(t[8] - 0.2) < 1e-6);
});

test('posprocessar desfaz o letterbox e aplica limiar', () => {
  const lb = letterbox(640, 480, 416);
  const n = 2;
  const nc = 2;
  const dados = new Float32Array((4 + nc) * n);
  // âncora 0: caixa de 0..65 em x e 52..117 em y no espaço 416 -> 0..100 x 0..100 na imagem
  const set = (lin, i, v) => { dados[lin * n + i] = v; };
  set(0, 0, 32.5); set(1, 0, 84.5); set(2, 0, 65); set(3, 0, 65); set(4, 0, 0.9); set(5, 0, 0.1);
  set(0, 1, 200); set(1, 1, 200); set(2, 1, 20); set(3, 1, 20); set(4, 1, 0.1); set(5, 1, 0.2);
  const dets = posprocessar(dados, [1, 4 + nc, n], { limiar: 0.25, nomes: ['ave', 'balao'], lb, largura: 640, altura: 480 });
  assert.equal(dets.length, 1);
  assert.equal(dets[0].classe, 'ave');
  dets[0].caixa.forEach((v, i) => assert.ok(Math.abs(v - [0, 0, 100, 100][i]) < 1e-6));
});

test('NMS remove sobreposição da mesma classe e mantém classes diferentes', () => {
  const a = { ...det([0, 0, 10, 10], 0.9), idClasse: 0 };
  const b = { ...det([1, 1, 11, 11], 0.8), idClasse: 0 };
  const c = { ...det([1, 1, 11, 11], 0.7, 'balao'), idClasse: 1 };
  assert.deepEqual(nms([b, a, c], 0.5), [a, c]);
});

test('rastreador estima a velocidade de um alvo em movimento uniforme', () => {
  const r = criarRastreador();
  let d;
  for (let k = 0; k <= 5; k++) {
    const t = k * 0.1;
    const x = 100 + 200 * t;
    d = det([x - 20, 100, x + 20, 140]);
    r.atualizar([d], t);
  }
  assert.ok(Math.abs(d.trilha.vx - 200) < 1e-6);
  assert.ok(Math.abs(d.trilha.vy) < 1e-6);
  assert.equal(r.trilhas().length, 1);
});

test('políticas: maior confiança, mais perto, limiar e classes', () => {
  const longe = det([500, 400, 540, 440], 0.95);
  const perto = det([300, 220, 340, 260], 0.6);
  const balao = det([310, 230, 330, 250], 0.99, 'balao');
  const ctx = { deteccoes: [longe, perto, balao], mira: { x: 320, y: 240 }, atrasoPercepcao: 0, vMira: 4000, classesAlvo: ['ave'], limiar: 0.5 };
  assert.equal(escolherAlvo('maiorConfianca', ctx).deteccao, longe);
  assert.equal(escolherAlvo('maisPerto', ctx).deteccao, perto);
  assert.equal(escolherAlvo('maiorConfianca', { ...ctx, limiar: 0.97 }), null);
  assert.equal(candidatos(ctx.deteccoes, { classesAlvo: null, limiar: 0 }).length, 3);
});

test('interceptar mira à frente na direção do movimento', () => {
  const { ponto, tau } = interceptar([100, 100], [200, 0], { x: 100, y: 100 }, 0.1, Infinity);
  assert.ok(Math.abs(tau - 0.1) < 1e-6);
  assert.ok(Math.abs(ponto[0] - 120) < 1e-6 && ponto[1] === 100);
});

test('antecipação usa a trilha; sem trilha, mira no centro', () => {
  const r = criarRastreador();
  const a = det([80, 80, 120, 120]);
  r.atualizar([a], 0);
  const b = det([100, 80, 140, 120]);
  r.atualizar([b], 0.1); // vx = 200 px/s
  const ctx = { deteccoes: [b], mira: { x: 120, y: 100 }, atrasoPercepcao: 0.2, vMira: Infinity, limiar: 0.5 };
  const e = escolherAlvo('antecipacao', ctx);
  assert.ok(Math.abs(e.ponto[0] - 160) < 1e-6);
});

test('com latência, antecipar acerta mais que mirar no centro (detector oráculo)', async () => {
  const base = { detectar: detectorOraculo(), latencia: 0.2, classesAlvo: ['ave'], duracao: 20 };
  let ingenuo = 0;
  let antecipa = 0;
  for (const semente of [1, 2, 3]) {
    ingenuo += (await rodarEpisodio({ ...base, semente, politica: 'maiorConfianca' })).acertos;
    antecipa += (await rodarEpisodio({ ...base, semente, politica: 'antecipacao' })).acertos;
  }
  assert.ok(antecipa > 2 * ingenuo, `antecipação ${antecipa} vs ingênua ${ingenuo}`);
});

test('episódio é determinístico', async () => {
  const op = { semente: 5, detectar: detectorOraculo(), latencia: 0.1, politica: 'maisPerto', classesAlvo: ['ave'], duracao: 10 };
  const a = await rodarEpisodio(op);
  const b = await rodarEpisodio(op);
  assert.deepEqual(a, b);
});
