// menu.js
// ---------------------------------------------------------------
// Telas do jogo fora do duelo: título, menu principal, coleção de cartas,
// como jogar e opções. NÃO há regras de jogo aqui: quando o jogador escolhe
// "Duelo", este arquivo só chama iniciarDuelo() da ui.js.
//
// Seções: 1) opções salvas  2) troca de telas  3) menu e vitrine
//         4) coleção  5) opções  6) teclado  7) início
// ---------------------------------------------------------------

import { carregarBanco, configurarUI, iniciarDuelo, criarCartaEl, mostrarDetalhes, listarDecks } from './ui.js';
import { definirSons } from './sons.js';
import { definirAmbiente, definirVolumeAmbiente } from './ambiente.js';
import { iniciarClima, definirQualidade } from './clima.js';
import { lerProgresso, salvarProgresso, faseLiberada, concluirFase, descreverObjetivo, validarHistoria } from './historia.js';

const $ = (id) => document.getElementById(id);

// =============================================================
// 1) OPÇÕES SALVAS (localStorage, com proteção: ele pode estar bloqueado)
// =============================================================

const CHAVE_CONFIG = 'rbc_config_v1';
const CONFIG_PADRAO = { velocidadeIA: 'normal', quemComeca: 'sorteio', deckJogador: 'aleatorio', deckOponente: 'aleatorio', animacaoFusao: 'completa', sons: 'ligados', ambiente: 'ligado', volume: 'medio', qualidade: 'alta', layoutCarta: 'novo' };
const ATRASOS_IA = { lenta: 1400, normal: 800, rapida: 250 }; // milissegundos entre as ações do computador

function lerConfig() {
  try {
    const texto = localStorage.getItem(CHAVE_CONFIG);
    if (texto) return { ...CONFIG_PADRAO, ...JSON.parse(texto) };
  } catch (erro) {
    // sem localStorage (modo privado, por exemplo): usa os padrões
  }
  return { ...CONFIG_PADRAO };
}

function salvarConfig() {
  try {
    localStorage.setItem(CHAVE_CONFIG, JSON.stringify(config));
  } catch (erro) {
    // não conseguiu salvar: o jogo continua funcionando com as opções da sessão
  }
}

let config = lerConfig();
let banco = null;      // cards_db.json carregado
let historia = null;   // historia.json carregado (fases do Modo História)
let progresso = { concluidas: [] }; // fases do Modo História já concluídas (salvo no navegador)
let faseSelecionada = 0;
let carregado = false; // o banco já foi lido?

// =============================================================
// 2) TROCA DE TELAS
// =============================================================

const TELAS = ['tela-titulo', 'tela-menu', 'tela-historia', 'tela-colecao', 'tela-regras', 'tela-opcoes'];
let telaAtual = null; // null = estamos no duelo

function mostrarTela(id) {
  telaAtual = id;
  for (const t of TELAS) $(t).classList.toggle('ativa', t === id);
  // Foco no primeiro botão da tela, para o teclado já funcionar.
  $(id).querySelector('.menu-item, .btn-voltar')?.focus({ preventScroll: true });
}

function esconderTelas() {
  telaAtual = null;
  for (const t of TELAS) $(t).classList.remove('ativa');
}

// =============================================================
// 3) MENU PRINCIPAL E VITRINE
// =============================================================

// Três fusões sorteadas aparecem em leque ao lado do menu.
function desenharVitrine() {
  const caixa = $('vitrine');
  caixa.innerHTML = '';
  const sorteadas = [...banco.fusoes].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const carta of sorteadas) caixa.appendChild(criarCartaEl(carta));
}

// Visual das cartas: "novo" (arte em destaque) ou "classico". O CSS lê o atributo do body.
// Aplica as opções de som e de qualidade (efeitos, ambiente, volume, partículas).
function aplicarSensorial() {
  definirSons(config.sons === 'ligados');
  definirAmbiente(config.ambiente === 'ligado');
  definirVolumeAmbiente(config.volume);
  definirQualidade(config.qualidade);
}

function aplicarLayout() {
  document.body.dataset.layout = config.layoutCarta === 'classico' ? 'classico' : 'novo';
  const b = $('btn-layout');
  if (b) b.textContent = `Visual: ${config.layoutCarta === 'classico' ? 'Clássico' : 'Novo'}`;
}

function irParaMenu() {
  desenharVitrine();
  mostrarTela('tela-menu');
}

function comecarDuelo(contraIA) {
  esconderTelas();
  iniciarDuelo({
    contraIA,
    quemComeca: config.quemComeca,
    atrasoIA: ATRASOS_IA[config.velocidadeIA] ?? ATRASOS_IA.normal,
    deckJ1: config.deckJogador,
    deckJ2: config.deckOponente,
    animacaoFusao: config.animacaoFusao,
  });
}

function aoEscolherNoMenu(acao) {
  if (acao === 'historia') abrirHistoria();
  else if (acao === 'ia') comecarDuelo(true);
  else if (acao === 'local') comecarDuelo(false);
  else if (acao === 'colecao') { desenharColecao(); mostrarTela('tela-colecao'); }
  else if (acao === 'regras') mostrarTela('tela-regras');
  else if (acao === 'opcoes') { atualizarBotoesDeOpcao(); mostrarTela('tela-opcoes'); }
}

// =============================================================
// 3b) MODO HISTÓRIA (mapa de fases)
// =============================================================

const NOMES_DECK = { aleatorio: 'Deck aleatório', marciano: 'Deck Marciano', humanos: 'Deck Humanos' };

// localStorage pode lançar erro (modo privado); o salvamento já se protege, aqui só pegamos o objeto.
function armazenamento() {
  try { return window.localStorage; } catch (erro) { return null; }
}

function abrirHistoria() {
  if (!historia) { alert('Não consegui carregar o historia.json.'); return; }
  progresso = lerProgresso(armazenamento());
  // Seleciona a próxima fase ainda não concluída (ou a última, se tudo foi concluído).
  const proxima = historia.fases.findIndex((f) => !progresso.concluidas.includes(f.id));
  faseSelecionada = proxima >= 0 ? proxima : historia.fases.length - 1;
  desenharHistoria();
  mostrarTela('tela-historia');
}

function desenharHistoria() {
  const fases = historia.fases;
  $('historia-titulo').textContent = historia.titulo;
  $('historia-contagem').textContent = `${progresso.concluidas.length} de ${fases.length} fases`;

  const lista = $('historia-lista');
  lista.innerHTML = '';
  fases.forEach((fase, i) => {
    const liberada = faseLiberada(fases, progresso, i);
    const concluida = progresso.concluidas.includes(fase.id);
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = concluida ? 'concluida' : liberada ? 'liberada' : '';
    b.disabled = !liberada;
    b.setAttribute('aria-current', String(i === faseSelecionada));
    b.innerHTML = `<span class="num">${i + 1}</span><span><span class="nome"></span><small></small></span><span class="selo">${concluida ? '✔' : liberada ? '▶' : '🔒'}</span>`;
    b.querySelector('.nome').textContent = fase.nome;
    b.querySelector('small').textContent = `${fase.oponente.nome} · IA nível ${fase.oponente.nivel}`;
    b.addEventListener('click', () => { faseSelecionada = i; desenharHistoria(); });
    li.appendChild(b);
    lista.appendChild(li);
  });
  const reiniciar = document.createElement('li');
  const br = document.createElement('button');
  br.textContent = 'Apagar progresso';
  br.style.justifyContent = 'center';
  br.addEventListener('click', () => {
    if (!confirm('Apagar todo o progresso do Modo História?')) return;
    progresso = { concluidas: [] };
    salvarProgresso(armazenamento(), progresso);
    faseSelecionada = 0;
    desenharHistoria();
  });
  reiniciar.appendChild(br);
  lista.appendChild(reiniciar);

  desenharDetalheDaFase();
}

function desenharDetalheDaFase() {
  const fases = historia.fases;
  const i = faseSelecionada;
  const fase = fases[i];
  const caixa = $('historia-detalhe');
  caixa.innerHTML = '';
  const add = (tag, texto, classe = '') => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    e.textContent = texto;
    caixa.appendChild(e);
    return e;
  };
  const concluida = progresso.concluidas.includes(fase.id);
  const liberada = faseLiberada(fases, progresso, i);

  if (progresso.concluidas.length === fases.length) add('p', '🏆 Você concluiu toda a história! Rejogue qualquer fase quando quiser.', 'fala');
  if (i === 0) add('p', historia.prologo, 'fala');
  add('h3', `Fase ${i + 1} · ${fase.nome}`);
  add('div', '★'.repeat(fase.oponente.nivel) + '☆'.repeat(5 - fase.oponente.nivel), 'estrelas-nivel').title = 'Dificuldade';
  add('p', fase.historia, 'fala');

  const info = document.createElement('div');
  info.className = 'oponente';
  const tags = [
    `Oponente: ${fase.oponente.nome}`, NOMES_DECK[fase.oponente.deck] ?? fase.oponente.deck,
    `${fase.oponente.pv} PV`, `IA nível ${fase.oponente.nivel}`,
  ];
  if (fase.oponente.cartasExtras) tags.push(`+${fase.oponente.cartasExtras} carta(s) na mão inicial`);
  for (const t of tags) {
    const sp = document.createElement('span');
    sp.className = 'etiqueta-info';
    sp.textContent = t;
    info.appendChild(sp);
  }
  caixa.appendChild(info);

  add('h4', 'Objetivos (cumpra todos)');
  const ul = document.createElement('ul');
  for (const o of fase.objetivos) {
    const li = document.createElement('li');
    li.textContent = descreverObjetivo(o);
    ul.appendChild(li);
  }
  caixa.appendChild(ul);
  add('p', `Seu deck: ${NOMES_DECK[config.deckJogador] ?? config.deckJogador} (mude em Opções).`, 'nota');

  const botao = document.createElement('button');
  botao.className = 'menu-item';
  botao.disabled = !liberada;
  botao.textContent = !liberada ? '🔒 Conclua a fase anterior' : concluida ? 'Jogar de novo' : 'Duelar';
  botao.addEventListener('click', () => comecarFase(i));
  caixa.appendChild(botao);
}

function comecarFase(i) {
  const fase = historia.fases[i];
  esconderTelas();
  iniciarDuelo({
    historia: {
      fase,
      // Chamado quando o jogador vence E cumpre todos os objetivos: salva na hora.
      aoConcluir: (f) => { progresso = concluirFase(progresso, f.id); salvarProgresso(armazenamento(), progresso); },
      // Chamado ao sair do duelo: volta ao mapa, já com a próxima fase selecionada se esta foi concluída.
      aoSair: () => {
        faseSelecionada = progresso.concluidas.includes(fase.id) ? Math.min(i + 1, historia.fases.length - 1) : i;
        desenharHistoria();
        mostrarTela('tela-historia');
      },
    },
    quemComeca: config.quemComeca,
    atrasoIA: ATRASOS_IA[config.velocidadeIA] ?? ATRASOS_IA.normal,
    deckJ1: config.deckJogador,
    animacaoFusao: config.animacaoFusao,
  });
}

// =============================================================
// 4) COLEÇÃO DE CARTAS
// =============================================================

const BIOMAS = ['humano', 'inseto', 'marinho', 'planetario'];
const FILTROS = [
  ['todas', 'Todas'], ['humano', '🧑 Humano'], ['inseto', '🐛 Inseto'], ['marinho', '🌊 Marinho'],
  ['planetario', '🪐 Planetário'], ['fusao', '🧬 Fusões'], ['magia', '✨ Magias'],
  ['equipamento', '🗡️ Equipamentos'], ['armadilha', '🪤 Armadilhas'], ['campo', '🏞️ Campos'],
];
let filtroAtual = 'todas';

function todasAsCartas() {
  return [...banco.monstros, ...banco.fusoes, ...banco.magias, ...banco.equipamentos, ...banco.armadilhas, ...banco.campos];
}

// Filtro de bioma pega monstros e fusões daquele bioma; os demais filtram pelo tipo da carta.
function passaNoFiltro(carta, filtro) {
  if (filtro === 'todas') return true;
  if (BIOMAS.includes(filtro)) return carta.bioma === filtro;
  return carta.tipo === filtro;
}

function desenharFiltros() {
  const barra = $('colecao-filtros');
  barra.innerHTML = '';
  for (const [valor, rotulo] of FILTROS) {
    const b = document.createElement('button');
    b.textContent = rotulo;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(valor === filtroAtual));
    b.addEventListener('click', () => { filtroAtual = valor; desenharColecao(); });
    barra.appendChild(b);
  }
}

function desenharColecao() {
  desenharFiltros();
  const grade = $('colecao-grade');
  grade.innerHTML = '';
  const painel = $('colecao-detalhes');
  const todas = todasAsCartas();
  const visiveis = todas.filter((c) => passaNoFiltro(c, filtroAtual));

  for (const carta of visiveis) {
    const c = criarCartaEl(carta);
    c.classList.add('clicavel');
    const mostrar = () => mostrarDetalhes(carta, carta.atk, carta.def, painel);
    c.addEventListener('mouseenter', mostrar);
    c.addEventListener('click', mostrar);
    grade.appendChild(c);
  }
  $('colecao-contagem').textContent = `${visiveis.length} de ${todas.length} cartas`;
  if (!visiveis.length) painel.innerHTML = '<p class="vazio">Nenhuma carta neste filtro.</p>';
}

// =============================================================
// 5) OPÇÕES
// =============================================================

// Marca (aria-pressed) o botão que corresponde ao valor salvo de cada grupo.
function atualizarBotoesDeOpcao() {
  for (const grupo of document.querySelectorAll('.grupo-opcao')) {
    const valorAtual = config[grupo.dataset.chave];
    for (const b of grupo.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.valor === valorAtual));
    }
  }
}

// Botões de escolha de deck: "Aleatório" + um por deck pronto (lidos do decks.json).
function montarBotoesDeDeck() {
  for (const chave of ['deckJogador', 'deckOponente']) {
    const seg = document.querySelector(`.grupo-opcao[data-chave="${chave}"] .seg`);
    seg.innerHTML = '';
    for (const [valor, rotulo] of [['aleatorio', 'Aleatório'], ...listarDecks().map((d) => [d.id, d.nome])]) {
      const b = document.createElement('button');
      b.dataset.valor = valor;
      b.textContent = rotulo;
      seg.appendChild(b);
    }
  }
}

function ligarOpcoes() {
  for (const grupo of document.querySelectorAll('.grupo-opcao')) {
    grupo.addEventListener('click', (ev) => {
      const botao = ev.target.closest('button[data-valor]');
      if (!botao) return;
      config[grupo.dataset.chave] = botao.dataset.valor;
      aplicarSensorial();
      aplicarLayout();
      salvarConfig();
      atualizarBotoesDeOpcao();
    });
  }
  $('btn-padrao').addEventListener('click', () => {
    config = { ...CONFIG_PADRAO };
    aplicarSensorial();
    aplicarLayout();
    salvarConfig();
    atualizarBotoesDeOpcao();
  });
}

// =============================================================
// 6) TECLADO E CLIQUES
// =============================================================

// Esc: volta uma tela. Do menu principal volta ao título.
function voltar() {
  if (telaAtual === 'tela-menu') mostrarTela('tela-titulo');
  else if (telaAtual && telaAtual !== 'tela-titulo') irParaMenu();
}

function ligarEventos() {
  // Título: clique ou qualquer tecla (se o banco já carregou) abre o menu.
  $('tela-titulo').addEventListener('click', () => { if (carregado) irParaMenu(); });

  // Menu principal
  $('tela-menu').addEventListener('click', (ev) => {
    const botao = ev.target.closest('.menu-item');
    if (botao) aoEscolherNoMenu(botao.dataset.acao);
  });

  // Botões "← Voltar" das telas secundárias
  for (const b of document.querySelectorAll('.btn-voltar')) {
    b.addEventListener('click', () => { if (b.dataset.destino === 'tela-menu') irParaMenu(); });
  }

  ligarOpcoes();

  document.addEventListener('keydown', (ev) => {
    if (!telaAtual) return; // no duelo quem cuida do teclado é a ui.js

    if (telaAtual === 'tela-titulo') {
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(ev.key)) return;
      // preventDefault é essencial: sem ele, o Enter/Espaço "clicaria" no botão do menu que acabou de ganhar o foco.
      ev.preventDefault();
      if (carregado) irParaMenu();
      return;
    }
    if (ev.key === 'Escape') { voltar(); return; }

    // Menu principal: setas movem o foco entre as opções.
    if (telaAtual === 'tela-menu' && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      const itens = [...$('tela-menu').querySelectorAll('.menu-item')];
      const i = itens.indexOf(document.activeElement);
      const proximo = ev.key === 'ArrowDown' ? (i + 1) % itens.length : (i - 1 + itens.length) % itens.length;
      itens[i < 0 ? 0 : proximo].focus();
    }
  });
}

// =============================================================
// 7) INÍCIO
// =============================================================

async function iniciar() {
  aplicarSensorial();
  iniciarClima($('mesa'));
  aplicarLayout();
  $('btn-layout').addEventListener('click', () => {
    config.layoutCarta = config.layoutCarta === 'classico' ? 'novo' : 'classico';
    salvarConfig();
    aplicarLayout();
    desenharColecao();
  });
  configurarUI({ aoVoltarAoMenu: irParaMenu });
  ligarEventos();
  mostrarTela('tela-titulo');
  try {
    banco = await carregarBanco();
    montarBotoesDeDeck();
    try {
      const resposta = await fetch('historia.json');
      const dados = await resposta.json();
      const problemas = validarHistoria(dados, ['aleatorio', ...listarDecks().map((d) => d.id)]);
      if (problemas.length) console.warn('historia.json com problemas:', problemas);
      else historia = dados;
    } catch (erro) {
      console.warn('Modo História indisponível:', erro);
    }
    carregado = true;
    $('carregando').classList.add('oculto');
    $('pressione').classList.remove('oculto');
    // Sala de Testes: index.html?sala abre direto num duelo, com o painel de ferramentas por cima.
    if (new URLSearchParams(location.search).has('sala')) {
      const sala = await import('./sala.js');
      esconderTelas();
      iniciarDuelo({ contraIA: false, deckJ1: 'aleatorio', deckJ2: 'aleatorio', quemComeca: 'jogador1', animacaoFusao: 'desligada' });
      sala.montarSala();
    }
  } catch (erro) {
    console.error(erro);
    $('carregando').classList.add('oculto');
    $('erro-carga').classList.remove('oculto');
  }
}

iniciar();
