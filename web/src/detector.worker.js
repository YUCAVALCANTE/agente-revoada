// Web Worker de detecção: recebe o quadro como ImageBitmap (transferido, sem cópia),
// faz o letterbox num OffscreenCanvas, roda o YOLOv8 com onnxruntime-web e devolve as caixas.
// Tudo fora da thread principal: o jogo continua fluido enquanto a rede pensa.

import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.min.mjs';
import { letterbox, rgbaParaChw, posprocessar } from './agente/yolo.js';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

let sessao = null;
let config = null;
let tela = null;
let ctx = null;

async function carregar({ url, nomes, lado, provedores }) {
  config = { nomes, lado };
  tela = new OffscreenCanvas(lado, lado);
  ctx = tela.getContext('2d', { willReadFrequently: true });
  let ultimoErro;
  for (const p of provedores) {
    try {
      if (p === 'webgpu' && !(await temWebGpu())) continue;
      // alguns navegadores expõem WebGPU mas nunca terminam de criar a sessão: limite de tempo
      const s = await comPrazo(criarSessao(url, p, lado), p === 'webgpu' ? 10000 : 60000);
      sessao = s;
      return p;
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro;
}

async function criarSessao(url, provedor, lado) {
  const s = await ort.InferenceSession.create(url, { executionProviders: [provedor], graphOptimizationLevel: 'all' });
  // aquecimento
  const x = new ort.Tensor('float32', new Float32Array(3 * lado * lado), [1, 3, lado, lado]);
  await s.run({ [s.inputNames[0]]: x });
  return s;
}

function comPrazo(promessa, ms) {
  return Promise.race([promessa, new Promise((_, rej) => setTimeout(() => rej(new Error(`tempo esgotado (${ms} ms)`)), ms))]);
}

async function temWebGpu() {
  if (!self.navigator.gpu) return false;
  try {
    return !!(await comPrazo(self.navigator.gpu.requestAdapter(), 2000));
  } catch {
    return false;
  }
}

async function detectar({ bitmap, limiar }) {
  const t0 = performance.now();
  const lb = letterbox(bitmap.width, bitmap.height, config.lado);
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, config.lado, config.lado);
  ctx.drawImage(bitmap, lb.padX, lb.padY, lb.nl, lb.na);
  const largura = bitmap.width;
  const altura = bitmap.height;
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, config.lado, config.lado).data;
  const entrada = new ort.Tensor('float32', rgbaParaChw(rgba, config.lado), [1, 3, config.lado, config.lado]);
  const t1 = performance.now();
  const saidas = await sessao.run({ [sessao.inputNames[0]]: entrada });
  const t2 = performance.now();
  const saida = saidas[sessao.outputNames[0]];
  const deteccoes = posprocessar(saida.data, saida.dims, { limiar, nomes: config.nomes, lb, largura, altura });
  const t3 = performance.now();
  return { deteccoes, ms: { pre: t1 - t0, inferencia: t2 - t1, pos: t3 - t2 } };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.tipo === 'carregar') {
      const provedor = await carregar(data);
      self.postMessage({ tipo: 'pronto', id: data.id, provedor, threads: ort.env.wasm.numThreads });
    } else if (data.tipo === 'detectar') {
      self.postMessage({ tipo: 'deteccoes', id: data.id, ...(await detectar(data)) });
    }
  } catch (e) {
    self.postMessage({ tipo: 'erro', id: data.id, mensagem: String(e && e.message ? e.message : e) });
  }
};
