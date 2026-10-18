// sons.js
// ---------------------------------------------------------------
// Efeitos sonoros SINTETIZADOS com Web Audio (não há arquivos de áudio).
// Este módulo é compartilhado: a ui.js usa somCompra/somEntradaRara e a
// fusao_animacoes.js usa os "tijolos" audio(), ruido() e tom().
//
// Ideia para entender o código: todo som é feito de dois tijolos.
//   * tom():   um oscilador (onda) que desliza de uma frequência para outra
//   * ruido(): ruído branco passado por um filtro (dá "chiado", "estalo", "vento")
// Misturando os dois com tempos diferentes saem sons de carta, brilho, trovão etc.
// ---------------------------------------------------------------

let ctxAudio = null;
let ligado = true; // opção "Efeitos sonoros" (menu.js chama definirSons)

export function definirSons(valor) { ligado = !!valor; }
export function sonsAtivos() { return ligado; }

// Contexto de áudio (criado no primeiro uso, depois de um clique do jogador, como os navegadores exigem).
export function audio() {
  try {
    ctxAudio = ctxAudio ?? new (window.AudioContext || window.webkitAudioContext)();
    if (ctxAudio.state === 'suspended') ctxAudio.resume();
    return ctxAudio;
  } catch (e) {
    return null; // sem áudio: o jogo segue mudo
  }
}

export function ruido(ac, quando, dur, tipoFiltro, freq, ganho, freqFim = null) {
  const n = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const fonte = ac.createBufferSource();
  fonte.buffer = buf;
  const filtro = ac.createBiquadFilter();
  filtro.type = tipoFiltro;
  filtro.frequency.setValueAtTime(freq, quando);
  if (freqFim) filtro.frequency.exponentialRampToValueAtTime(freqFim, quando + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(ganho, quando);
  g.gain.exponentialRampToValueAtTime(0.0001, quando + dur);
  fonte.connect(filtro).connect(g).connect(ac.destination);
  fonte.start(quando);
}

export function tom(ac, quando, dur, tipo, f0, f1, ganho) {
  const o = ac.createOscillator();
  o.type = tipo;
  o.frequency.setValueAtTime(f0, quando);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), quando + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, quando);
  g.gain.exponentialRampToValueAtTime(ganho, quando + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, quando + dur);
  o.connect(g).connect(ac.destination);
  o.start(quando);
  o.stop(quando + dur + 0.05);
}

// Carta saindo do deck: um "frrt" de papel deslizando + um toque seco quando ela cai na mão.
export function somCompra() {
  if (!ligado) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  ruido(ac, t, 0.16, 'bandpass', 1800, 0.22, 5200);
  ruido(ac, t + 0.12, 0.05, 'highpass', 3000, 0.12);
  tom(ac, t + 0.13, 0.07, 'triangle', 420, 260, 0.05);
}

// Entrada de monstro raro no campo. Super raro: acorde brilhante. Lendário: trovão + coro + brilho.
export function somEntradaRara(raridade) {
  if (!ligado) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  if (raridade === 'super_rara') {
    ruido(ac, t, 0.5, 'highpass', 2500, 0.2, 7000);
    // acorde maior ascendente (lá, dó#, mi) com estrela no final
    [[440, 0], [554, 0.08], [659, 0.16]].forEach(([f, dt]) => tom(ac, t + dt, 0.9, 'triangle', f, f * 1.005, 0.12));
    tom(ac, t + 0.3, 0.8, 'sine', 1760, 1750, 0.08);
  } else if (raridade === 'lendaria') {
    // impacto grave (trovão)
    ruido(ac, t, 1.3, 'lowpass', 900, 0.55, 80);
    tom(ac, t, 1.1, 'sawtooth', 110, 40, 0.2);
    // coro: três vozes que sobem juntas
    [220, 277, 330, 440].forEach((f, i) => tom(ac, t + 0.25 + i * 0.07, 1.6, 'sawtooth', f * 0.98, f, 0.045));
    // brilho final em duas camadas
    ruido(ac, t + 0.35, 0.9, 'highpass', 3500, 0.22, 9000);
    [880, 1318, 1760].forEach((f, i) => tom(ac, t + 0.4 + i * 0.06, 1.4, 'sine', f, f * 1.01, 0.09));
  }
}
