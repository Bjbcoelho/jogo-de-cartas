// ui.js
// ---------------------------------------------------------------
// Interface do jogo. IMPORTANTE: aqui NÃO há regras de jogo.
// A UI só chama as funções dos módulos (game_state, turn_system,
// rules_engine, ai_opponent) e desenha o estado que eles devolvem.
//
// Seções: 1) utilidades  2) renderização  3) eventos  4) fluxo da partida
// ---------------------------------------------------------------

import { criarEstado, oponenteDe, comprarCarta } from './game_state.js';
import { comecarPartida, avancarFase, invocarNormal, posicionarCarta, mudarPosicao, finalizarTurno, tributosNecessarios } from './turn_system.js';
import { calcularStatsEfetivos, podeEvoluir, evoluir, ativarMagia, declararAtaque, descreverAtaque } from './rules_engine.js';
import { indexarBanco, montarDeckAleatorio, montarDeckPronto } from './deck_builder.js';
import { tocarAnimacaoFusao } from './fusao_animacoes.js';
import { jogarTurnoIA } from './ai_opponent.js';
import { somCompra, somEntradaRara } from './sons.js';
import { avaliarFase } from './historia.js';
import { definirCenarioClima } from './clima.js';
import { tocarAmbiente, pararAmbiente } from './ambiente.js';

// =============================================================
// 1) UTILIDADES
// =============================================================

const ICONES_BIOMA = { humano: '🧑', inseto: '🐛', marinho: '🌊', planetario: '🪐' };
const ICONES_TIPO = { magia: '✨', equipamento: '🗡️', armadilha: '🪤', campo: '🏞️', fusao: '🧬' };
const NOMES_FASE = { draw: 'Draw', standby: 'Standby', main: 'Main', battle: 'Battle', end: 'End' };
const NOMES_BIOMA = { humano: 'Humano', inseto: 'Inseto', marinho: 'Marinho', planetario: 'Planetário' };
const PV_MAXIMO = 8000;
const NOMES_RARIDADE = { comum: 'Comum', rara: 'Rara', super_rara: 'Super Rara', lendaria: 'Lendária' };
const GEMAS = { comum: '●', rara: '◆', super_rara: '★', lendaria: '✦' };

const $ = (id) => document.getElementById(id);

// Cria um elemento: el('div', 'classe1 classe2', 'texto')
function el(tag, classes = '', texto = '') {
  const e = document.createElement(tag);
  if (classes) e.className = classes;
  if (texto) e.textContent = texto;
  return e;
}

// Mostra uma mensagem temporária no topo da tela.
let temporizadorAviso = null;
function aviso(texto, tipo = 'erro') {
  const caixa = $('aviso');
  caixa.textContent = texto;
  caixa.className = `visivel ${tipo === 'info' ? 'info' : ''}`;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { caixa.className = ''; }, 3500);
}

// Adiciona uma linha ao registro de ações.
function registrar(texto) {
  const li = el('li', '', texto);
  $('log').appendChild(li);
  $('log').scrollTop = $('log').scrollHeight;
}

// =============================================================
// ESTADO DA INTERFACE (o estado do JOGO fica em "estado")
// =============================================================

let estado = null;
let cartasPorId = null;
// "modo" guarda uma seleção em andamento. Exemplos:
//   { tipo: 'tributos', indiceMao, posicao, necessarios, escolhidos: [] }
//   { tipo: 'alvo', lado: 'proprio' | 'oponente', texto, aoEscolher(indice) }
//   { tipo: 'atacante', indice }
let modo = null;
let iaAtiva = false;
let iaJogando = false;
let extraAberto = false; // bandeja do deck extra (fusões) aberta?
let duelId = 0;          // identifica o duelo atual: callbacks de duelos antigos são ignorados
let atrasoIA = 800;      // pausa (ms) entre as ações do computador
// Cenário (visual da mesa) de cada carta de campo. Cartas sem entrada aqui usam o cenário padrão.
const CENARIOS = {
  campo_cratera_de_marte: 'marte',
  campo_base_de_lancamento_orbital: 'terra', // humanos: cores do planeta Terra
  campo_mar_de_europa: 'europa',
  campo_floresta_ancestral: 'floresta',
  campo_cidade_antiga: 'cidade',
  campo_tempestade_solar: 'solar',
};
// Troca o cenário: o visual (CSS), o clima de partículas e o áudio ambiente andam juntos.
function aplicarCenario(nome) {
  $('mesa').dataset.cenario = nome;
  definirCenarioClima(nome);
  tocarAmbiente(nome);
}
let campoAnterior = null; // id da carta de campo da última renderização (para avisar quando muda)
let modoAnimacao = 'completa'; // 'completa' | 'muda' | 'desligada'
let animando = false;          // true enquanto a animação de fusão cobre a tela
let nivelIA = 3;           // dificuldade da IA (1 a 5); o Modo História muda isso por fase
let historiaAtual = null;  // { fase, aoConcluir, aoSair } quando o duelo faz parte do Modo História
let fimProcessado = false; // o fim do duelo já foi avaliado? (evita salvar o progresso duas vezes)
let ultimoDeck = [0, 0];   // tamanho dos decks na última renderização (detecta compras, para o som)
let visiveis = new Set();  // uids dos monstros virados para cima na última renderização (detecta entradas)
let anunciados = new Set(); // monstros cuja entrada já foi anunciada (fusões anunciam depois da animação)
let ultimaConfig = null; // opções do último duelo, para "Jogar de novo" e "Reiniciar"
let pausado = false;     // menu de pausa aberto?
let retomarIA = null;    // função que "destrava" a IA quando a pausa fecha
let aoVoltarAoMenu = () => {}; // quem usa a ui.js (menu.js) diz o que fazer ao sair do duelo

// Em modo contra o computador, o humano (jogador 0) fica sempre embaixo.
// No hot-seat, embaixo fica sempre o jogador da vez.
function ladoInferior() {
  return iaAtiva ? 0 : estado.jogadorDaVez;
}

// Humano pode agir agora? (não durante a vez da IA, nem depois do fim)
function podeAgir() {
  return estado && estado.vencedor === null && !animando && !iaJogando && !(iaAtiva && estado.jogadorDaVez === 1);
}

// =============================================================
// 2) RENDERIZAÇÃO
// =============================================================

export function criarCartaEl(carta, opcoes = {}) {
  const { oculta = false, atk = carta.atk, def = carta.def, posicao = 'ataque', virada = false, semHover = false } = opcoes;

  if (oculta) return el('div', 'carta verso', '🂠');

  const bioma = carta.bioma ?? 'neutro';
  const raridade = carta.raridade ?? 'comum';
  const div = el('div', `carta bioma-${bioma} tipo-${carta.tipo} rar-${raridade}`);
  if (carta.uid) div.dataset.uid = carta.uid;
  // Monstro com efeito tem cor própria; o monstro "simples" (sem efeito) fica na cor neutra.
  if (carta.tipo === 'monstro' && (carta.efeito || carta.habilidade_especial)) div.classList.add('com-efeito');
  if (posicao === 'defesa') div.classList.add('defesa');
  if (virada) div.classList.add('virada');

  div.appendChild(el('div', 'nome', carta.nome));

  // Arte: usa a imagem opcional da carta, se existir; senão um emoji do bioma/tipo.
  const arte = el('div', 'arte', carta.imagem ? '' : (carta.icone ?? (carta.bioma ? ICONES_BIOMA[carta.bioma] : ICONES_TIPO[carta.tipo])));
  if (carta.imagem) arte.style.backgroundImage = `url("${carta.imagem}")`;
  div.appendChild(arte);

  if (carta.tipo === 'monstro' || carta.tipo === 'fusao') {
    div.appendChild(el('div', 'linha', `★${carta.nivel}${carta.tipo === 'fusao' ? (carta.condicao_especial ? ' · Fusão especial' : ' · Fusão') : ''}`));
    // Cada atributo vira uma coluna: rótulo pequeno em cima e número embaixo (cabe em cartas estreitas).
    const stats = el('div', 'stats');
    const atributo = (rotulo, valor, base) => {
      const s = el('span', valor > base ? 'sobe' : valor < base ? 'cai' : '');
      s.append(el('small', '', rotulo), el('b', '', String(valor)));
      return s;
    };
    stats.append(atributo('ATK', atk, carta.atk), atributo('DEF', def, carta.def));
    div.appendChild(stats);
  } else {
    const ef = carta.efeito?.descricao_texto ?? carta.descricao ?? '';
    div.appendChild(el('div', 'texto-efeito', ef));
  }

  // Visual novo: tributos (losangos laranja) e ícone do bioma. No visual clássico o CSS esconde os dois.
  const tributos = carta.tipo === 'monstro' ? tributosNecessarios(carta.nivel) : 0;
  if (tributos > 0) {
    const t = el('div', 'tributos');
    t.title = `Pede ${tributos} tributo${tributos > 1 ? 's' : ''} para ser invocado`;
    for (let i = 0; i < tributos; i++) t.appendChild(el('i'));
    div.appendChild(t);
  }
  if (carta.bioma) {
    const ib = el('div', 'icone-bioma', ICONES_BIOMA[carta.bioma]);
    ib.title = NOMES_BIOMA[carta.bioma];
    div.appendChild(ib);
  }

  // Gema da raridade no canto da arte (●, ◆, ★ ou ✦).
  const gema = el('div', 'gema', GEMAS[raridade]);
  gema.title = NOMES_RARIDADE[raridade];
  div.appendChild(gema);

  // Painel de detalhes ao passar o mouse.
  if (!semHover) div.addEventListener('mouseenter', () => mostrarDetalhes(carta, atk, def));
  return div;
}

export function mostrarDetalhes(carta, atk = carta.atk, def = carta.def, caixa = $('detalhes')) {
  caixa.innerHTML = '';
  // Carta ampliada: a arte é a protagonista, o texto vem logo abaixo (só aparece no visual novo).
  const ampliada = el('div', 'preview-carta');
  ampliada.appendChild(criarCartaEl(carta, { atk, def, semHover: true }));
  caixa.appendChild(ampliada);
  caixa.appendChild(el('h3', '', carta.nome));
  const etiquetas = el('div');
  const raridade = carta.raridade ?? 'comum';
  const etiquetaRaridade = el('span', `etiqueta rar-${raridade}`, `${GEMAS[raridade]} ${NOMES_RARIDADE[raridade]}`);
  etiquetaRaridade.style.color = { comum: '#b9c1c6', rara: '#6db8ff', super_rara: '#d2a0ff', lendaria: '#ffd666' }[raridade];
  etiquetas.appendChild(etiquetaRaridade);
  etiquetas.appendChild(el('span', 'etiqueta', carta.tipo));
  if (carta.bioma) etiquetas.appendChild(el('span', 'etiqueta', `${ICONES_BIOMA[carta.bioma]} ${NOMES_BIOMA[carta.bioma]}`));
  if (carta.nivel) {
    const t = carta.tipo === 'monstro' ? tributosNecessarios(carta.nivel) : 0;
    etiquetas.appendChild(el('span', 'etiqueta', `Nível ${carta.nivel}${t ? ` · ${t} tributo${t > 1 ? 's' : ''}` : ''}`));
  }
  caixa.appendChild(etiquetas);
  if (carta.tipo === 'monstro' || carta.tipo === 'fusao') {
    const base = (atk !== carta.atk || def !== carta.def) ? ` (base ${carta.atk}/${carta.def})` : '';
    caixa.appendChild(el('p', '', `ATK ${atk} / DEF ${def}${base}`));
  }
  caixa.appendChild(el('p', '', carta.descricao ?? ''));
  const ef = carta.habilidade_especial ?? carta.efeito;
  if (ef) caixa.appendChild(el('p', '', `Efeito: ${ef.descricao_texto}`));
  if (carta.efeito_secundario) caixa.appendChild(el('p', '', `Efeito: ${carta.efeito_secundario.descricao_texto}`));
  if (carta.condicao_especial) caixa.appendChild(el('p', 'condicao-especial', `⚑ Fusão especial: ${carta.condicao_especial.descricao_texto}`));
  if (carta.modificadores_globais) {
    const t = carta.modificadores_globais.map((m) => `${NOMES_BIOMA[m.bioma]}: ${m.mod_atk >= 0 ? '+' : ''}${m.mod_atk} ATK / ${m.mod_def >= 0 ? '+' : ''}${m.mod_def} DEF`).join(' · ');
    caixa.appendChild(el('p', '', t));
  }
  if (carta.condicao_ativacao) caixa.appendChild(el('p', '', `Condição: ${carta.condicao_ativacao}`));
  if (carta.requisitos_fusao) {
    const t = carta.requisitos_fusao.map((r) => cartasPorId?.[r.id]?.nome ?? r.id.replace(/^[a-z]+_/, '').replace(/_/g, ' ')).join(' + ');
    caixa.appendChild(el('p', '', `Materiais: ${t}`));
  }
}

// Nome do jogador para mostrar na tela.
function nomeDoJogador(id) {
  if (historiaAtual && id === 1) return historiaAtual.fase.oponente.nome;
  return iaAtiva && id === 1 ? 'Jogador 2 (IA)' : `Jogador ${id + 1}`;
}

const sinal = (n) => (n >= 0 ? '+' : '') + n;

// Painel de vida de um canto da tela: nome, PV em número grande e uma barra.
function desenharHud(container, idJogador) {
  container.innerHTML = '';
  const jogador = estado.jogadores[idJogador];
  container.classList.toggle('da-vez', estado.jogadorDaVez === idJogador);
  container.appendChild(el('div', 'rotulo', nomeDoJogador(idJogador)));
  const linha = el('div', 'linha-pv');
  linha.append(el('span', 'sigla', 'PV'), el('span', 'numero', String(jogador.pontos_vida)));
  container.appendChild(linha);
  const barra = el('div', 'barra');
  const preench = el('div');
  const maximo = Math.max(PV_MAXIMO, estado.pvInicial?.[idJogador] ?? 0);
  preench.style.width = `${Math.max(0, Math.min(100, (jogador.pontos_vida / maximo) * 100))}%`;
  barra.appendChild(preench);
  container.appendChild(barra);
}

// Mão: versos para o oponente (em cima), cartas clicáveis para quem está embaixo.
function desenharMao(container, idJogador, ehTopo) {
  container.innerHTML = '';
  estado.jogadores[idJogador].mao.forEach((carta, i) => {
    if (ehTopo) {
      container.appendChild(criarCartaEl(carta, { oculta: true }));
    } else {
      const c = criarCartaEl(carta);
      c.classList.add('clicavel');
      c.addEventListener('click', (ev) => aoClicarMao(i, ev));
      container.appendChild(c);
    }
  });
}

// Um slot da zona de monstros (com a carta, se houver).
function criarSlotMonstroEl(idJogador, i, ehTopo) {
  const slot = estado.jogadores[idJogador].zona_monstros[i];
  const caixa = el('div', `slot zona-monstro ${ehTopo ? 'lado-cima' : 'lado-baixo'}`);
  if (!slot) return caixa;

  const stats = calcularStatsEfetivos(estado, idJogador, i);
  // Monstro virado para baixo do oponente aparece só como verso.
  const escondido = slot.viradaParaBaixo && ehTopo;
  const c = escondido
    ? criarCartaEl(slot.carta, { oculta: true })
    : criarCartaEl(slot.carta, { atk: stats.atk, def: stats.def, posicao: slot.posicao, virada: slot.viradaParaBaixo });
  if (escondido && slot.posicao === 'defesa') c.classList.add('defesa');
  caixa.appendChild(c);
  caixa.classList.add('clicavel');
  caixa.addEventListener('click', (ev) => aoClicarMonstro(idJogador, i, ev));

  const vez = estado.jogadorDaVez;
  if (modo?.tipo === 'tributos' && modo.escolhidos.includes(i) && idJogador === vez) caixa.classList.add('escolhido');
  if (modo?.tipo === 'atacante' && modo.indice === i && idJogador === vez) caixa.classList.add('escolhido');
  if (modo?.tipo === 'alvo' && ((modo.lado === 'oponente') === (idJogador !== vez))) caixa.classList.add('alvo');
  if (modo?.tipo === 'atacante' && idJogador !== vez) caixa.classList.add('alvo');
  return caixa;
}

// Um slot da zona de magias/armadilhas.
function criarSlotMagiaEl(idJogador, i, ehTopo) {
  const registro = estado.jogadores[idJogador].zona_magias_armadilhas[i];
  const caixa = el('div', `slot zona-magia ${ehTopo ? 'lado-cima' : 'lado-baixo'}`);
  if (registro) {
    const escondido = registro.viradaParaBaixo && ehTopo;
    caixa.appendChild(escondido
      ? criarCartaEl(registro.carta, { oculta: true })
      : criarCartaEl(registro.carta, { virada: registro.viradaParaBaixo }));
  }
  return caixa;
}

// Pilha genérica (deck, cemitério, deck extra): um "montinho" com rótulo e quantidade.
function criarPilha(rotulo, quantidade, classe = '') {
  const p = el('div', `pilha ${classe}`.trim());
  p.appendChild(el('i', 'emblema')); // desenho do verso da carta (só aparece no visual novo)
  p.appendChild(el('span', 'rotulo', rotulo));
  p.appendChild(el('b', '', String(quantidade)));
  return p;
}

function criarPilhaCemiterio(idJogador) {
  const jogador = estado.jogadores[idJogador];
  const p = criarPilha('Cemitério', jogador.cemiterio.length, 'cemiterio');
  const ultima = jogador.cemiterio.at(-1);
  if (ultima) {
    p.title = `Última: ${ultima.nome}`;
    p.addEventListener('mouseenter', () => mostrarDetalhes(ultima));
  }
  return p;
}

// Há alguma fusão que o jogador pode evoluir agora? (usado para acender o deck extra)
function haEvolucaoPossivel(idJogador) {
  if (estado.fase !== 'main' || estado.jogadorDaVez !== idJogador) return false;
  return estado.jogadores[idJogador].deck_extra.some((f) => podeEvoluir(estado, idJogador, f.id).ok);
}

// Deck extra. O de baixo é clicável: abre/fecha a bandeja com as fusões.
function criarPilhaExtra(idJogador, ehTopo) {
  const p = criarPilha('Extra', estado.jogadores[idJogador].deck_extra.length, 'extra');
  if (ehTopo) return p;
  p.classList.add('clicavel');
  if (extraAberto) p.classList.add('aberto');
  if (haEvolucaoPossivel(idJogador)) p.classList.add('pronto');
  p.title = 'Clique para ver as fusões do Deck Extra';
  p.addEventListener('click', (ev) => {
    ev.stopPropagation();
    extraAberto = !extraAberto;
    renderizar();
  });
  return p;
}

// Campo compartilhado: uma faixa no meio do tabuleiro, entre os dois lados.
function criarBannerCampo() {
  const b = el('div', 'campo-banner');
  const c = estado.cartaCampo;
  if (!c) {
    b.classList.add('vazio');
    b.textContent = 'Campo (nenhum ativo)';
    return b;
  }
  b.classList.add('ativo');
  b.appendChild(el('div', 'nome-campo', `${ICONES_TIPO.campo} ${c.nome}`));
  const resumo = (c.modificadores_globais ?? [])
    .map((m) => `${ICONES_BIOMA[m.bioma]} ${sinal(m.mod_atk)}/${sinal(m.mod_def)}`)
    .join('   ');
  b.appendChild(el('div', 'resumo-campo', `ATK/DEF  ${resumo}`));
  b.addEventListener('mouseenter', () => mostrarDetalhes(c));
  return b;
}

// Bandeja com as fusões do deck extra (cada fusão uma vez, com "×N" de cópias).
function desenharBandejaExtra(idJogador) {
  const bandeja = $('bandeja-extra');
  bandeja.innerHTML = '';
  bandeja.classList.toggle('oculto', !extraAberto);
  if (!extraAberto) return;

  bandeja.appendChild(el('div', 'titulo', 'Deck Extra — clique numa fusão em verde para evoluir'));
  const fila = el('div', 'fila-extra');
  const copias = {};
  for (const f of estado.jogadores[idJogador].deck_extra) copias[f.id] = (copias[f.id] || 0) + 1;
  const vistos = new Set();
  for (const fusao of estado.jogadores[idJogador].deck_extra) {
    if (vistos.has(fusao.id)) continue;
    vistos.add(fusao.id);
    const c = criarCartaEl(fusao);
    const analise = podeEvoluir(estado, idJogador, fusao.id);
    const pronto = analise.ok && estado.fase === 'main' && estado.jogadorDaVez === idJogador;
    c.classList.add(pronto ? 'disponivel' : 'indisponivel');
    c.title = pronto ? 'Clique para evoluir' : analise.motivo || 'Só na Main Phase';
    c.appendChild(el('div', 'copias', `×${copias[fusao.id]}`));
    c.addEventListener('click', (ev) => {
      ev.stopPropagation();
      aoClicarFusao(fusao.id);
    });
    fila.appendChild(c);
  }
  bandeja.appendChild(fila);
}

// Põe um elemento numa célula da grade do tabuleiro (linha, coluna e, opcional, quantas colunas ocupa).
function adicionar(grade, elemento, linha, coluna, largura = 1) {
  elemento.style.gridRow = String(linha);
  elemento.style.gridColumn = largura > 1 ? `${coluna} / span ${largura}` : String(coluna);
  grade.appendChild(elemento);
}

// Monta o tabuleiro inteiro. Colunas: 1 = pilha esquerda, 2..6 = os 5 slots, 7 = pilha direita.
// Linhas (de cima para baixo): 1 magias do oponente, 2 monstros do oponente, 3 campo,
//                              4 meus monstros, 5 minhas magias.
// O lado de cima é "espelhado" (como se o oponente estivesse sentado do outro lado da mesa):
// os slots aparecem na ordem inversa e as pilhas trocam de canto.
function desenharTabuleiro(cima, baixo) {
  const grade = $('tabuleiro');
  grade.innerHTML = '';
  const jc = estado.jogadores[cima];
  const jb = estado.jogadores[baixo];

  // Linha 1: magias/armadilhas do oponente + deck e deck extra dele
  adicionar(grade, criarPilha('Deck', jc.deck_principal.length), 1, 1);
  for (let k = 0; k < 5; k++) adicionar(grade, criarSlotMagiaEl(cima, 4 - k, true), 1, 2 + k);
  adicionar(grade, criarPilhaExtra(cima, true), 1, 7);

  // Linha 2: monstros do oponente + cemitério dele
  adicionar(grade, criarPilhaCemiterio(cima), 2, 1);
  for (let k = 0; k < 5; k++) adicionar(grade, criarSlotMonstroEl(cima, 4 - k, true), 2, 2 + k);

  // Linha 3: campo compartilhado, no meio
  adicionar(grade, criarBannerCampo(), 3, 3, 3);

  // Linha 4: meus monstros + meu cemitério
  for (let k = 0; k < 5; k++) adicionar(grade, criarSlotMonstroEl(baixo, k, false), 4, 2 + k);
  adicionar(grade, criarPilhaCemiterio(baixo), 4, 7);

  // Linha 5: meu deck extra + minhas magias/armadilhas + meu deck
  adicionar(grade, criarPilhaExtra(baixo, false), 5, 1);
  for (let k = 0; k < 5; k++) adicionar(grade, criarSlotMagiaEl(baixo, k, false), 5, 2 + k);
  adicionar(grade, criarPilha('Deck', jb.deck_principal.length), 5, 7);
}

// Texto de ajuda mostrado no centro, conforme a seleção em andamento.
function textoDaDica() {
  if (!modo) return '';
  if (modo.tipo === 'tributos') return `Clique nos monstros a sacrificar (${modo.escolhidos.length}/${modo.necessarios}).`;
  if (modo.tipo === 'alvo') return modo.texto;
  if (modo.tipo === 'atacante') return 'Clique no monstro que será atacado (ou use "Ataque direto").';
  return '';
}

function atualizarControles() {
  const humano = podeAgir();
  const podeAvancar = humano && ['main', 'battle'].includes(estado.fase);
  $('btn-fase').disabled = !podeAvancar;
  $('btn-finalizar').disabled = !humano;
  $('selo-fase').classList.toggle('desativado', !podeAvancar);
  const oponenteSemMonstros = estado.jogadores[oponenteDe(estado.jogadorDaVez)].zona_monstros.every((s) => s === null);
  $('btn-direto').classList.toggle('oculto', !(modo?.tipo === 'atacante' && oponenteSemMonstros));
  $('btn-cancelar').classList.toggle('oculto', !modo);
}

function renderizar() {
  if (!estado) return;
  const baixo = ladoInferior();
  const cima = oponenteDe(baixo);

  desenharHud($('hud-sup'), cima);
  desenharHud($('hud-inf'), baixo);
  desenharMao($('mao-sup'), cima, true);
  desenharMao($('mao-inf'), baixo, false);
  desenharTabuleiro(cima, baixo);
  desenharBandejaExtra(baixo);
  // De que lado da mesa é a vez? As zonas desse lado brilham mais (o CSS lê data-vez).
  $('mesa').dataset.vez = estado.jogadorDaVez === baixo ? 'baixo' : 'cima';

  // Selo redondo: turno, fase e (se for o caso) a vez da IA.
  const selo = $('selo-fase');
  selo.innerHTML = '';
  selo.append(
    el('span', 'selo-turno', `Turno ${estado.turno}`),
    el('span', 'selo-fase-nome', NOMES_FASE[estado.fase] ?? estado.fase),
    el('span', 'selo-vez', `J${estado.jogadorDaVez + 1}${ehVezDaIA() ? ' (IA)' : ''}`),
  );

  // Cenário: a carta de campo ativa muda o ambiente inteiro da mesa.
  const idCampo = estado.cartaCampo?.id ?? null;
  if (idCampo !== campoAnterior) {
    aplicarCenario(CENARIOS[idCampo] ?? 'padrao');
    if (idCampo) aviso(`🏞️ Campo: ${estado.cartaCampo.nome}`, 'info');
    campoAnterior = idCampo;
  }

  $('dica').textContent = textoDaDica();
  atualizarControles();
  desenharObjetivos();
  detectarEventosSonoros();
  if (estado.vencedor !== null) mostrarFim();
}

// ----- Sons e clarões: compra de carta e entrada de monstros raros -----
// Em vez de espalhar chamadas de som pelo código, comparamos com a renderização anterior:
//   * o deck encolheu  -> alguém comprou uma carta;
//   * apareceu um monstro virado para cima -> ele "entrou em campo" (revelar um monstro em defesa também conta).
function detectarEventosSonoros() {
  estado.jogadores.forEach((j, i) => {
    if (j.deck_principal.length < ultimoDeck[i]) somCompra();
    ultimoDeck[i] = j.deck_principal.length;
  });
  const agora = new Set();
  let melhor = null; // a entrada mais rara desta renderização
  for (const j of estado.jogadores) {
    for (const slot of j.zona_monstros) {
      if (!slot || slot.viradaParaBaixo) continue;
      const uid = slot.carta.uid;
      agora.add(uid);
      if (visiveis.has(uid) || anunciados.has(uid)) continue;
      anunciados.add(uid);
      const r = slot.carta.raridade;
      if (r === 'lendaria' || (r === 'super_rara' && melhor?.raridade !== 'lendaria')) melhor = slot.carta;
    }
  }
  visiveis = agora;
  if (melhor) anunciarEntrada(melhor);
}

// Som + clarão + aviso para um monstro Super Raro ou Lendário que acabou de entrar.
function anunciarEntrada(carta) {
  if (carta.raridade !== 'super_rara' && carta.raridade !== 'lendaria') return;
  somEntradaRara(carta.raridade);
  const lendaria = carta.raridade === 'lendaria';
  const classe = lendaria ? 'entrou-lendaria' : 'entrou-rara';
  for (const c of document.querySelectorAll(`.carta[data-uid="${carta.uid}"]`)) {
    c.classList.add(classe);
    c.addEventListener('animationend', () => c.classList.remove(classe), { once: true });
  }
  aviso(`${lendaria ? '✦ LENDÁRIA' : '★ Super Rara'}: ${carta.nome}`, 'info');
}

// ----- Objetivos da fase (Modo História) -----
function desenharObjetivos() {
  const caixa = $('objetivos');
  if (!historiaAtual) { caixa.classList.add('oculto'); return; }
  const analise = avaliarFase(historiaAtual.fase, estado);
  caixa.innerHTML = '';
  caixa.appendChild(el('h4', '', `Fase: ${historiaAtual.fase.nome}`));
  const lista = el('ul');
  for (const o of analise.objetivos) {
    const li = el('li', o.cumprido && o.obj.tipo !== 'vencer' ? 'ok' : o.falhou ? 'falhou' : '');
    li.append(`${o.cumprido ? '✔' : o.falhou ? '✘' : '○'} ${o.texto}`);
    if (o.progresso && o.obj.tipo !== 'vencer') li.appendChild(el('small', '', `(${o.progresso})`));
    lista.appendChild(li);
  }
  caixa.appendChild(lista);
  caixa.classList.remove('oculto');
}

// Pequena função auxiliar: é a vez da IA?
function ehVezDaIA() {
  return iaAtiva && estado.jogadorDaVez === 1;
}

function mostrarFim() {
  const texto = $('fim-texto');
  const lista = $('fim-objetivos');
  texto.classList.add('oculto');
  lista.classList.add('oculto');
  $('btn-novo').textContent = 'Jogar de novo';
  $('btn-fim-menu').textContent = 'Menu principal';

  if (historiaAtual) {
    const analise = avaliarFase(historiaAtual.fase, estado);
    // Salva o progresso UMA vez, assim que a fase é concluída (mesmo que a pessoa feche o navegador depois).
    if (!fimProcessado) {
      fimProcessado = true;
      if (analise.concluida) historiaAtual.aoConcluir?.(historiaAtual.fase);
    }
    $('fim-titulo').textContent = analise.concluida ? 'Fase concluída!'
      : analise.venceu ? 'Você venceu, mas faltaram objetivos' : 'Derrota';
    texto.textContent = analise.concluida ? historiaAtual.fase.conclusao
      : analise.venceu ? 'A fase só conta quando TODOS os objetivos são cumpridos. Tente de novo!' : 'Os guardiões não perdoam. Tente outra estratégia.';
    texto.classList.remove('oculto');
    lista.innerHTML = '';
    for (const o of analise.objetivos) lista.appendChild(el('li', o.cumprido ? 'ok' : 'falhou', `${o.cumprido ? '✔' : '✘'} ${o.texto}`));
    lista.classList.remove('oculto');
    if (!analise.concluida) $('btn-novo').textContent = 'Tentar de novo';
    $('btn-fim-menu').textContent = 'Voltar ao mapa';
    $('fim').classList.remove('oculto');
    return;
  }
  const titulo = estado.vencedor === 'empate' ? 'Empate!' : `Jogador ${estado.vencedor + 1}${iaAtiva && estado.vencedor === 1 ? ' (IA)' : ''} venceu!`;
  $('fim-titulo').textContent = titulo;
  $('fim').classList.remove('oculto');
}

// =============================================================
// 3) EVENTOS
// =============================================================

// ----- Menu flutuante -----
function fecharMenu() {
  const menu = $('menu-carta');
  menu.classList.add('oculto');
  menu.innerHTML = ''; // descarta os botões antigos: eles guardam índices que podem ficar velhos
}

function abrirMenu(evento, opcoes) {
  evento.stopPropagation(); // evita que o clique feche o menu logo em seguida
  const menu = $('menu-carta');
  menu.innerHTML = '';
  for (const op of opcoes) {
    const b = el('button', '', op.texto);
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      fecharMenu();
      op.aoClicar();
    });
    menu.appendChild(b);
  }
  menu.style.left = `${Math.min(evento.clientX, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(evento.clientY, window.innerHeight - 40 * opcoes.length - 20)}px`;
  menu.classList.remove('oculto');
}

// Mostra o motivo se a jogada falhar; senão registra a descrição e redesenha.
function concluir(resultado, descricao) {
  if (!resultado.ok) {
    aviso(resultado.motivo);
  } else if (descricao) {
    registrar(descricao);
  }
  // Armadilhas que o oponente ativou em resposta a esta jogada (ex.: ao invocar um monstro).
  // (se o texto já veio dentro da descrição do ataque, não repete)
  for (const t of resultado.armadilhas ?? []) if (!descricao.includes(t)) registrar(t);
  // Efeitos de monstros ("ao ser invocado" etc.) e magia anulada por armadilha.
  for (const t of resultado.efeitos ?? []) if (!descricao.includes(t)) registrar(t);
  if (resultado.negada) registrar('🚫 A magia foi anulada!');
  if (resultado.ok && resultado.armadilhas?.length) aviso(resultado.armadilhas[0], 'info');
  renderizar();
  return resultado.ok;
}

function cancelarModo() {
  modo = null;
  renderizar();
}

// ----- Clique numa carta da mão -----
function aoClicarMao(indice, evento) {
  if (!podeAgir()) return;
  const vez = estado.jogadorDaVez;
  const carta = estado.jogadores[vez].mao[indice];
  if (!carta) return;
  if (estado.fase !== 'main') { aviso('Cartas da mão só podem ser jogadas na Main Phase.'); return; }
  modo = null; // escolher outra carta cancela qualquer seleção pendente (os índices da mão mudariam)

  const opcoes = [];
  const quem = `Jogador ${vez + 1}`;

  if (carta.tipo === 'monstro') {
    opcoes.push({ texto: 'Invocar em Ataque', aoClicar: () => iniciarInvocacao(indice, 'ataque') });
    opcoes.push({ texto: 'Invocar em Defesa', aoClicar: () => iniciarInvocacao(indice, 'defesa') });
  } else if (carta.tipo === 'magia') {
    opcoes.push({ texto: 'Ativar', aoClicar: () => iniciarAtivacao(indice) });
    opcoes.push({ texto: 'Posicionar', aoClicar: () => concluir(posicionarCarta(estado, indice), `${quem} posicionou ${carta.nome}.`) });
  } else if (carta.tipo === 'equipamento') {
    opcoes.push({
      texto: 'Equipar em um monstro',
      aoClicar: () => {
        modo = {
          tipo: 'alvo', lado: 'proprio', texto: `Clique no monstro que vai receber ${carta.nome}.`,
          aoEscolher: (i) => {
            modo = null;
            concluir(ativarMagia(estado, vez, indice, { indiceAlvo: i }), `${quem} equipou ${carta.nome}.`);
          },
        };
        renderizar();
      },
    });
    opcoes.push({ texto: 'Posicionar', aoClicar: () => concluir(posicionarCarta(estado, indice), `${quem} posicionou ${carta.nome}.`) });
  } else if (carta.tipo === 'armadilha') {
    opcoes.push({ texto: 'Posicionar (virada)', aoClicar: () => concluir(posicionarCarta(estado, indice), `${quem} baixou uma carta virada para baixo.`) });
  } else if (carta.tipo === 'campo') {
    opcoes.push({ texto: 'Ativar campo', aoClicar: () => concluir(posicionarCarta(estado, indice), `${quem} ativou o campo ${carta.nome}.`) });
  }
  abrirMenu(evento, opcoes);
}

// Invocação: se precisa de tributos, entra no modo de escolha; senão invoca direto.
function iniciarInvocacao(indiceMao, posicao) {
  const vez = estado.jogadorDaVez;
  const carta = estado.jogadores[vez].mao[indiceMao];
  if (!carta) return; // a mão mudou desde que o menu abriu
  const necessarios = tributosNecessarios(carta.nivel);
  const descricao = `Jogador ${vez + 1} invocou ${carta.nome} em ${posicao}.`;
  if (necessarios === 0) {
    concluir(invocarNormal(estado, indiceMao, posicao, []), descricao);
    return;
  }
  modo = { tipo: 'tributos', indiceMao, posicao, necessarios, escolhidos: [], descricao };
  renderizar();
}

// Magias: algumas precisam de alvo escolhido pelo jogador.
function iniciarAtivacao(indice) {
  const vez = estado.jogadorDaVez;
  const carta = estado.jogadores[vez].mao[indice];
  if (!carta?.efeito) return; // a mão mudou desde que o menu abriu
  const ef = carta.efeito;
  const descricao = `Jogador ${vez + 1} ativou ${carta.nome}: ${ef.descricao_texto}`;

  const precisaAlvoOponente = ef.acao === 'destruir_monstro' && ef.alvo === 'oponente';
  const precisaAlvoProprio = (ef.acao === 'mod_atk' || ef.acao === 'mod_def') && (ef.alvo === 'proprio_monstro' || ef.alvo === 'monstro_equipado');

  if (precisaAlvoOponente || precisaAlvoProprio) {
    modo = {
      tipo: 'alvo', lado: precisaAlvoOponente ? 'oponente' : 'proprio',
      texto: precisaAlvoOponente ? 'Clique no monstro do oponente que será alvo.' : 'Clique no seu monstro que será alvo.',
      aoEscolher: (i) => {
        modo = null;
        concluir(ativarMagia(estado, vez, indice, { indiceAlvo: i }), descricao);
      },
    };
    renderizar();
    return;
  }
  concluir(ativarMagia(estado, vez, indice), descricao);
}

// Toca a animação de fusão do deck da carta (se houver). O estado do jogo já foi atualizado.
async function animarFusao(carta, daIA) {
  const id = duelId;
  // Os materiais que giram na animação: as cartas pedidas pela fusão (lidas do banco).
  const materiais = (carta.requisitos_fusao ?? []).map((r) => cartasPorId[r.id]).filter(Boolean);
  animando = true;
  try {
    await tocarAnimacaoFusao({ carta, materiais, criarCartaEl, modo: modoAnimacao });
  } finally {
    if (id === duelId) animando = false;
  }
  // Depois da animação, o monstro "entra" de verdade: som e clarão de raridade.
  if (id === duelId && estado) anunciarEntrada(carta);
}

// ----- Clique no deck extra -----
function aoClicarFusao(idFusao) {
  if (!podeAgir()) return;
  const vez = estado.jogadorDaVez;
  const analise = podeEvoluir(estado, vez, idFusao);
  if (!analise.ok) { aviso(analise.motivo); return; }
  const r = evoluir(estado, vez, idFusao);
  if (r.ok) { extraAberto = false; anunciados.add(r.carta.uid); } // a entrada é anunciada depois da animação
  concluir(r, r.ok ? `Jogador ${vez + 1} evoluiu para ${r.carta.nome}!` : '');
  if (r.ok) animarFusao(r.carta, false);
}

// ----- Clique num monstro em campo (de qualquer lado) -----
function aoClicarMonstro(idDono, indice, evento) {
  if (!podeAgir()) return;
  const vez = estado.jogadorDaVez;

  // Escolhendo tributos
  if (modo?.tipo === 'tributos') {
    if (idDono !== vez) { aviso('Escolha um monstro seu.'); return; }
    const pos = modo.escolhidos.indexOf(indice);
    if (pos >= 0) modo.escolhidos.splice(pos, 1);
    else modo.escolhidos.push(indice);
    if (modo.escolhidos.length === modo.necessarios) {
      const m = modo;
      modo = null;
      concluir(invocarNormal(estado, m.indiceMao, m.posicao, m.escolhidos), m.descricao);
    } else {
      renderizar();
    }
    return;
  }

  // Escolhendo alvo de magia/equipamento
  if (modo?.tipo === 'alvo') {
    const ehDoOponente = idDono !== vez;
    if ((modo.lado === 'oponente') !== ehDoOponente) {
      aviso(modo.lado === 'oponente' ? 'Escolha um monstro do oponente.' : 'Escolha um monstro seu.');
      return;
    }
    modo.aoEscolher(indice);
    return;
  }

  // Battle Phase: escolher atacante e depois o alvo
  if (estado.fase === 'battle') {
    if (idDono === vez) {
      const slot = estado.jogadores[vez].zona_monstros[indice];
      if (slot.posicao !== 'ataque') { aviso('Só monstros em posição de ataque podem atacar.'); return; }
      if (slot.jaAtacou) { aviso('Este monstro já atacou neste turno.'); return; }
      modo = { tipo: 'atacante', indice };
      renderizar();
    } else if (modo?.tipo === 'atacante') {
      const m = modo;
      modo = null;
      const log = declararAtaque(estado, vez, m.indice, indice);
      concluir(log, log.ok ? descreverAtaque(log) : '');
    } else {
      aviso('Primeiro clique em um dos seus monstros em ataque.');
    }
    return;
  }

  // Main Phase: clicar num monstro seu abre o menu de mudar posição
  if (estado.fase === 'main' && idDono === vez) {
    const slot = estado.jogadores[vez].zona_monstros[indice];
    const destino = slot.posicao === 'ataque' ? 'defesa' : 'ataque';
    abrirMenu(evento, [{
      texto: `Mudar para ${destino}`,
      aoClicar: () => concluir(mudarPosicao(estado, indice), `Jogador ${vez + 1} mudou ${slot.carta.nome} para ${destino}.`),
    }]);
  }
}

// ----- Botões -----
// Avança de fase (Main -> Battle -> End). Usado pelo botão e pelo selo redondo.
function proximaFase() {
  if (!podeAgir() || !['main', 'battle'].includes(estado.fase)) return;
  modo = null;
  const r = avancarFase(estado);
  if (r.ok) registrar(`Fase: ${NOMES_FASE[estado.fase]}.`);
  if (r.ok && r.aviso) aviso(r.aviso, 'info');
  concluir(r, '');
}

function configurarBotoes() {
  $('btn-fase').addEventListener('click', proximaFase);
  $('selo-fase').addEventListener('click', proximaFase);
  $('selo-fase').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); proximaFase(); }
  });
  // Em telas estreitas a lateral (detalhes + registro) fica escondida até este botão ser usado.
  $('btn-lateral').addEventListener('click', (ev) => {
    ev.stopPropagation();
    document.body.classList.toggle('lateral-aberta');
  });

  $('btn-finalizar').addEventListener('click', () => {
    if (!podeAgir()) return;
    modo = null;
    const vezAntes = estado.jogadorDaVez;
    const r = finalizarTurno(estado);
    if (r.ok) {
      registrar(`Jogador ${vezAntes + 1} finalizou o turno.${r.descartadas ? ` (descartou ${r.descartadas} por excesso de mão)` : ''}`);
    } else if (r.motivo === 'deckout') {
      registrar('Deck vazio! A partida termina por deckout.');
    }
    renderizar();
    if (!r.ok && r.motivo !== 'deckout') { aviso(r.motivo); return; }
    iniciarVezDaIA();
  });

  $('btn-direto').addEventListener('click', () => {
    if (modo?.tipo !== 'atacante') return;
    const m = modo;
    modo = null;
    const log = declararAtaque(estado, estado.jogadorDaVez, m.indice, null);
    concluir(log, log.ok ? descreverAtaque(log) : '');
  });

  $('btn-cancelar').addEventListener('click', cancelarModo);
  $('btn-novo').addEventListener('click', () => iniciarDuelo(ultimaConfig));
  $('btn-fim-menu').addEventListener('click', sairParaOMenu);
  $('btn-menu').addEventListener('click', (ev) => { ev.stopPropagation(); abrirPausa(); });
  document.addEventListener('click', fecharMenu);

  // Esc no duelo: fecha a pausa; ou cancela uma seleção; ou fecha o menu da carta; ou abre a pausa.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !estado) return;
    if (!$('pausa').classList.contains('oculto')) { fecharPausa(); return; }
    if (!$('fim').classList.contains('oculto')) return;
    if (modo) { cancelarModo(); return; }
    if (!$('menu-carta').classList.contains('oculto')) { fecharMenu(); return; }
    abrirPausa();
  });
}

// =============================================================
// 4) FLUXO DA PARTIDA
// =============================================================

async function iniciarVezDaIA() {
  if (!estado || !iaAtiva || iaJogando || estado.vencedor !== null || estado.jogadorDaVez !== 1) return;
  const id = duelId;
  iaJogando = true;
  renderizar();
  await jogarTurnoIA(estado, 1, {
    atrasoMs: atrasoIA,
    nivel: nivelIA,
    nome: nomeDoJogador(1),
    // Se o duelo mudou (reiniciou ou voltou ao menu), ignora o que a IA antiga ainda estiver fazendo.
    aoAgir: (texto) => { if (id !== duelId) return; registrar(texto); renderizar(); },
    // Enquanto o menu de pausa está aberto, a IA espera aqui.
    aoEvoluir: async (carta) => { if (id !== duelId) return; anunciados.add(carta.uid); renderizar(); await animarFusao(carta, true); },
    aguardar: () => (pausado ? new Promise((resolver) => { retomarIA = resolver; }) : null),
  });
  if (id !== duelId) return;
  iaJogando = false;
  renderizar();
}

// Começa um duelo novo. opcoes: { contraIA, quemComeca: 'sorteio'|'jogador1'|'jogador2', atrasoIA }
export function iniciarDuelo(opcoes = {}) {
  abandonarDuelo(); // encerra qualquer duelo anterior (e a IA dele)
  const { quemComeca = 'sorteio', atrasoIA: atraso = 800, deckJ1 = 'aleatorio', animacaoFusao = 'completa', historia = null } = opcoes;
  // No Modo História o oponente (deck, nível, PV) vem da fase, e o duelo é sempre contra o computador.
  const contraIA = historia ? true : (opcoes.contraIA ?? false);
  const deckJ2 = historia ? historia.fase.oponente.deck : (opcoes.deckJ2 ?? 'aleatorio');
  ultimaConfig = { contraIA, quemComeca, atrasoIA: atraso, deckJ1, deckJ2, animacaoFusao, historia };
  historiaAtual = historia;
  nivelIA = historia ? historia.fase.oponente.nivel : 3;
  fimProcessado = false;
  visiveis = new Set();
  anunciados = new Set();
  modoAnimacao = animacaoFusao;
  animando = false;
  campoAnterior = null;
  aplicarCenario('padrao');
  atrasoIA = atraso;
  iaAtiva = contraIA;

  const escolherDeck = (id) => {
    const pronto = decksProntos.find((d) => d.id === id);
    return pronto ? montarDeckPronto(pronto) : montarDeckAleatorio(cartasPorId);
  };
  const d0 = escolherDeck(deckJ1);
  const d1 = escolherDeck(deckJ2);
  estado = criarEstado(d0.deckPrincipal, d0.deckExtra, d1.deckPrincipal, d1.deckExtra, cartasPorId);
  estado.pvInicial = [estado.jogadores[0].pontos_vida, estado.jogadores[1].pontos_vida];
  if (historia) {
    // Oponente da fase: mais PV e/ou cartas extras na mão inicial.
    estado.jogadores[1].pontos_vida = historia.fase.oponente.pv ?? 8000;
    estado.pvInicial[1] = estado.jogadores[1].pontos_vida;
    for (let i = 0; i < (historia.fase.oponente.cartasExtras ?? 0); i++) comprarCarta(estado, 1);
  }
  if (quemComeca === 'jogador1' || quemComeca === 'jogador2') {
    const quem = quemComeca === 'jogador1' ? 0 : 1;
    estado.jogadorInicial = quem; // o turno 1 é de quem começa
    estado.jogadorDaVez = quem;
  }
  comecarPartida(estado);
  ultimoDeck = estado.jogadores.map((j) => j.deck_principal.length); // sem som para a compra inicial

  modo = null;
  iaJogando = false;
  extraAberto = false;
  pausado = false;
  $('log').innerHTML = '';
  $('fim').classList.add('oculto');
  $('pausa').classList.add('oculto');
  $('jogo').classList.remove('oculto');
  registrar(`Partida iniciada. ${nomeDoJogador(estado.jogadorDaVez)} começa (não compra nem ataca no primeiro turno).`);
  if (historia) registrar(`Fase "${historia.fase.nome}" contra ${historia.fase.oponente.nome} (IA nível ${historia.fase.oponente.nivel}, ${estado.jogadores[1].pontos_vida} PV).`);
  renderizar();
  iniciarVezDaIA();
}

// Encerra o duelo atual sem declarar vencedor (usado ao voltar ao menu ou reiniciar).
export function abandonarDuelo() {
  duelId += 1; // invalida callbacks pendentes
  if (estado && estado.vencedor === null) estado.vencedor = 'abandonado'; // a IA pára ao ver um vencedor
  estado = null;
  modo = null;
  iaJogando = false;
  extraAberto = false;
  pausado = false;
  if (retomarIA) { retomarIA(); retomarIA = null; } // solta a IA caso estivesse esperando a pausa
  for (const id of ['pausa', 'fim', 'menu-carta', 'objetivos']) $(id).classList.add('oculto');
  $('jogo').classList.add('oculto');
  pararAmbiente(); // sai do duelo: o som do cenário se apaga devagar
}

// =============================================================
// 5) MENU DE PAUSA (dentro do duelo)
// =============================================================

// Mostra o painel de pausa com um título, um texto opcional e uma lista de botões.
function montarPausa(titulo, texto, itens) {
  $('pausa-titulo').textContent = titulo;
  const t = $('pausa-texto');
  t.textContent = texto;
  t.classList.toggle('oculto', !texto);
  const lista = $('pausa-botoes');
  lista.innerHTML = '';
  for (const item of itens) {
    const b = el('button', 'menu-item', item.texto);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); item.aoClicar(); });
    lista.appendChild(b);
  }
  lista.querySelector('button')?.focus();
}

function pausaPrincipal() {
  montarPausa('Pausa', '', [
    { texto: 'Continuar', aoClicar: fecharPausa },
    { texto: 'Reiniciar duelo', aoClicar: () => confirmar('Reiniciar o duelo? O progresso atual será perdido.', () => { fecharPausa(); iniciarDuelo(ultimaConfig); }) },
    { texto: 'Desistir', aoClicar: () => confirmar('Desistir deste duelo? Você perde a partida.', desistir) },
    { texto: 'Voltar ao menu principal', aoClicar: () => confirmar('Voltar ao menu? O duelo atual será encerrado.', sairParaOMenu) },
  ]);
}

function confirmar(texto, aoSim) {
  montarPausa('Tem certeza?', texto, [
    { texto: 'Sim', aoClicar: aoSim },
    { texto: 'Não', aoClicar: pausaPrincipal },
  ]);
}

function abrirPausa() {
  if (!estado || estado.vencedor !== null) return;
  pausado = true;
  fecharMenu();
  pausaPrincipal();
  $('pausa').classList.remove('oculto');
}

function fecharPausa() {
  pausado = false;
  $('pausa').classList.add('oculto');
  if (retomarIA) { retomarIA(); retomarIA = null; }
}

// Desistir: contra o computador quem desiste é sempre o jogador 1; no duelo local, quem está na vez.
function desistir() {
  const perdedor = iaAtiva ? 0 : estado.jogadorDaVez;
  registrar(`${nomeDoJogador(perdedor)} desistiu do duelo.`);
  estado.vencedor = oponenteDe(perdedor); // define antes de soltar a IA, para ela parar
  modo = null;
  fecharPausa();
  renderizar();
}

function sairParaOMenu() {
  const saida = ultimaConfig?.historia?.aoSair ?? aoVoltarAoMenu; // no Modo História volta ao mapa de fases
  fecharPausa();
  abandonarDuelo();
  saida();
}

// =============================================================
// 6) ENTRADA: carregar o banco e ligar a interface
// =============================================================

// Lê o cards_db.json. Falha se a página foi aberta direto do arquivo (sem servidor local).
let decksProntos = []; // definições de decks.json

export function listarDecks() { return decksProntos; }

async function lerJson(arquivo) {
  const resposta = await fetch(arquivo);
  if (!resposta.ok) throw new Error(`${arquivo} não encontrado (HTTP ${resposta.status})`);
  return resposta.json();
}

// Lê o banco base e as cartas dos decks temáticos, juntando tudo no mesmo formato.
export async function carregarBanco() {
  const [banco, marte, humanos, decks] = await Promise.all([
    lerJson('cards_db.json'), lerJson('cards_marte.json'), lerJson('cards_humanos.json'), lerJson('decks.json'),
  ]);
  for (const categoria of Object.keys(banco)) {
    banco[categoria] = [...banco[categoria], ...(marte[categoria] ?? []), ...(humanos[categoria] ?? [])];
  }
  decksProntos = decks.decks;
  cartasPorId = indexarBanco(banco);
  return banco;
}

// Liga os botões do duelo. "opcoes.aoVoltarAoMenu" é chamado ao sair do duelo para o menu.
export function configurarUI(opcoes = {}) {
  aoVoltarAoMenu = opcoes.aoVoltarAoMenu ?? (() => {});
  configurarBotoes();
  // Gancho só para testes automáticos de navegador: abra a página com ?depurar no endereço.
  // A Sala de Testes (?sala) usa o mesmo gancho, com algumas funções a mais.
  const params = new URLSearchParams(location.search);
  if (params.has('depurar') || params.has('sala')) {
    window.__rbc = {
      get estado() { return estado; }, renderizar, criarCartaPorId: (id) => cartasPorId[id],
      get cartasPorId() { return cartasPorId; }, criarCartaEl, mostrarDetalhes,
      definirEstado(novo) { estado = novo; modo = null; campoAnterior = null; visiveis = new Set(); anunciados = new Set(); },
      definirIA(ligada) { iaAtiva = ligada; },
    };
  }
}
