// Página interativa: o jogo roda em tempo real; o agente captura a tela, manda o quadro
// para o Web Worker, recebe as caixas e decide onde clicar.

import { criarMundo, atualizar, disparar, caixasReais, LARGURA, ALTURA } from './jogo/mundo.js';
import { desenharMundo } from './jogo/render.js';
import { criarRastreador } from './agente/rastreador.js';
import { escolherAlvo } from './agente/politicas.js';
import { criarDetector, MODELOS } from './agente/detector.js';
import { PADRAO } from './agente/episodio.js';

const $ = (id) => document.getElementById(id);
const telaJogo = $('jogo');
const ctxJogo = telaJogo.getContext('2d');
const telaSobre = $('sobreposicao');
const ctxSobre = telaSobre.getContext('2d');

// limiares escolhidos na validação (máximo F1); atualizados por resultados.json se existir
const LIMIAR_PADRAO = { proprio: 0.5, coco: 0.25 };
const estado = {
  modo: 'agente', detector: 'proprio', politica: 'antecipacao', limiar: LIMIAR_PADRAO.proprio,
  latenciaExtra: 0, mostrarDet: true, mostrarReais: false, pausado: false,
};

let mundo;
let rastreador;
let mira;
let alvoMira = null; // {x, y, resolver}
let prontoEm = 0;
let ultimas = { deteccoes: [], tObs: 0 };
let marcas = [];
let tempos = { inferencia: [], atraso: [], quadros: [] };
let detectorPronto = false;
let geracao = 0;

function reiniciar() {
  mundo = criarMundo({ semente: (Math.random() * 1e9) | 0, cena: 'dia', maxAves: PADRAO.maxAves, maxBaloes: PADRAO.maxBaloes });
  rastreador = criarRastreador();
  mira = { x: LARGURA / 2, y: ALTURA / 2 };
  if (alvoMira) alvoMira.resolver(false);
  alvoMira = null;
  prontoEm = 0;
  ultimas = { deteccoes: [], tObs: 0 };
  marcas = [];
  tempos = { inferencia: [], atraso: [], quadros: [] };
  geracao++;
}

// ---------- detector ----------
const detector = criarDetector();
let pedidoCarga = 0;
async function carregarDetector(tentouAlternativo = false) {
  const meu = ++pedidoCarga;
  detectorPronto = false;
  $('estadoModelo').hidden = false;
  $('estadoModelo').textContent = 'Carregando modelo (≈12 MB)…';
  try {
    const r = await detector.carregar(estado.detector);
    if (meu !== pedidoCarga) return; // o usuário trocou de detector no meio do caminho
    $('vProvedor').textContent = r.provedor === 'webgpu' ? 'WebGPU' : `WASM ×${r.threads}`;
    detectorPronto = true;
    $('estadoModelo').hidden = true;
  } catch (e) {
    if (meu !== pedidoCarga) return;
    if (!tentouAlternativo) {
      // se um modelo não carregar, cai para o outro em vez de deixar o agente parado
      const outro = estado.detector === 'proprio' ? 'coco' : 'proprio';
      console.warn(`Falha ao carregar ${estado.detector}; usando ${outro}.`, e);
      selecionar('detector', outro);
      return carregarDetector(true);
    }
    $('estadoModelo').textContent = `Não foi possível carregar o modelo: ${e.message}`;
  }
  const m = MODELOS[estado.detector];
  $('notaDetector').textContent = estado.detector === 'coco'
    ? 'O COCO não tem classe para "ave de papel". Aqui o agente atira no que ele chama de bird ou kite — como no artigo.'
    : `Detector com as classes ${m.nomes.join(' e ')}, treinado em quadros sintéticos do próprio jogo. Só "ave" é alvo.`;
}

// ---------- laço do agente ----------
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const proximoQuadro = () => new Promise((r) => requestAnimationFrame(r));
const mediana = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : NaN);

function moverMiraAte(x, y) {
  return new Promise((resolver) => { alvoMira = { x, y, resolver }; });
}

async function laçoAgente() {
  for (;;) {
    if (estado.modo !== 'agente' || estado.pausado || !detectorPronto || document.hidden) {
      await esperar(100);
      continue;
    }
    const minhaGeracao = geracao;
    const tObs = mundo.t;
    let r;
    try {
      r = await detector.detectar(telaJogo, estado.limiar);
    } catch {
      await esperar(200);
      continue;
    }
    if (estado.latenciaExtra) await esperar(estado.latenciaExtra);
    if (minhaGeracao !== geracao) continue;
    tempos.inferencia.push(r.ms.inferencia);
    tempos.quadros.push(performance.now());
    if (tempos.inferencia.length > 60) tempos.inferencia.shift();
    if (tempos.quadros.length > 30) tempos.quadros.shift();
    const m = MODELOS[estado.detector];
    rastreador.atualizar(r.deteccoes, tObs);
    ultimas = { deteccoes: r.deteccoes, tObs };

    if (mundo.t >= prontoEm) {
      const escolha = escolherAlvo(estado.politica, {
        deteccoes: r.deteccoes, mira, atrasoPercepcao: mundo.t - tObs, vMira: PADRAO.vMira,
        classesAlvo: m.classesAlvo, limiar: estado.limiar,
      });
      if (escolha) {
        const chegou = await moverMiraAte(escolha.ponto[0], escolha.ponto[1]);
        if (!chegou || minhaGeracao !== geracao) continue;
        const res = disparar(mundo, mira.x, mira.y);
        tempos.atraso.push((mundo.t - tObs) * 1000);
        if (tempos.atraso.length > 60) tempos.atraso.shift();
        marcas.push({ t: mundo.t, caixa: escolha.deteccao.caixa, x: mira.x, y: mira.y, ok: res.resultado === 'ave', balao: res.resultado === 'balao' });
        prontoEm = mundo.t + PADRAO.recarga;
      }
    }
    await proximoQuadro();
  }
}

// ---------- jogador humano ----------
telaSobre.addEventListener('pointerdown', (ev) => {
  if (estado.modo !== 'humano' || estado.pausado) return;
  const r = telaSobre.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * LARGURA;
  const y = ((ev.clientY - r.top) / r.height) * ALTURA;
  const res = disparar(mundo, x, y);
  marcas.push({ t: mundo.t, x, y, ok: res.resultado === 'ave', balao: res.resultado === 'balao' });
});

// ---------- desenho ----------
function caixa(ctx, c, cor, tracejado = false, largura = 2) {
  ctx.strokeStyle = cor;
  ctx.lineWidth = largura;
  ctx.setLineDash(tracejado ? [5, 4] : []);
  ctx.strokeRect(c[0], c[1], c[2] - c[0], c[3] - c[1]);
  ctx.setLineDash([]);
}

function desenharSobreposicao() {
  ctxSobre.clearRect(0, 0, LARGURA, ALTURA);
  ctxSobre.font = '600 12px -apple-system, "Segoe UI", sans-serif';
  if (estado.mostrarReais) for (const r of caixasReais(mundo)) caixa(ctxSobre, r.caixa, 'rgba(255,255,255,.9)', true, 1.5);
  if (estado.mostrarDet && estado.modo === 'agente') {
    const alvo = MODELOS[estado.detector].classesAlvo;
    for (const d of ultimas.deteccoes) {
      const ehAlvo = alvo.includes(d.classe);
      const cor = ehAlvo ? '#0a84ff' : '#8e8e93';
      caixa(ctxSobre, d.caixa, cor);
      const rotulo = `${d.classe} ${(d.score * 100).toFixed(0)}%`;
      const w = ctxSobre.measureText(rotulo).width + 8;
      ctxSobre.fillStyle = cor;
      ctxSobre.fillRect(d.caixa[0] - 1, d.caixa[1] - 17, w, 16);
      ctxSobre.fillStyle = '#fff';
      ctxSobre.fillText(rotulo, d.caixa[0] + 3, d.caixa[1] - 5);
    }
  }
  marcas = marcas.filter((m) => mundo.t - m.t < 0.7);
  for (const m of marcas) {
    const a = 1 - (mundo.t - m.t) / 0.7;
    ctxSobre.globalAlpha = a;
    if (m.caixa) caixa(ctxSobre, m.caixa, 'rgba(255,255,255,.8)', true, 1);
    ctxSobre.strokeStyle = m.ok ? '#30d158' : '#ff453a';
    ctxSobre.lineWidth = 3;
    ctxSobre.beginPath();
    ctxSobre.arc(m.x, m.y, 9, 0, Math.PI * 2);
    ctxSobre.stroke();
    ctxSobre.globalAlpha = 1;
  }
  if (estado.modo === 'agente') {
    ctxSobre.strokeStyle = '#ffffff';
    ctxSobre.lineWidth = 2;
    ctxSobre.beginPath();
    ctxSobre.arc(mira.x, mira.y, 12, 0, Math.PI * 2);
    ctxSobre.moveTo(mira.x - 18, mira.y); ctxSobre.lineTo(mira.x - 6, mira.y);
    ctxSobre.moveTo(mira.x + 6, mira.y); ctxSobre.lineTo(mira.x + 18, mira.y);
    ctxSobre.moveTo(mira.x, mira.y - 18); ctxSobre.lineTo(mira.x, mira.y - 6);
    ctxSobre.moveTo(mira.x, mira.y + 6); ctxSobre.lineTo(mira.x, mira.y + 18);
    ctxSobre.stroke();
  }
}

function atualizarPainel() {
  const p = mundo.placar;
  $('vTiros').textContent = p.tiros;
  $('vAcertos').textContent = p.acertos;
  $('vBaloes').textContent = p.baloes;
  $('vPrecisao').textContent = p.tiros ? `${Math.round((100 * p.acertos) / p.tiros)}%` : '–';
  const inf = mediana(tempos.inferencia);
  $('vInferencia').textContent = Number.isFinite(inf) ? `${Math.round(inf)} ms` : '–';
  const atr = mediana(tempos.atraso);
  $('vAtraso').textContent = Number.isFinite(atr) ? `${Math.round(atr)} ms` : '–';
  const q = tempos.quadros;
  $('vFps').textContent = q.length > 2 ? ((1000 * (q.length - 1)) / (q[q.length - 1] - q[0])).toFixed(1) : '–';
}

let anterior = performance.now();
let ultimoPainel = 0;
function quadro(agora) {
  const dt = Math.min(0.05, (agora - anterior) / 1000);
  anterior = agora;
  if (!estado.pausado) {
    atualizar(mundo, dt);
    if (alvoMira) {
      const dx = alvoMira.x - mira.x;
      const dy = alvoMira.y - mira.y;
      const d = Math.hypot(dx, dy);
      const passo = PADRAO.vMira * dt;
      if (d <= passo) {
        mira.x = alvoMira.x; mira.y = alvoMira.y;
        const r = alvoMira.resolver; alvoMira = null; r(true);
      } else {
        mira.x += (dx / d) * passo; mira.y += (dy / d) * passo;
      }
    }
  }
  desenharMundo(ctxJogo, mundo);
  desenharSobreposicao();
  if (agora - ultimoPainel > 250) { atualizarPainel(); ultimoPainel = agora; }
  requestAnimationFrame(quadro);
}

// ---------- controles ----------
function sincronizarFaixas() {
  $('limiar').value = estado.limiar;
  $('oLimiar').textContent = Number(estado.limiar).toFixed(2);
  $('oLatencia').textContent = `${estado.latenciaExtra} ms`;
}
/** Marca o botão do controle segmentado e atualiza o estado (sem disparar recarga). */
function selecionar(campo, valor) {
  const seg = document.querySelector(`.seg[data-campo="${campo}"]`);
  seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === valor)));
  estado[campo] = valor;
  if (campo === 'detector') {
    estado.limiar = LIMIAR_PADRAO[valor];
    sincronizarFaixas();
    ultimas = { deteccoes: [], tObs: 0 };
  }
}
document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const campo = seg.dataset.campo;
    if (estado[campo] === b.dataset.v) return;
    selecionar(campo, b.dataset.v);
    if (campo === 'detector') carregarDetector();
    if (campo === 'modo') { if (alvoMira) { alvoMira.resolver(false); alvoMira = null; } }
  });
});
$('limiar').addEventListener('input', (e) => { estado.limiar = Number(e.target.value); sincronizarFaixas(); });
$('latencia').addEventListener('input', (e) => { estado.latenciaExtra = Number(e.target.value); sincronizarFaixas(); });
$('mostrarDet').addEventListener('change', (e) => { estado.mostrarDet = e.target.checked; });
$('mostrarReais').addEventListener('change', (e) => { estado.mostrarReais = e.target.checked; });
$('pausar').addEventListener('click', () => {
  estado.pausado = !estado.pausado;
  $('pausar').textContent = estado.pausado ? 'Continuar' : 'Pausar';
});
$('reiniciar').addEventListener('click', reiniciar);

fetch('resultados.json').then((r) => r.json()).then((res) => {
  if (res.limiares) {
    Object.assign(LIMIAR_PADRAO, res.limiares);
    estado.limiar = LIMIAR_PADRAO[estado.detector];
    sincronizarFaixas();
  }
}).catch(() => {});

reiniciar();
sincronizarFaixas();
carregarDetector();
requestAnimationFrame(quadro);
laçoAgente();
