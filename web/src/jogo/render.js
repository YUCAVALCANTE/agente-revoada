// Desenho de Revoada em canvas 2D (funciona com HTMLCanvas e OffscreenCanvas).

import { formasDe, fioDoBalao, PALETAS_AVE, CORES_BALAO } from './formas.js';
import { LARGURA, ALTURA, HORIZONTE } from './mundo.js';

const CEUS = {
  dia: { topo: '#5aa9e6', base: '#cfe8f7', astro: '#fff4c2', colinas: ['#7fb685', '#5e9a6a'], chao: '#4f8a5b', nuvem: '#ffffff' },
  entardecer: { topo: '#3b4a8c', base: '#f6a76b', astro: '#ffd08a', colinas: ['#8a5a7a', '#6b4462'], chao: '#4c3550', nuvem: '#ffe1cc' },
  noite: { topo: '#0b1026', base: '#28335c', astro: '#e8ecff', colinas: ['#1e2a44', '#151e33'], chao: '#10182a', nuvem: '#5a6488' },
};

function poligono(ctx, pontos) {
  ctx.beginPath();
  ctx.moveTo(pontos[0][0], pontos[0][1]);
  for (let i = 1; i < pontos.length; i++) ctx.lineTo(pontos[i][0], pontos[i][1]);
  ctx.closePath();
  ctx.fill();
}

function desenharNuvem(ctx, n, cor, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = cor;
  for (const [dx, dy, r] of n.bolhas) {
    ctx.beginPath();
    ctx.arc(n.x + dx * n.escala, n.y + dy * n.escala, r * n.escala, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function desenharFundo(ctx, mundo) {
  const ceu = CEUS[mundo.cena] || CEUS.dia;
  const g = ctx.createLinearGradient(0, 0, 0, HORIZONTE);
  g.addColorStop(0, ceu.topo);
  g.addColorStop(1, ceu.base);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, LARGURA, ALTURA);

  ctx.fillStyle = ceu.astro;
  ctx.beginPath();
  ctx.arc(mundo.cena === 'entardecer' ? 470 : 540, mundo.cena === 'entardecer' ? 300 : 80, 34, 0, Math.PI * 2);
  ctx.fill();
  if (mundo.cena === 'noite') {
    ctx.fillStyle = ceu.topo;
    ctx.beginPath();
    ctx.arc(554, 72, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const n of mundo.nuvens) if (!n.frente) desenharNuvem(ctx, n, ceu.nuvem, mundo.cena === 'noite' ? 0.5 : 0.85);

  mundo.colinas.forEach((pts, i) => {
    ctx.fillStyle = ceu.colinas[i];
    poligono(ctx, pts);
  });
  ctx.fillStyle = ceu.chao;
  ctx.fillRect(0, HORIZONTE + 40, LARGURA, ALTURA - HORIZONTE - 40);
}

export function desenharEntidade(ctx, e) {
  if (e.tipo === 'balao') {
    const fio = fioDoBalao(e);
    ctx.strokeStyle = 'rgba(40,40,40,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(fio[0][0], fio[0][1]);
    for (const [x, y] of fio.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  }
  for (const parte of formasDe(e)) {
    ctx.fillStyle = parte.cor;
    poligono(ctx, parte.pontos);
  }
}

function desenharEfeitos(ctx, mundo) {
  for (const f of mundo.efeitos) {
    const p = f.idade / f.duracao;
    ctx.globalAlpha = 1 - p;
    if (f.tipo === 'erro') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 4 + 10 * p, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const cor = f.tipo === 'penas' ? PALETAS_AVE[f.cor % PALETAS_AVE.length].corpo : CORES_BALAO[f.cor % CORES_BALAO.length];
      ctx.fillStyle = cor;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(f.x + Math.cos(a) * 28 * p, f.y + Math.sin(a) * 28 * p, 4 * (1 - p) + 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** Desenha o quadro completo: fundo, alvos, nuvens da frente e efeitos. */
export function desenharMundo(ctx, mundo, { efeitos = true } = {}) {
  desenharFundo(ctx, mundo);
  for (const e of mundo.entidades) desenharEntidade(ctx, e);
  const ceu = CEUS[mundo.cena] || CEUS.dia;
  for (const n of mundo.nuvens) if (n.frente) desenharNuvem(ctx, n, ceu.nuvem, 0.9);
  if (efeitos) desenharEfeitos(ctx, mundo);
}
