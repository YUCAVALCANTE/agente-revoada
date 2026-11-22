// Gerador pseudoaleatório determinístico (mulberry32).
// Toda a aleatoriedade do jogo passa por aqui, então a mesma semente
// gera exatamente a mesma partida no navegador e no Node.

export function criarRng(semente) {
  let a = semente >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.entre = (min, max) => min + (max - min) * rng();
  rng.inteiro = (min, max) => Math.floor(rng.entre(min, max + 1));
  rng.escolher = (lista) => lista[Math.floor(rng() * lista.length)];
  rng.normal = () => {
    const u = Math.max(rng(), 1e-12);
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return rng;
}
