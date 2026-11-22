// Lógica de Revoada: um jogo original de tiro ao alvo.
// Aves de papel cruzam o céu fazendo curvas; balões sobem devagar.
// Acertar uma ave vale +1; estourar um balão é penalidade.
// Este módulo não desenha nada: roda igual no navegador e no Node.

import { criarRng } from './rng.js';
import { caixaDe, acertou } from './formas.js';

export const LARGURA = 640;
export const ALTURA = 480;
export const HORIZONTE = 405;
export const CENAS = ['dia', 'entardecer', 'noite'];

const PASSO = 1 / 120;

function gerarColinas(rng) {
  const camadas = [];
  for (let c = 0; c < 2; c++) {
    const base = HORIZONTE - 70 + c * 40;
    const pts = [[0, ALTURA]];
    const n = 9;
    for (let i = 0; i <= n; i++) {
      pts.push([(i / n) * LARGURA, base - rng.entre(0, 55 - c * 15)]);
    }
    pts.push([LARGURA, ALTURA]);
    camadas.push(pts);
  }
  return camadas;
}

function gerarNuvem(rng, x, frente = false) {
  const bolhas = [];
  const n = rng.inteiro(3, 5);
  for (let i = 0; i < n; i++) {
    bolhas.push([rng.entre(-40, 40), rng.entre(-10, 8), rng.entre(14, 28)]);
  }
  return {
    x,
    y: rng.entre(40, frente ? 300 : 240),
    escala: rng.entre(0.7, frente ? 1.6 : 1.3),
    vel: rng.entre(4, 14),
    bolhas,
    frente,
  };
}

export function criarMundo({
  semente = 1,
  cena = 'dia',
  maxAves = 3,
  maxBaloes = 2,
  velocidade = 1,
  nuvensFrente = 1,
} = {}) {
  const rng = criarRng(semente);
  const mundo = {
    t: 0,
    rng,
    cena,
    maxAves,
    maxBaloes,
    velocidade,
    entidades: [],
    efeitos: [],
    proximoId: 1,
    proximaAve: 0.3,
    proximoBalao: 0.8,
    colinas: gerarColinas(rng),
    nuvens: [],
    placar: { tiros: 0, acertos: 0, baloes: 0, erros: 0, avesSurgidas: 0, avesFugiram: 0 },
  };
  for (let i = 0; i < 4; i++) mundo.nuvens.push(gerarNuvem(rng, rng.entre(0, LARGURA)));
  for (let i = 0; i < nuvensFrente; i++) mundo.nuvens.push(gerarNuvem(rng, rng.entre(0, LARGURA), true));
  return mundo;
}

export function novaAve(mundo, opcoes = {}) {
  const { rng } = mundo;
  const lado = rng.inteiro(0, 2); // 0 esquerda, 1 direita, 2 baixo
  let x;
  let y;
  let rumo;
  if (lado === 0) {
    x = -30; y = rng.entre(60, HORIZONTE - 80); rumo = rng.entre(-0.6, 0.4);
  } else if (lado === 1) {
    x = LARGURA + 30; y = rng.entre(60, HORIZONTE - 80); rumo = Math.PI + rng.entre(-0.4, 0.6);
  } else {
    x = rng.entre(120, LARGURA - 120); y = HORIZONTE + 10; rumo = -Math.PI / 2 + rng.entre(-0.7, 0.7);
  }
  const rapidez = rng.entre(130, 290) * mundo.velocidade;
  const ent = {
    id: mundo.proximoId++,
    tipo: 'ave',
    x,
    y,
    rapidez,
    rumo,
    giro: rng.normal() * 1.1,
    trocaGiro: rng.entre(0.4, 1.2),
    vx: Math.cos(rumo) * rapidez,
    vy: Math.sin(rumo) * rapidez,
    escala: rng.entre(0.65, 1.35),
    paleta: rng.inteiro(0, 5),
    fase: rng.entre(0, Math.PI * 2),
    freqAsa: rng.entre(10, 15),
    vida: rng.entre(6, 9),
    idade: 0,
    fugindo: false,
    ...opcoes,
  };
  mundo.entidades.push(ent);
  mundo.placar.avesSurgidas++;
  return ent;
}

export function novoBalao(mundo, opcoes = {}) {
  const { rng } = mundo;
  const ent = {
    id: mundo.proximoId++,
    tipo: 'balao',
    x0: rng.entre(60, LARGURA - 60),
    x: 0,
    y: HORIZONTE + 30,
    vx: 0,
    vy: -rng.entre(30, 65) * mundo.velocidade,
    amplitude: rng.entre(8, 26),
    freq: rng.entre(0.6, 1.4),
    oscilacao: rng.entre(0, Math.PI * 2),
    inclinacao: 0,
    escala: rng.entre(0.8, 1.3),
    paleta: rng.inteiro(0, 5),
    idade: 0,
    ...opcoes,
  };
  ent.x = ent.x0;
  mundo.entidades.push(ent);
  return ent;
}

function moverAve(mundo, e, dt) {
  e.idade += dt;
  e.fase += e.freqAsa * dt;
  if (!e.fugindo && e.idade > e.vida) e.fugindo = true;
  if (e.fugindo) {
    // vira para cima e acelera até sair da tela
    const alvo = -Math.PI / 2;
    let d = alvo - e.rumo;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    e.rumo += Math.sign(d) * Math.min(Math.abs(d), 3 * dt);
    e.rapidez = Math.min(e.rapidez + 200 * dt, 420 * mundo.velocidade);
  } else {
    e.trocaGiro -= dt;
    if (e.trocaGiro <= 0) {
      e.giro = mundo.rng.normal() * 1.1;
      e.trocaGiro = mundo.rng.entre(0.4, 1.2);
    }
    e.rumo += e.giro * dt;
    // mantém a ave na área de voo depois que ela entrou
    const m = 40;
    const dentro = e.x > m && e.x < LARGURA - m && e.y > m && e.y < HORIZONTE - 50;
    if (e.idade > 0.8 && !dentro) {
      const cx = LARGURA / 2 - e.x;
      const cy = (HORIZONTE - 50) / 2 - e.y;
      let d = Math.atan2(cy, cx) - e.rumo;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      e.rumo += Math.sign(d) * Math.min(Math.abs(d), 2.5 * dt);
    }
  }
  e.vx = Math.cos(e.rumo) * e.rapidez;
  e.vy = Math.sin(e.rumo) * e.rapidez;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  if (e.fugindo && e.y < -80) {
    e.removida = true;
    mundo.placar.avesFugiram++;
  }
}

function moverBalao(e, dt) {
  e.idade += dt;
  e.oscilacao += e.freq * dt;
  const xAntes = e.x;
  e.y += e.vy * dt;
  e.x = e.x0 + Math.sin(e.oscilacao) * e.amplitude;
  e.vx = (e.x - xAntes) / dt;
  e.inclinacao = Math.cos(e.oscilacao) * 0.12;
  if (e.y < -80) e.removida = true;
}

function passo(mundo, dt) {
  mundo.t += dt;
  for (const e of mundo.entidades) {
    if (e.tipo === 'ave') moverAve(mundo, e, dt);
    else moverBalao(e, dt);
  }
  mundo.entidades = mundo.entidades.filter((e) => !e.removida);
  for (const n of mundo.nuvens) {
    n.x += n.vel * dt;
    if (n.x > LARGURA + 90) n.x = -90;
  }
  for (const f of mundo.efeitos) f.idade += dt;
  mundo.efeitos = mundo.efeitos.filter((f) => f.idade < f.duracao);

  const aves = mundo.entidades.filter((e) => e.tipo === 'ave').length;
  const baloes = mundo.entidades.length - aves;
  mundo.proximaAve -= dt;
  mundo.proximoBalao -= dt;
  if (aves < mundo.maxAves && mundo.proximaAve <= 0) {
    novaAve(mundo);
    mundo.proximaAve = mundo.rng.entre(0.4, 1.4);
  }
  if (baloes < mundo.maxBaloes && mundo.proximoBalao <= 0) {
    novoBalao(mundo);
    mundo.proximoBalao = mundo.rng.entre(1.5, 4);
  }
}

/** Avança o mundo `dt` segundos em passos fixos (determinístico). */
export function atualizar(mundo, dt) {
  let resto = dt;
  while (resto > 1e-9) {
    const d = Math.min(PASSO, resto);
    passo(mundo, d);
    resto -= d;
  }
}

/** Dispara em (x, y). Testa da entidade desenhada por último para a primeira. */
export function disparar(mundo, x, y) {
  mundo.placar.tiros++;
  for (let i = mundo.entidades.length - 1; i >= 0; i--) {
    const e = mundo.entidades[i];
    if (acertou(e, x, y)) {
      e.removida = true;
      mundo.entidades.splice(i, 1);
      if (e.tipo === 'ave') mundo.placar.acertos++;
      else mundo.placar.baloes++;
      mundo.efeitos.push({ tipo: e.tipo === 'ave' ? 'penas' : 'estouro', x: e.x, y: e.y, idade: 0, duracao: 0.35, cor: e.paleta });
      return { resultado: e.tipo, id: e.id };
    }
  }
  mundo.placar.erros++;
  mundo.efeitos.push({ tipo: 'erro', x, y, idade: 0, duracao: 0.25 });
  return { resultado: 'erro', id: null };
}

/** Caixas reais visíveis, recortadas pela tela. Descarta alvos com menos de 35% visível. */
export function caixasReais(mundo) {
  const caixas = [];
  for (const e of mundo.entidades) {
    const [x1, y1, x2, y2] = caixaDe(e);
    const area = (x2 - x1) * (y2 - y1);
    const cx1 = Math.max(0, x1);
    const cy1 = Math.max(0, y1);
    const cx2 = Math.min(LARGURA, x2);
    const cy2 = Math.min(HORIZONTE + 40, ALTURA, y2);
    if (cx2 <= cx1 || cy2 <= cy1) continue;
    const visivel = ((cx2 - cx1) * (cy2 - cy1)) / area;
    if (visivel < 0.35 || cx2 - cx1 < 6 || cy2 - cy1 < 6) continue;
    caixas.push({ id: e.id, classe: e.tipo, caixa: [cx1, cy1, cx2, cy2], vx: e.vx, vy: e.vy });
  }
  return caixas;
}

/**
 * Cena estática aleatória para o conjunto de dados: aves e balões
 * espalhados em posições, poses e escalas aleatórias.
 */
export function cenaAleatoria(semente, { cena } = {}) {
  const rng0 = criarRng(semente * 7919 + 13);
  const escolhida = cena || rng0.escolher(['dia', 'entardecer']);
  const mundo = criarMundo({
    semente,
    cena: escolhida,
    maxAves: 0,
    maxBaloes: 0,
    nuvensFrente: rng0.inteiro(0, 2),
  });
  const { rng } = mundo;
  const nAves = rng.inteiro(0, 5);
  const nBaloes = rng.inteiro(0, 3);
  const itens = [];
  for (let i = 0; i < nAves; i++) itens.push('ave');
  for (let i = 0; i < nBaloes; i++) itens.push('balao');
  // ordem aleatória de desenho (quem fica na frente)
  for (let i = itens.length - 1; i > 0; i--) {
    const j = rng.inteiro(0, i);
    [itens[i], itens[j]] = [itens[j], itens[i]];
  }
  for (const tipo of itens) {
    const x = rng.entre(-10, LARGURA + 10);
    const y = rng.entre(20, HORIZONTE + 5);
    if (tipo === 'ave') {
      const rumo = rng.entre(0, Math.PI * 2);
      novaAve(mundo, { x, y, rumo, vx: Math.cos(rumo) * 200, vy: Math.sin(rumo) * 200, escala: rng.entre(0.5, 1.5) });
    } else {
      novoBalao(mundo, { x0: x, x, y, inclinacao: rng.entre(-0.15, 0.15), escala: rng.entre(0.6, 1.4) });
    }
  }
  return mundo;
}
