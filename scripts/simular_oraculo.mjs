// Simulação rápida das políticas com o detector "oráculo" (caixas reais), só no Node.
// Uso: node scripts/simular_oraculo.mjs [--sementes 10] [--duracao 30]
import { rodarEpisodio, detectorOraculo } from '../web/src/agente/episodio.js';
import { POLITICAS } from '../web/src/agente/politicas.js';

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? Number(process.argv[i + 1]) : padrao;
};
const sementes = arg('sementes', 10);
const duracao = arg('duracao', 30);
console.log(`latência | ${Object.values(POLITICAS).join(' | ')}  (precisão, ${sementes} episódios de ${duracao}s)`);
for (const latencia of [0, 0.05, 0.1, 0.2, 0.3]) {
  const cel = [];
  for (const politica of Object.keys(POLITICAS)) {
    let acertos = 0;
    let tiros = 0;
    for (let semente = 1; semente <= sementes; semente++) {
      const r = await rodarEpisodio({ semente, duracao, latencia, politica, detectar: detectorOraculo(), classesAlvo: ['ave'] });
      acertos += r.acertos;
      tiros += r.tiros;
    }
    cel.push(`${((100 * acertos) / Math.max(tiros, 1)).toFixed(0)}%`);
  }
  console.log(`${String(latencia * 1000).padStart(5)} ms | ${cel.join(' | ')}`);
}
