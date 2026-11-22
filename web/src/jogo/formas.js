// Geometria dos alvos de Revoada, sem dependência de canvas.
// Cada entidade vira uma lista de polígonos em coordenadas de tela.
// O desenho (render.js) e a caixa real (ground truth) saem da mesma lista,
// então a caixa é exata por construção.

export const PALETAS_AVE = [
  { corpo: '#1f7a8c', asa: '#145566', barriga: '#bfe3ea', bico: '#f2a541' },
  { corpo: '#d1495b', asa: '#9e2f3f', barriga: '#f6c9cf', bico: '#f2c14e' },
  { corpo: '#6a4c93', asa: '#4a3369', barriga: '#d9cdea', bico: '#f4a259' },
  { corpo: '#e09f3e', asa: '#a86f1f', barriga: '#f7e1b5', bico: '#d1495b' },
  { corpo: '#3d5a80', asa: '#293d57', barriga: '#c9d6e8', bico: '#ee6c4d' },
  { corpo: '#5b8e3e', asa: '#3e6429', barriga: '#d6e8c4', bico: '#f2a541' },
];

export const CORES_BALAO = ['#ff5d73', '#ffd23f', '#3bceac', '#5e60ce', '#ff8c42', '#f1f1f1'];

function elipse(cx, cy, rx, ry, n = 20) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function transformar(pontos, ent, dir, angulo) {
  const c = Math.cos(angulo);
  const s = Math.sin(angulo);
  return pontos.map(([lx, ly]) => {
    const x = lx * c - ly * s;
    const y = lx * s + ly * c;
    return [ent.x + ent.escala * dir * x, ent.y + ent.escala * y];
  });
}

/** Polígonos locais da ave (virada para a direita), dado o batimento da asa f ∈ [-1, 1]. */
function partesAve(f, paleta) {
  const asaTopo = -4 - 26 * f;
  return [
    { pontos: [[-20, -3], [-38, -13], [-33, 1], [-38, 13], [-20, 5]], cor: paleta.asa },
    { pontos: elipse(0, 0, 24, 15), cor: paleta.corpo },
    { pontos: elipse(4, 5, 15, 8), cor: paleta.barriga },
    { pontos: [[15, -19], [19, -29], [24, -19]], cor: paleta.asa },
    { pontos: elipse(20, -10, 11, 11, 16), cor: paleta.corpo },
    { pontos: [[29, -14], [43, -8], [29, -4]], cor: paleta.bico },
    { pontos: elipse(23, -12, 3.2, 3.2, 10), cor: '#ffffff', caixa: false },
    { pontos: elipse(24, -12, 1.6, 1.6, 8), cor: '#1b1b1b', caixa: false },
    { pontos: [[6, -4], [-4, asaTopo], [-25, asaTopo * 0.78 + 2], [-16, 3]], cor: paleta.asa },
  ];
}

function partesBalao(cor) {
  return [
    { pontos: elipse(0, 0, 17, 21, 24), cor },
    { pontos: [[-3.5, 20], [3.5, 20], [0, 26]], cor },
    { pontos: elipse(-6, -8, 3.5, 6.5, 12), cor: 'rgba(255,255,255,0.55)', caixa: false },
  ];
}

/** Lista de partes {pontos, cor, caixa} da entidade, em coordenadas de tela. */
export function formasDe(ent) {
  if (ent.tipo === 'ave') {
    const dir = ent.vx >= 0 ? 1 : -1;
    const angulo = Math.max(-0.45, Math.min(0.45, Math.atan2(ent.vy, Math.abs(ent.vx) + 1e-6) * 0.5));
    const f = Math.sin(ent.fase);
    return partesAve(f, PALETAS_AVE[ent.paleta % PALETAS_AVE.length]).map((p) => ({
      ...p,
      caixa: p.caixa !== false,
      pontos: transformar(p.pontos, ent, dir, angulo * dir),
    }));
  }
  return partesBalao(CORES_BALAO[ent.paleta % CORES_BALAO.length]).map((p) => ({
    ...p,
    caixa: p.caixa !== false,
    pontos: transformar(p.pontos, ent, 1, ent.inclinacao || 0),
  }));
}

/** Fio do balão (só desenho; não entra na caixa). */
export function fioDoBalao(ent) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const ly = 26 + i * 5;
    const lx = Math.sin(i * 0.9 + ent.oscilacao) * 3;
    pts.push([ent.x + ent.escala * lx, ent.y + ent.escala * ly]);
  }
  return pts;
}

/** Caixa real [x1, y1, x2, y2] sem recorte pela tela. */
export function caixaDe(ent) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const parte of formasDe(ent)) {
    if (!parte.caixa) continue;
    for (const [x, y] of parte.pontos) {
      if (x < x1) x1 = x;
      if (y < y1) y1 = y;
      if (x > x2) x2 = x;
      if (y > y2) y2 = y;
    }
  }
  return [x1, y1, x2, y2];
}

export function pontoNoPoligono(x, y, pontos) {
  let dentro = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const [xi, yi] = pontos[i];
    const [xj, yj] = pontos[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Acerto: o ponto (com tolerância de 3 px) cai dentro do desenho da entidade. */
export function acertou(ent, x, y, tolerancia = 3) {
  const partes = formasDe(ent).filter((p) => p.caixa);
  const amostras = [[0, 0], [tolerancia, 0], [-tolerancia, 0], [0, tolerancia], [0, -tolerancia]];
  return amostras.some(([dx, dy]) => partes.some((p) => pontoNoPoligono(x + dx, y + dy, p.pontos)));
}
