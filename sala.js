// sala.js — SALA DE TESTES
// ---------------------------------------------------------------
// Abra o jogo com  index.html?sala  (por um servidor local) e aperte Enter na tela de título.
// Aparece um painel com ferramentas para você VER e TESTAR o jogo sem jogar uma partida inteira:
//   • Cenários: troca o campo (padrão, Marte, Terra, Europa, Floresta, Cidade).
//   • Vitrine: enche a mesa com cartas de todas as raridades para olhar o visual.
//   • IA × IA: duelo automático na tela (você só assiste) e simulação rápida de várias partidas.
//   • Galeria: todas as cartas do jogo numa grade, com filtros.
//   • Verificações: roda uma bateria de testes no navegador e mostra ✔ ou ✘.
// Com  index.html?sala&auto  as verificações rodam sozinhas ao abrir (o teste_navegador.mjs usa isso).
// ---------------------------------------------------------------

import { criarEstado } from './game_state.js';
import { comecarPartida } from './turn_system.js';
import { jogarTurnoIA } from './ai_opponent.js';
import { montarDeckAleatorio } from './deck_builder.js';
import { iniciarDuelo } from './ui.js';
import { NOMES_AMBIENTE, medirAmbiente } from './ambiente.js';
import { definirCenarioClima, definirQualidade, infoClima, medirCustoClima } from './clima.js';

const $ = (id) => document.getElementById(id);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Carta de campo de cada cenário (o cenário padrão é "sem campo").
const CAMPOS = {
  padrao: null,
  marte: 'campo_cratera_de_marte',
  terra: 'campo_base_de_lancamento_orbital',
  europa: 'campo_mar_de_europa',
  floresta: 'campo_floresta_ancestral',
  cidade: 'campo_cidade_antiga',
  solar: 'campo_tempestade_solar',
};

function el(tag, classes = '', texto = '') {
  const e = document.createElement(tag);
  if (classes) e.className = classes;
  if (texto) e.textContent = texto;
  return e;
}

const R = () => window.__rbc; // gancho exposto pela ui.js quando a página tem ?sala

// ---------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------

// Garante que existe um duelo na tela (cria um se preciso).
function garantirDuelo() {
  if (!R().estado) iniciarDuelo({ contraIA: false, deckJ1: 'aleatorio', deckJ2: 'aleatorio', quemComeca: 'jogador1' });
  return R().estado;
}

function slotMonstro(id, uid, dono, posicao = 'ataque') {
  return {
    carta: { ...structuredClone(R().criarCartaPorId(id)), uid, dono },
    posicao, viradaParaBaixo: false, equipamento: null,
    invocadoNesteTurno: false, jaAtacou: false, mudouPosicao: false,
  };
}

export function definirCenario(nome) {
  const estado = garantirDuelo();
  const id = CAMPOS[nome];
  estado.cartaCampo = id ? { ...structuredClone(R().criarCartaPorId(id)), uid: `campo-${nome}`, dono: 0 } : null;
  R().renderizar();
}

// Primeira carta de cada raridade (monstros), para a vitrine.
function cartasPorRaridade() {
  const todas = Object.values(R().cartasPorId);
  const achar = (rar, tipo = 'monstro') => todas.find((c) => c.tipo === tipo && (c.raridade ?? 'comum') === rar);
  return ['comum', 'rara', 'super_rara', 'lendaria'].map((r) => achar(r) ?? achar(r, 'fusao')).filter(Boolean);
}

export function montarVitrine() {
  const estado = garantirDuelo();
  const lista = cartasPorRaridade();
  const fusoes = Object.values(R().cartasPorId).filter((c) => c.tipo === 'fusao');
  const magias = Object.values(R().cartasPorId).filter((c) => c.tipo === 'magia' || c.tipo === 'armadilha' || c.tipo === 'equipamento');
  for (const idJ of [0, 1]) {
    const j = estado.jogadores[idJ];
    j.zona_monstros = new Array(5).fill(null);
    j.zona_magias_armadilhas = new Array(5).fill(null);
    lista.slice(0, 4).forEach((c, i) => { j.zona_monstros[i] = slotMonstro(c.id, `vit-m${idJ}${i}`, idJ, i === 3 && idJ === 1 ? 'defesa' : 'ataque'); });
    if (fusoes[idJ]) j.zona_monstros[4] = slotMonstro(fusoes[idJ].id, `vit-f${idJ}`, idJ);
    magias.slice(idJ * 5, idJ * 5 + 5).forEach((c, i) => {
      j.zona_magias_armadilhas[i] = { carta: { ...structuredClone(c), uid: `vit-s${idJ}${i}`, dono: idJ }, viradaParaBaixo: c.tipo === 'armadilha', turnoBaixada: 0 };
    });
  }
  R().renderizar();
}

// ---------------------------------------------------------------
// IA × IA
// ---------------------------------------------------------------
let autoAtivo = false;
let velocidade = 600;

async function duelarAutomatico() {
  if (autoAtivo) { autoAtivo = false; return; }
  autoAtivo = true;
  atualizarBotaoAuto();
  iniciarDuelo({ contraIA: false, deckJ1: 'aleatorio', deckJ2: 'aleatorio', quemComeca: 'jogador1' });
  R().definirIA(true); // mantém o jogador 1 sempre embaixo, sem virar a mesa a cada turno
  const estado = R().estado;
  const registro = $('log');
  while (autoAtivo && estado.vencedor === null && estado.turno < 80) {
    const vez = estado.jogadorDaVez;
    await jogarTurnoIA(estado, vez, {
      nivel: 4, atrasoMs: velocidade, nome: `J${vez + 1} (IA)`,
      aoAgir: (t) => { const li = el('li', '', t); registro.appendChild(li); registro.scrollTop = registro.scrollHeight; R().renderizar(); },
      aguardar: () => (autoAtivo ? null : Promise.reject(new Error('parado'))),
    }).catch(() => {});
    R().renderizar();
    await pausa(velocidade);
  }
  autoAtivo = false;
  atualizarBotaoAuto();
}

function atualizarBotaoAuto() {
  const b = $('sala-auto');
  if (b) b.textContent = autoAtivo ? '⏹ Parar duelo' : '▶ Duelo IA × IA';
}

// Simula vários duelos sem desenhar nada. Devolve estatísticas.
export async function simularRapido(n, aoProgredir = () => {}) {
  const resultado = { partidas: n, vitorias: [0, 0], empates: 0, semFim: 0, erros: 0, turnos: 0, primeiroErro: null };
  for (let i = 0; i < n; i++) {
    try {
      const d0 = montarDeckAleatorio(R().cartasPorId);
      const d1 = montarDeckAleatorio(R().cartasPorId);
      const e = criarEstado(d0.deckPrincipal, d0.deckExtra, d1.deckPrincipal, d1.deckExtra, R().cartasPorId);
      comecarPartida(e);
      while (e.vencedor === null && e.turno < 120) {
        const r = await jogarTurnoIA(e, e.jogadorDaVez, { nivel: 3 });
        if (r.length === 1 && /tentou jogar|esperava/.test(r[0])) throw new Error(r[0]);
      }
      if (e.vencedor === 0 || e.vencedor === 1) resultado.vitorias[e.vencedor] += 1;
      else if (e.vencedor === 'empate') resultado.empates += 1;
      else resultado.semFim += 1;
      resultado.turnos += e.turno;
    } catch (erro) {
      resultado.erros += 1;
      resultado.primeiroErro ??= String(erro.message ?? erro);
    }
    aoProgredir(i + 1, n);
    if (i % 5 === 4) await pausa(0); // deixa a página respirar
  }
  resultado.turnosMedios = Math.round(resultado.turnos / Math.max(1, n));
  return resultado;
}

// ---------------------------------------------------------------
// Galeria
// ---------------------------------------------------------------
function abrirGaleria() {
  let tela = $('sala-galeria');
  if (tela) { tela.remove(); return; }
  tela = el('div');
  tela.id = 'sala-galeria';
  const topo = el('div', 'topo');
  const grade = el('div', 'grade');
  const filtros = { tipo: 'todos', raridade: 'todas' };
  const redesenhar = () => {
    grade.innerHTML = '';
    const cartas = Object.values(R().cartasPorId).filter((c) =>
      (filtros.tipo === 'todos' || c.tipo === filtros.tipo) && (filtros.raridade === 'todas' || (c.raridade ?? 'comum') === filtros.raridade));
    for (const c of cartas) grade.appendChild(R().criarCartaEl(c));
    contador.textContent = `${cartas.length} cartas`;
  };
  const seletor = (chave, opcoes) => {
    const s = el('select');
    for (const o of opcoes) s.appendChild(new Option(o, o));
    s.addEventListener('change', () => { filtros[chave] = s.value; redesenhar(); });
    return s;
  };
  const contador = el('span', 'contador');
  const fechar = el('button', '', '✕ Fechar');
  fechar.addEventListener('click', () => tela.remove());
  topo.append(el('b', '', 'Galeria'), seletor('tipo', ['todos', 'monstro', 'fusao', 'magia', 'equipamento', 'armadilha', 'campo']),
    seletor('raridade', ['todas', 'comum', 'rara', 'super_rara', 'lendaria']), contador, fechar);
  tela.append(topo, grade);
  document.body.appendChild(tela);
  redesenhar();
}

// ---------------------------------------------------------------
// Verificações automáticas
// ---------------------------------------------------------------
// Cada verificação devolve { nome, ok, detalhe }.
async function verificarCartas() {
  const problemas = [];
  const caixa = el('div');
  caixa.style.cssText = 'position:fixed;left:-9999px;top:0;display:flex;flex-wrap:wrap;';
  document.body.appendChild(caixa);
  const cartas = Object.values(R().cartasPorId);
  for (const c of cartas) {
    const e = R().criarCartaEl(c, { semHover: true });
    caixa.appendChild(e);
    if (!c.nome?.trim()) problemas.push(`${c.id}: sem nome`);
    if (!c.imagem && !c.icone) problemas.push(`${c.id}: sem ícone nem imagem`);
    if (!c.raridade) problemas.push(`${c.id}: sem raridade`);
    if (!/rar-(comum|rara|super_rara|lendaria)/.test(e.className)) problemas.push(`${c.id}: classe de raridade ausente`);
    const nome = e.querySelector('.nome');
    if (nome && nome.scrollHeight > nome.clientHeight + 2) problemas.push(`${c.id}: nome "${c.nome}" estoura a faixa`);
    if ((c.tipo === 'monstro' || c.tipo === 'fusao') && !e.querySelector('.stats')) problemas.push(`${c.id}: sem ATK/DEF`);
  }
  caixa.remove();
  return { nome: `Todas as ${cartas.length} cartas desenham certo (nome, ícone, raridade, stats)`, ok: problemas.length === 0, detalhe: problemas.slice(0, 6).join(' | ') };
}

async function verificarCenarios() {
  const falhas = [];
  const estilo = el('style', '', '.cenario, #tabuleiro::before { transition: none !important; }');
  document.head.appendChild(estilo);
  for (const nome of Object.keys(CAMPOS)) {
    definirCenario(nome);
    await pausa(80);
    const mesa = $('mesa');
    if (mesa.dataset.cenario !== nome) { falhas.push(`${nome}: data-cenario = ${mesa.dataset.cenario}`); continue; }
    if (nome !== 'padrao') {
      const camada = mesa.querySelector(`.cen-${nome}`);
      if (!camada || getComputedStyle(camada).opacity !== '1') falhas.push(`${nome}: camada do cenário não ficou visível`);
    }
  }
  definirCenario('padrao');
  estilo.remove();
  return { nome: 'Os 7 cenários trocam e aparecem', ok: falhas.length === 0, detalhe: falhas.join(' | ') };
}

async function verificarMesa() {
  montarVitrine();
  await pausa(150);
  const falhas = [];
  const mesa = $('mesa').getBoundingClientRect();
  const slots = [...document.querySelectorAll('#tabuleiro .slot')];
  if (slots.length !== 20) falhas.push(`esperava 20 zonas, achei ${slots.length}`);
  for (const s of slots) {
    const r = s.getBoundingClientRect();
    if (r.left < mesa.left - 1 || r.right > mesa.right + 1 || r.top < mesa.top - 1 || r.bottom > mesa.bottom + 1) { falhas.push('uma zona saiu da mesa'); break; }
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1) falhas.push('a página tem rolagem horizontal');
  const lendarias = document.querySelectorAll('#tabuleiro .slot > .carta.rar-lendaria').length;
  if (lendarias === 0) falhas.push('a vitrine não mostrou nenhuma lendária');
  const mao = document.querySelector('#mao-inf');
  const rm = mao?.getBoundingClientRect();
  if (rm && rm.top > window.innerHeight) falhas.push('a mão ficou fora da tela');
  return { nome: 'Mesa: 20 zonas dentro da tela, sem rolagem lateral, lendária presente', ok: falhas.length === 0, detalhe: falhas.join(' | ') };
}

async function verificarEfeitosVisuais() {
  const falhas = [];
  const pseudo = (sel, p) => { const x = document.querySelector(sel); return x ? getComputedStyle(x, p) : null; };
  const circulo = pseudo('#tabuleiro', '::after');
  if (!circulo || circulo.animationName === 'none') falhas.push('círculo mágico sem animação');
  const runa = pseudo('#tabuleiro .slot', '::before');
  if (!runa || runa.maskImage === 'none' && runa.webkitMaskImage === 'none') falhas.push('runa da zona sem máscara');
  const parts = pseudo('#atmosfera .part-a');
  if (!parts || parts.animationName === 'none') falhas.push('partículas sem animação');
  return { nome: 'Efeitos do campo ativos (círculo mágico, runas, partículas)', ok: falhas.length === 0, detalhe: falhas.join(' | ') };
}

// Cada cenário tem um fundo panorâmico em fundos/<nome>.jpg. Confere se todos existem e carregam.
async function verificarFundos() {
  const falhas = [];
  for (const nome of Object.keys(CAMPOS)) {
    const ok = await new Promise((resolver) => {
      const img = new Image();
      img.onload = () => resolver(img.naturalWidth >= 1280);
      img.onerror = () => resolver(false);
      img.src = `fundos/${nome}.jpg`;
    });
    if (!ok) falhas.push(`fundos/${nome}.jpg não carregou (rode: python ferramentas/gerar_fundos.py)`);
  }
  return { nome: 'Os 7 fundos panorâmicos carregam (fundos/*.jpg)', ok: falhas.length === 0, detalhe: falhas.join(' | ') };
}

// Clima do campo (partículas no canvas): precisa estar rodando, ser leve e obedecer a qualidade.
async function verificarClima() {
  const falhas = [];
  const guarda = infoClima().qualidade;
  definirQualidade('alta');
  let maisPesado = 0;
  for (const nome of NOMES_AMBIENTE) {
    definirCenarioClima(nome);
    await pausa(1700); // o clima novo entra aos poucos
    const custo = medirCustoClima(40);
    maisPesado = Math.max(maisPesado, custo ?? 0);
    if (custo === null) { falhas.push('canvas do clima não existe'); break; }
    if (custo > 4) falhas.push(`${nome}: ${custo.toFixed(1)} ms por quadro (limite 4)`);
    if (nome !== 'padrao' && nome !== 'terra' && infoClima().particulas < 20) falhas.push(`${nome}: poucas partículas (${infoClima().particulas})`);
  }
  definirCenarioClima('floresta');
  await pausa(1700);
  const n = {};
  for (const q of ['alta', 'media', 'baixa']) { definirQualidade(q); n[q] = infoClima().particulas; }
  if (!(n.alta > n.media && n.media > n.baixa)) falhas.push(`qualidade não reduz partículas (${n.alta}/${n.media}/${n.baixa})`);
  definirQualidade(guarda);
  definirCenarioClima('padrao');
  return { nome: 'Clima do campo: partículas leves nos 7 cenários e qualidade Alta/Média/Baixa', ok: falhas.length === 0, detalhe: falhas.join(' | ') || `pior quadro ${maisPesado.toFixed(2)} ms` };
}

// Áudio ambiente: cada receita deve gerar som válido e com volume parecido (renderizado sem alto-falante).
async function verificarAmbiente() {
  const falhas = [];
  const rms = [];
  for (const nome of NOMES_AMBIENTE) {
    const m = await medirAmbiente(nome, 4);
    if (!m.valido || m.rms < 0.005) falhas.push(`${nome}: som mudo ou inválido`);
    else if (m.pico > 0.9) falhas.push(`${nome}: estourando (pico ${m.pico.toFixed(2)})`);
    rms.push(m.rms);
  }
  const mn = Math.min(...rms), mx = Math.max(...rms);
  if (mx / mn > 3) falhas.push(`volumes muito diferentes entre cenários (${(mx / mn).toFixed(1)}x)`);
  return { nome: 'Áudio ambiente: 7 receitas com som válido e volume equilibrado', ok: falhas.length === 0, detalhe: falhas.join(' | ') || `diferença máxima ${(mx / mn).toFixed(1)}x` };
}

async function verificarDuelos() {
  const r = await simularRapido(8);
  const ok = r.erros === 0 && r.semFim === 0;
  return {
    nome: 'Simulação de 8 duelos IA × IA termina sem erro',
    ok,
    detalhe: ok ? `placar ${r.vitorias[0]}×${r.vitorias[1]} (empates ${r.empates}), ${r.turnosMedios} turnos em média` : `erros ${r.erros}, sem fim ${r.semFim}: ${r.primeiroErro ?? ''}`,
  };
}

export async function rodarVerificacoes(aoTerminarCada = () => {}) {
  const lista = [verificarCartas, verificarCenarios, verificarMesa, verificarEfeitosVisuais, verificarFundos, verificarClima, verificarAmbiente, verificarDuelos];
  const resultados = [];
  for (const fn of lista) {
    let r;
    try { r = await fn(); } catch (erro) { r = { nome: fn.name, ok: false, detalhe: `exceção: ${erro.message}` }; }
    resultados.push(r);
    aoTerminarCada(r);
  }
  definirCenario('padrao');
  return resultados;
}

// ---------------------------------------------------------------
// Painel
// ---------------------------------------------------------------
export function montarSala() {
  if ($('sala')) return;
  const p = el('aside');
  p.id = 'sala';
  const cab = el('div', 'cab');
  cab.append(el('b', '', '🧪 Sala de Testes'));
  const recolher = el('button', 'mini', '–');
  recolher.title = 'Recolher/abrir';
  recolher.addEventListener('click', () => p.classList.toggle('recolhida'));
  const lado = el('button', 'mini', '⇆');
  lado.title = 'Mudar de lado';
  lado.addEventListener('click', () => p.classList.toggle('direita'));
  cab.append(lado, recolher);
  const corpo = el('div', 'corpo');

  const secao = (titulo) => { const s = el('section'); s.appendChild(el('h4', '', titulo)); corpo.appendChild(s); return s; };

  const sc = secao('Cenário');
  const linha = el('div', 'linha');
  for (const nome of Object.keys(CAMPOS)) {
    const b = el('button', '', nome);
    b.addEventListener('click', () => definirCenario(nome));
    linha.appendChild(b);
  }
  sc.appendChild(linha);

  const sv = secao('Vitrine');
  const bv = el('button', '', 'Encher a mesa (todas as raridades)');
  bv.addEventListener('click', montarVitrine);
  sv.appendChild(bv);

  const sa = secao('Duelo automático');
  const ba = el('button', '', '▶ Duelo IA × IA');
  ba.id = 'sala-auto';
  ba.addEventListener('click', duelarAutomatico);
  const vel = el('select');
  for (const [rot, ms] of [['rápido', 150], ['normal', 600], ['lento', 1400]]) vel.appendChild(new Option(rot, String(ms), false, ms === 600));
  vel.addEventListener('change', () => { velocidade = Number(vel.value); });
  const bs = el('button', '', 'Simular 30 duelos (sem desenhar)');
  const saida = el('pre', 'saida');
  bs.addEventListener('click', async () => {
    bs.disabled = true;
    const r = await simularRapido(30, (i, n) => { saida.textContent = `Simulando… ${i}/${n}`; });
    saida.textContent = `J1 ${r.vitorias[0]} × ${r.vitorias[1]} J2 · empates ${r.empates}\nturnos médios ${r.turnosMedios} · erros ${r.erros}${r.primeiroErro ? `\n${r.primeiroErro}` : ''}`;
    bs.disabled = false;
  });
  sa.append(ba, vel, bs, saida);

  const sg = secao('Cartas');
  const bg = el('button', '', 'Abrir galeria');
  bg.addEventListener('click', abrirGaleria);
  sg.appendChild(bg);

  const sk = secao('Verificações');
  const bk = el('button', 'destaque', '✔ Rodar todas');
  const lista = el('ul', 'resultados');
  bk.addEventListener('click', async () => {
    bk.disabled = true; lista.innerHTML = '';
    const rs = await rodarVerificacoes((r) => {
      const li = el('li', r.ok ? 'ok' : 'falha', `${r.ok ? '✔' : '✘'} ${r.nome}`);
      if (r.detalhe) li.appendChild(el('small', '', r.detalhe));
      lista.appendChild(li);
    });
    window.__salaResultado = { ok: rs.every((r) => r.ok), resultados: rs };
    bk.disabled = false;
  });
  sk.append(bk, lista);

  p.append(cab, corpo);
  document.body.appendChild(p);

  if (new URLSearchParams(location.search).has('auto')) bk.click();
}
