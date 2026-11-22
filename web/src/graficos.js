// Gráficos da seção de resultados, desenhados em SVG a partir de resultados.json
// (gerado por python -m revoada.graficos a partir dos relatórios em reports/).

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, texto) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (texto != null) e.textContent = texto;
  return e;
};
const pct = (v) => `${Math.round(v * 100)}%`;
const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(d).replace('.', ','));

function card(titulo, texto) {
  const div = document.createElement('div');
  div.className = 'card grafico';
  div.innerHTML = `<h3>${titulo}</h3><p>${texto}</p>`;
  return div;
}

/** Barras horizontais: [{rotulo, valor, destaque}] com valor em [0, 1]. */
function barras(itens) {
  const L = 420;
  const alt = 26;
  const esq = 120;
  const svg = el('svg', { viewBox: `0 0 ${L} ${itens.length * alt + 4}`, role: 'img' });
  itens.forEach((it, i) => {
    const y = i * alt;
    const w = Math.max(2, (L - esq - 44) * it.valor);
    svg.append(el('text', { x: esq - 8, y: y + 17, 'text-anchor': 'end', class: it.destaque ? 'forte' : '' }, it.rotulo));
    svg.append(el('rect', { x: esq, y: y + 5, width: w, height: 16, rx: 4, fill: it.destaque ? 'var(--accent)' : 'var(--accent-2)' }));
    svg.append(el('text', { x: esq + w + 6, y: y + 17, class: it.destaque ? 'forte' : '' }, pct(it.valor)));
  });
  return svg;
}

/** Linhas: series [{rotulo, pontos:[[x,y]...], banda?:[[x,lo,hi]...], destaque, tracejado}] */
function linhas(series, { xs, yMax = 1, yFmt = pct, xFmt = (x) => `${x} ms`, yRotulo }) {
  const L = 440;
  const A = 250;
  const m = { e: 40, d: 118, t: 12, b: 34 };
  const sx = (x) => m.e + ((x - xs[0]) / (xs[xs.length - 1] - xs[0])) * (L - m.e - m.d);
  const sy = (y) => A - m.b - (y / yMax) * (A - m.t - m.b);
  const svg = el('svg', { viewBox: `0 0 ${L} ${A}`, role: 'img' });
  for (let k = 0; k <= 4; k++) {
    const v = (yMax * k) / 4;
    svg.append(el('line', { x1: m.e, x2: L - m.d, y1: sy(v), y2: sy(v), class: k ? 'grade-l' : 'eixo' }));
    svg.append(el('text', { x: m.e - 6, y: sy(v) + 4, 'text-anchor': 'end' }, yFmt(v)));
  }
  for (const x of xs) svg.append(el('text', { x: sx(x), y: A - m.b + 16, 'text-anchor': 'middle' }, xFmt(x)));
  if (yRotulo) svg.append(el('text', { x: m.e, y: A - 2 }, yRotulo));
  const rotulos = [];
  for (const s of series) {
    const cor = s.destaque ? 'var(--accent)' : s.cor || 'var(--accent-3)';
    if (s.banda) {
      const cima = s.banda.map(([x, , hi]) => `${sx(x)},${sy(hi)}`);
      const baixo = s.banda.map(([x, lo]) => `${sx(x)},${sy(lo)}`).reverse();
      svg.append(el('polygon', { points: [...cima, ...baixo].join(' '), fill: cor, opacity: 0.12 }));
    }
    svg.append(el('polyline', {
      points: s.pontos.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' '),
      fill: 'none', stroke: cor, 'stroke-width': s.destaque ? 2.5 : 1.75, 'stroke-dasharray': s.tracejado ? '5 4' : 'none',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    for (const [x, y] of s.pontos) svg.append(el('circle', { cx: sx(x), cy: sy(y), r: s.destaque ? 3.5 : 2.5, fill: cor }));
    const [ux, uy] = s.pontos[s.pontos.length - 1];
    rotulos.push({ y: sy(uy), x: sx(ux) + 8, texto: `${s.rotulo} ${yFmt(uy)}`, destaque: s.destaque });
  }
  // evita sobreposição dos rótulos à direita
  rotulos.sort((a, b) => a.y - b.y);
  for (let i = 1; i < rotulos.length; i++) rotulos[i].y = Math.max(rotulos[i].y, rotulos[i - 1].y + 14);
  for (const r of rotulos) svg.append(el('text', { x: r.x, y: r.y + 4, class: r.destaque ? 'forte' : '' }, r.texto));
  return svg;
}

function tabelaDeteccao(linhasTab) {
  const t = document.createElement('table');
  t.innerHTML = `<thead><tr><th>Detector (o que conta como "ave")</th><th>AP@0,5 teste</th><th>AP@0,5 noite</th><th>Precisão</th><th>Recall</th></tr></thead>`;
  const corpo = document.createElement('tbody');
  for (const l of linhasTab) {
    const tr = document.createElement('tr');
    if (l.destaque) tr.className = 'destaque';
    tr.innerHTML = `<td>${l.rotulo}</td><td>${fmt(l.ap50_teste)}</td><td>${fmt(l.ap50_noite)}</td><td>${pct(l.precisao)}</td><td>${pct(l.recall)}</td>`;
    corpo.append(tr);
  }
  t.append(corpo);
  return t;
}

const NOMES_POL = { maiorConfianca: 'Maior confiança', maisPerto: 'Mais perto', antecipacao: 'Antecipação' };

async function montar() {
  const destino = document.getElementById('graficos');
  let r;
  try {
    r = await (await fetch('resultados.json')).json();
  } catch {
    destino.innerHTML = '<p>Resultados indisponíveis.</p>';
    return;
  }
  destino.innerHTML = '';

  const c1 = card('Que nome o detector COCO dá às aves de papel',
    `Para cada ave real nos ${r.classesCoco.n} quadros de teste, a classe da detecção mais sobreposta (confiança ≥ 0,25, IoU ≥ 0,5). O COCO não tem "ave de papel": ele chuta a categoria mais parecida que conhece.`);
  c1.append(barras(r.classesCoco.ave.map(([rotulo, valor]) => ({ rotulo, valor, destaque: rotulo === 'bird' || rotulo === 'kite' }))));
  destino.append(c1);

  const c2 = card('Detector pronto × detector treinado no jogo',
    `AP@0,5 da classe "ave" no teste (dia e entardecer) e num cenário que o treino nunca viu (noite). Precisão e recall no limiar escolhido na validação.`);
  c2.append(tabelaDeteccao(r.deteccao));
  destino.append(c2);

  const xs = r.latencias;
  const serie = (det, pol, campo = 'precisao') => r.politicas[det]?.[pol]?.map((p) => [p.latencia_ms, p[campo]]);
  const detLat = r.politicas.proprio ? 'proprio' : 'oraculo';
  const c3 = card('Acertar onde a ave estava: precisão × latência',
    `${detLat === 'proprio' ? 'Detector treinado no jogo' : 'Agente com as caixas reais do jogo (visão perfeita), para isolar o efeito da decisão'}, ${r.episodios} episódios pareados por ponto. Mirar no centro da caixa funciona só com o mundo parado; com atraso, a ave já saiu dali. Estimar a velocidade entre quadros e mirar à frente recupera boa parte dos acertos.`);
  c3.append(linhas(
    Object.keys(NOMES_POL).filter((p) => serie(detLat, p)).map((p) => ({
      rotulo: NOMES_POL[p], pontos: serie(detLat, p), destaque: p === 'antecipacao', tracejado: p === 'maisPerto',
      banda: r.politicas[detLat][p].map((x) => [x.latencia_ms, ...x.precisao_ic95]),
    })),
    { xs, yRotulo: 'precisão (acertos ÷ tiros) por latência de percepção' },
  ));
  destino.append(c3);

  if (Object.keys(r.politicas).length < 2) return;
  const yMax = Math.ceil(Math.max(...Object.values(r.politicas).flatMap((d) => Object.values(d).flat().map((p) => p.abates_por_minuto))) / 10) * 10;
  const c4 = card('Aves abatidas por minuto, com antecipação',
    'O mesmo agente com três "olhos": as caixas reais do jogo (teto), o detector treinado no jogo e o detector COCO tratando bird/kite como alvo.');
  const det = [['oraculo', 'Caixas reais', 'var(--accent-3)', true], ['proprio', 'Treinado', null, false], ['coco', 'COCO', 'var(--accent-3)', false]];
  c4.append(linhas(
    det.filter(([d]) => serie(d, 'antecipacao')).map(([d, rotulo, cor, tracejado]) => ({
      rotulo, cor, tracejado, destaque: d === 'proprio', pontos: serie(d, 'antecipacao', 'abates_por_minuto'),
    })),
    { xs, yMax, yFmt: (v) => String(Math.round(v)), yRotulo: 'aves abatidas por minuto' },
  ));
  destino.append(c4);
}

montar();
