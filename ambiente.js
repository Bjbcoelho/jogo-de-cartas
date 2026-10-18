// ambiente.js — ÁUDIO AMBIENTE E TRILHA SUAVE DE CADA CENÁRIO
// ---------------------------------------------------------------
// Tudo é SINTETIZADO com Web Audio (nenhum arquivo de áudio, nada de licença externa).
// Cada cenário é uma "receita" que mistura três ingredientes:
//   1) CAMADAS CONTÍNUAS: ruído filtrado (vento, mar, rugido) e zumbidos graves (drones);
//   2) EVENTOS ALEATÓRIOS: pios, estalos de gelo, sinos de pedra... sorteados de tempos em tempos;
//   3) TRILHA: um "pad" de acordes lentos (notas longas e macias) com eco (reverb).
// Quando o campo muda, o som antigo some devagar enquanto o novo aparece (crossfade).
// O vento de Marte acompanha as rajadas da poeira que passa na tela (forcaVento() do clima.js).
//
// Para criar/ajustar um ambiente: edite a receita dele em RECEITAS, mais abaixo.
// ---------------------------------------------------------------

import { audio } from './sons.js';
import { forcaVento } from './clima.js';

export const NOMES_AMBIENTE = ['padrao', 'marte', 'terra', 'europa', 'floresta', 'cidade', 'solar'];
const FATOR_VOLUME = { baixo: 0.5, medio: 1, alto: 1.6 };
const VOLUME_BASE = 0.5;
// Ajuste de volume de cada cenário: os sons têm "forças" diferentes (o rugido do sol é bem mais alto que
// a noite arcana), então multiplicamos cada um por um fator para todos soarem parecidos.
export const NIVEL_CENARIO = { padrao: 1.9, marte: 0.85, terra: 0.62, europa: 0.85, floresta: 1.3, cidade: 1.25, solar: 0.4 };

// ---------- Utilidades ----------
const rand = (a, b) => a + Math.random() * (b - a);
const escolher = (lista) => lista[Math.floor(Math.random() * lista.length)];

// Buffers de ruído (guardados por contexto para não recriar toda hora).
const cacheRuido = new WeakMap();
function bufferRuido(ac, tipo) {
  const guarda = cacheRuido.get(ac) ?? {};
  cacheRuido.set(ac, guarda);
  if (guarda[tipo]) return guarda[tipo];
  const n = ac.sampleRate * 4;
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  let ultimo = 0;
  for (let i = 0; i < n; i++) {
    const branco = Math.random() * 2 - 1;
    if (tipo === 'marrom') { ultimo = (ultimo + 0.02 * branco) / 1.02; d[i] = ultimo * 3.5; } // grave e "encorpado"
    else d[i] = branco;
  }
  guarda[tipo] = buf;
  return buf;
}

// Eco de ambiente (reverb): resposta de impulso = ruído que decai.
const cacheReverb = new WeakMap();
function reverbPara(ac) {
  // O buffer (a "sala") é criado uma vez por contexto; cada grupo ganha seu próprio ConvolverNode.
  if (!cacheReverb.has(ac)) cacheReverb.set(ac, criarImpulso(ac));
  const conv = ac.createConvolver();
  conv.buffer = cacheReverb.get(ac);
  return conv;
}
function criarImpulso(ac) {
  const dur = 2.6;
  const n = Math.floor(ac.sampleRate * dur);
  const ir = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
  }
  return ir;
}

// ---------- Grupo: tudo de um cenário, com uma saída única (para o crossfade) ----------
function criarGrupo(ac, destino, nome) {
  const saida = ac.createGain();
  saida.gain.value = 0;
  saida.connect(destino);
  const envioRev = ac.createGain();
  envioRev.gain.value = 0.4;
  const rev = reverbPara(ac);
  envioRev.connect(rev);
  rev.connect(saida); // o eco também passa pela saída do grupo: some junto no crossfade
  const G = { ac, saida, envioRev, fontes: [], agendadores: [], aoVento: [] };
  G.camadaRuido = (tipo, filtro, ganho) => {
    const f = ac.createBufferSource();
    f.buffer = bufferRuido(ac, tipo);
    f.loop = true;
    f.loopStart = Math.random() * 2;
    const fil = ac.createBiquadFilter();
    fil.type = filtro.tipo; fil.frequency.value = filtro.freq; fil.Q.value = filtro.q ?? 0.7;
    const g = ac.createGain();
    g.gain.value = ganho;
    f.connect(fil).connect(g).connect(saida);
    f.start();
    G.fontes.push(f);
    return { fil, g };
  };
  G.osc = (tipo, freq, ganho, destinoNo = saida) => {
    const o = ac.createOscillator();
    o.type = tipo; o.frequency.value = freq;
    const g = ac.createGain();
    g.gain.value = ganho;
    o.connect(g).connect(destinoNo);
    o.start();
    G.fontes.push(o);
    return { o, g };
  };
  // LFO: um oscilador lento que "mexe" num parâmetro (ex.: o volume do mar sobe e desce)
  G.lfo = (freq, profundidade, parametro, tipo = 'sine') => {
    const o = ac.createOscillator();
    o.type = tipo; o.frequency.value = freq;
    const g = ac.createGain();
    g.gain.value = profundidade;
    o.connect(g).connect(parametro);
    o.start();
    G.fontes.push(o);
  };
  RECEITAS[nome](G);
  return {
    saida, G,
    agendar(t0, t1) { for (const a of G.agendadores) a(t0, t1); },
    vento(v, t) { for (const f of G.aoVento) f(v, t); },
    parar(t) { for (const s of G.fontes) { try { s.stop(t); } catch (e) { /* já parou */ } } },
  };
}

// Sorteia eventos de tempos em tempos: fn(tempo) é chamada em cada evento.
function aleatorios(G, minimo, maximo, fn) {
  let prox = null;
  G.agendadores.push((t0, t1) => {
    if (prox === null) prox = t0 + rand(minimo, maximo) * 0.5;
    while (prox < t1) { fn(Math.max(prox, t0)); prox += rand(minimo, maximo); }
  });
}

// Trilha: acordes lentos, cada nota com subida suave e descida longa.
function pad(G, acordes, { tipo = 'triangle', corte = 900, ganho = 0.05, duracao = 12 } = {}) {
  const { ac } = G;
  const filtro = ac.createBiquadFilter();
  filtro.type = 'lowpass'; filtro.frequency.value = corte; filtro.Q.value = 0.5;
  const bus = ac.createGain();
  bus.gain.value = 1;
  filtro.connect(bus);
  bus.connect(G.saida);
  bus.connect(G.envioRev);
  let prox = null, i = 0;
  G.agendadores.push((t0, t1) => {
    if (prox === null) prox = t0;
    while (prox < t1) {
      const t = Math.max(prox, t0);
      for (const f of acordes[i % acordes.length]) {
        for (const desafina of [-7, 7]) {
          const o = ac.createOscillator();
          o.type = tipo; o.frequency.value = f; o.detune.value = desafina + rand(-3, 3);
          const g = ac.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(ganho, t + duracao * 0.38);
          g.gain.setValueAtTime(ganho, t + duracao * 0.62);
          g.gain.exponentialRampToValueAtTime(0.0001, t + duracao * 1.25);
          o.connect(g).connect(filtro);
          o.start(t); o.stop(t + duracao * 1.3);
        }
      }
      i += 1;
      prox += duracao;
    }
  });
}

// Notas soltas com decaimento (sinos, pings, pios): sempre passam pelo eco.
function nota(G, t, freq, dur, tipo, ganho, parciais = []) {
  const { ac } = G;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(ganho, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(G.saida);
  g.connect(G.envioRev);
  for (const [mult, vol] of [[1, 1], ...parciais]) {
    const o = ac.createOscillator();
    o.type = tipo; o.frequency.value = freq * mult;
    const gp = ac.createGain();
    gp.gain.value = vol;
    o.connect(gp).connect(g);
    o.start(t); o.stop(t + dur + 0.05);
  }
}

function estalo(G, t, freq, q, ganho, dur = 0.02) {
  const { ac } = G;
  const f = ac.createBufferSource();
  f.buffer = bufferRuido(ac, 'branco');
  const fil = ac.createBiquadFilter();
  fil.type = 'bandpass'; fil.frequency.value = freq; fil.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(ganho, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(fil).connect(g).connect(G.saida);
  f.start(t, Math.random() * 3, dur + 0.02);
}

// ---------- As receitas de cada cenário ----------
const RECEITAS = {
  // Arena padrão: noite arcana, pad brilhante e sininhos de cristal
  padrao(G) {
    const v = G.camadaRuido('marrom', { tipo: 'lowpass', freq: 300 }, 0.12);
    G.lfo(0.07, 0.05, v.g.gain);
    pad(G, [[130.8, 196, 261.6, 311.1], [116.5, 174.6, 233.1, 293.7], [103.8, 155.6, 207.7, 261.6]], { tipo: 'sawtooth', corte: 700, ganho: 0.016, duracao: 14 });
    aleatorios(G, 2.5, 6, (t) => nota(G, t, escolher([523, 622, 698, 784, 932, 1047]), 3.2, 'sine', 0.035, [[2.01, 0.25]]));
  },

  // Marte: vento forte com poeira, grave profundo e um pad sombrio
  marte(G) {
    const vento = G.camadaRuido('marrom', { tipo: 'bandpass', freq: 420, q: 0.8 }, 0.5);
    const poeira = G.camadaRuido('branco', { tipo: 'highpass', freq: 3200, q: 0.5 }, 0.025);
    const uivo = G.camadaRuido('branco', { tipo: 'bandpass', freq: 900, q: 6 }, 0.04);
    G.lfo(0.13, 0.12, vento.g.gain);            // vento "respirando" sozinho
    G.lfo(9, 0.012, poeira.g.gain);             // grãos de areia batendo (textura)
    G.lfo(0.21, 260, uivo.fil.frequency);       // assobio que sobe e desce
    G.osc('sine', 46, 0.07);
    G.osc('sine', 69, 0.03);
    // As rajadas acompanham a poeira da tela
    G.aoVento.push((v, t) => {
      vento.fil.frequency.setTargetAtTime(260 + 700 * v, t, 0.25);
      vento.g.gain.setTargetAtTime(0.28 + 0.5 * v, t, 0.25);
      poeira.g.gain.setTargetAtTime(0.012 + 0.06 * v, t, 0.2);
      uivo.g.gain.setTargetAtTime(0.01 + 0.07 * v * v, t, 0.3);
    });
    pad(G, [[110, 164.8, 220, 261.6], [98, 146.8, 196, 233.1], [87.3, 130.8, 174.6, 207.7]], { tipo: 'triangle', corte: 520, ganho: 0.024, duracao: 15 });
    aleatorios(G, 14, 28, (t) => nota(G, t, escolher([880, 1175, 1568]), 4, 'sine', 0.02, [[2.76, 0.3]])); // "ping" metálico distante
  },

  // Terra: ondas do mar, brisa e passarinhos
  terra(G) {
    const mar = G.camadaRuido('marrom', { tipo: 'lowpass', freq: 650 }, 0.3);
    const espuma = G.camadaRuido('branco', { tipo: 'highpass', freq: 2200 }, 0.03);
    G.lfo(0.11, 0.2, mar.g.gain);
    G.lfo(0.11, 0.025, espuma.g.gain);
    const brisa = G.camadaRuido('marrom', { tipo: 'bandpass', freq: 520, q: 0.6 }, 0.1);
    G.lfo(0.05, 0.05, brisa.g.gain);
    pad(G, [[130.8, 196, 261.6, 329.6], [110, 164.8, 220, 277.2], [123.5, 185, 246.9, 311.1]], { tipo: 'triangle', corte: 1100, ganho: 0.02, duracao: 13 });
    aleatorios(G, 2, 6, (t) => {
      const f = rand(2300, 3300);
      const n = Math.floor(rand(2, 4));
      for (let i = 0; i < n; i++) nota(G, t + i * 0.11, f * rand(0.92, 1.12), 0.09, 'sine', 0.03);
    });
  },

  // Europa: vento gelado, gelo estalando e um pad frio
  europa(G) {
    const vento = G.camadaRuido('branco', { tipo: 'bandpass', freq: 1000, q: 2.5 }, 0.07);
    G.lfo(0.08, 550, vento.fil.frequency);
    G.lfo(0.11, 0.035, vento.g.gain);
    const grave = G.camadaRuido('marrom', { tipo: 'lowpass', freq: 260 }, 0.22);
    G.lfo(0.06, 0.08, grave.g.gain);
    G.osc('sine', 41, 0.06);
    G.osc('sine', 55.3, 0.035);
    pad(G, [[220, 329.6, 493.9], [196, 293.7, 440], [174.6, 261.6, 392]], { tipo: 'triangle', corte: 1400, ganho: 0.02, duracao: 16 });
    aleatorios(G, 3, 9, (t) => {
      estalo(G, t, rand(2800, 4500), 9, 0.16, 0.012);                 // rachadura seca
      nota(G, t + 0.02, rand(700, 1300), 1.2, 'sine', 0.035, [[2.4, 0.3]]); // ressonância no gelo
    });
  },

  // Floresta: grilos, folhas, vento nas copas e uma coruja
  floresta(G) {
    for (let k = 0; k < 3; k++) {
      const grilo = G.osc('sine', rand(4100, 4700), 0, G.saida);
      // o grilo "cricrila": o volume liga e desliga ~28 vezes por segundo, em rajadas
      G.lfo(rand(24, 32), 0.012, grilo.g.gain, 'square');
      G.lfo(rand(0.6, 1.1), 0.009, grilo.g.gain, 'square');
      grilo.g.gain.value = 0.006;
    }
    const folhas = G.camadaRuido('branco', { tipo: 'bandpass', freq: 3200, q: 0.5 }, 0.02);
    G.lfo(0.17, 0.012, folhas.g.gain);
    const copas = G.camadaRuido('marrom', { tipo: 'lowpass', freq: 420 }, 0.15);
    G.lfo(0.09, 0.07, copas.g.gain);
    pad(G, [[146.8, 220, 293.7, 369.99], [130.8, 196, 261.6, 329.6], [110, 164.8, 220, 277.2]], { tipo: 'triangle', corte: 950, ganho: 0.022, duracao: 14 });
    aleatorios(G, 18, 38, (t) => { nota(G, t, 392, 0.55, 'sine', 0.05); nota(G, t + 0.7, 349, 0.9, 'sine', 0.045); }); // coruja
  },

  // Cidade antiga: vento quente, areia, sinos de pedra e tambor distante
  cidade(G) {
    const vento = G.camadaRuido('marrom', { tipo: 'bandpass', freq: 520, q: 0.5 }, 0.3);
    G.lfo(0.1, 0.12, vento.g.gain);
    const areia = G.camadaRuido('branco', { tipo: 'highpass', freq: 3800 }, 0.014);
    G.lfo(0.19, 0.008, areia.g.gain);
    G.osc('sine', 55, 0.04);
    pad(G, [[110, 164.8, 220, 261.6], [98, 146.8, 196, 246.9], [123.5, 185, 233.1, 277.2]], { tipo: 'sawtooth', corte: 480, ganho: 0.013, duracao: 15 });
    aleatorios(G, 4, 9, (t) => nota(G, t, escolher([587, 659, 784, 880, 988]), 3.8, 'sine', 0.045, [[2.76, 0.35], [5.4, 0.12]])); // sinos de pedra
    aleatorios(G, 10, 18, (t) => nota(G, t, 70, 0.6, 'sine', 0.12));                                                                 // tambor longe
  },

  // Tempestade Solar: rugido de fogo, estalos e calor tremendo
  solar(G) {
    const rugido = G.camadaRuido('marrom', { tipo: 'lowpass', freq: 240 }, 0.55);
    G.lfo(0.07, 0.2, rugido.g.gain);
    const calor = G.camadaRuido('branco', { tipo: 'highpass', freq: 5500 }, 0.012);
    G.lfo(3.1, 0.008, calor.g.gain);
    G.osc('sine', 38, 0.1);
    const pulso = G.osc('sine', 76, 0.03);
    G.lfo(0.5, 0.025, pulso.g.gain);
    pad(G, [[98, 138.6, 196], [92.5, 130.8, 185], [87.3, 123.5, 174.6]], { tipo: 'sawtooth', corte: 420, ganho: 0.014, duracao: 12 });
    aleatorios(G, 0.12, 0.5, (t) => estalo(G, t, rand(1800, 4200), 2, rand(0.04, 0.12), 0.015));
  },
};

// ---------- Controle em tempo real ----------
let ligado = true;
let volume = 'medio';
let desejado = null;           // cenário que deveria estar tocando (mesmo com o ambiente desligado)
let atual = null;              // { nome, grupo, temporizador, vento }
let mestreGain = null;
let ctxMestre = null;

function mestre(ac) {
  if (mestreGain && ctxMestre === ac) return mestreGain;
  ctxMestre = ac;
  mestreGain = ac.createGain();
  mestreGain.gain.value = VOLUME_BASE * FATOR_VOLUME[volume];
  mestreGain.connect(ac.destination);
  return mestreGain;
}

function aplicarVolume() {
  if (mestreGain && ctxMestre) mestreGain.gain.setTargetAtTime(ligado ? VOLUME_BASE * FATOR_VOLUME[volume] : 0, ctxMestre.currentTime, 0.2);
}

function encerrar(sessao, fade = 2.5) {
  if (!sessao) return;
  const ac = ctxMestre;
  clearInterval(sessao.temporizador);
  clearInterval(sessao.vento);
  const t = ac.currentTime;
  sessao.grupo.saida.gain.cancelScheduledValues(t);
  sessao.grupo.saida.gain.setValueAtTime(sessao.grupo.saida.gain.value, t);
  sessao.grupo.saida.gain.linearRampToValueAtTime(0, t + fade);
  sessao.grupo.parar(t + fade + 0.1);
  setTimeout(() => { try { sessao.grupo.saida.disconnect(); sessao.niv?.disconnect(); } catch (e) { /* já solto */ } }, (fade + 3.5) * 1000);
}

export function definirAmbiente(valor) {
  ligado = !!valor;
  aplicarVolume();
  if (!ligado) { encerrar(atual, 0.6); atual = null; }
  else if (desejado && !atual) tocarAmbiente(desejado);
}

export function definirVolumeAmbiente(v) {
  volume = FATOR_VOLUME[v] ? v : 'medio';
  aplicarVolume();
}

export function ambienteAtivo() { return ligado; }
export function ambienteAtual() { return atual?.nome ?? null; }

export function tocarAmbiente(nome) {
  if (!RECEITAS[nome]) return;
  desejado = nome;
  if (!ligado) return;
  if (atual?.nome === nome) return;
  const ac = audio();
  if (!ac) return;
  try {
    const anterior = atual;
    const niv = ac.createGain();
    niv.gain.value = NIVEL_CENARIO[nome] ?? 1;
    niv.connect(mestre(ac));
    const grupo = criarGrupo(ac, niv, nome);
    const t = ac.currentTime;
    grupo.saida.gain.setValueAtTime(0, t);
    grupo.saida.gain.linearRampToValueAtTime(1, t + 2.5);
    grupo.agendar(t, t + 14);
    const sessao = { nome, grupo, niv };
    sessao.temporizador = setInterval(() => grupo.agendar(ac.currentTime, ac.currentTime + 14), 5000);
    sessao.vento = setInterval(() => grupo.vento(forcaVento(), ac.currentTime), 90);
    atual = sessao;
    encerrar(anterior);
  } catch (e) {
    console.warn('Ambiente sonoro indisponível:', e);
  }
}

export function pararAmbiente() {
  desejado = null;
  encerrar(atual, 1.2);
  atual = null;
}

// Pausa o som quando a aba fica escondida e volta quando ela reaparece.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const ac = ctxMestre;
    if (!ac) return;
    if (document.hidden) ac.suspend(); else if (atual) ac.resume();
  });
}

// ---------- Teste sem alto-falante ----------
// Renderiza "segundos" de um ambiente num contexto offline e devolve medidas do som.
export async function medirAmbiente(nome, segundos = 5, taxa = 22050) {
  const ac = new OfflineAudioContext(2, taxa * segundos, taxa);
  const saida = ac.createGain();
  saida.gain.value = VOLUME_BASE * (NIVEL_CENARIO[nome] ?? 1);
  saida.connect(ac.destination);
  const grupo = criarGrupo(ac, saida, nome);
  grupo.saida.gain.value = 1;
  grupo.agendar(0, segundos);
  grupo.vento(0.6, 0);
  const buf = await ac.startRendering();
  const dados = buf.getChannelData(0);
  let soma = 0, pico = 0;
  for (let i = 0; i < dados.length; i++) { soma += dados[i] * dados[i]; pico = Math.max(pico, Math.abs(dados[i])); }
  return { nome, rms: Math.sqrt(soma / dados.length), pico, valido: Number.isFinite(soma) };
}
