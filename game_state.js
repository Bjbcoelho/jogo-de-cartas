// game_state.js
// ---------------------------------------------------------------
// ESTADO DO JOGO e operações básicas.
//
// Ideia central: o estado é um objeto SIMPLES (só números, textos,
// listas e objetos). Nada de classes com métodos escondidos. Por quê?
//  1) dá para salvar/carregar com JSON.stringify/parse;
//  2) fica fácil de enxergar e depurar (console.log(estado) mostra tudo);
//  3) a interface só "lê" o estado e as regras só "alteram" o estado.
//
// Convenção das funções que podem falhar:
//   retornam { ok: true, ... }  ou  { ok: false, motivo: "texto" }
// ---------------------------------------------------------------

export const TAMANHO_ZONA = 5;            // 5 slots de monstro e 5 de magia/armadilha
export const PONTOS_VIDA_INICIAIS = 8000;
export const CARTAS_INICIAIS = 5;

// ---------- Pequenas utilidades ----------

// O oponente do jogador 0 é o 1, e vice-versa.
export function oponenteDe(idJogador) {
  return 1 - idJogador;
}

// Nome amigável para mensagens ("Jogador 1" é o id 0).
export function nomeJogador(idJogador) {
  return `Jogador ${idJogador + 1}`;
}

// Fisher-Yates: percorre a lista de trás para frente e troca cada posição
// com uma posição sorteada entre 0 e ela mesma. Gera embaralhamento justo.
// Trabalha numa CÓPIA, então a lista original não é alterada.
export function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// ---------- Criação de cartas e slots ----------

let contadorUid = 0;

// Cria uma CÓPIA da carta do banco para usar em partida.
// - "uid" é único: duas cópias da mesma carta precisam ser distinguíveis.
// - "dono" guarda quem é o dono (o cemitério certo recebe a carta depois).
// structuredClone faz cópia profunda, então mexer na cópia nunca estraga o banco.
export function criarCartaEmJogo(carta, dono) {
  contadorUid += 1;
  const sufixo = Math.random().toString(36).slice(2, 6);
  return { ...structuredClone(carta), uid: `${carta.id}#${contadorUid}-${sufixo}`, dono };
}

// Cria o "slot de monstro": a carta mais as informações de como ela está em campo.
// Fica marcado como invocado neste turno (usado para proibir mudar de posição).
export function criarSlotMonstro(carta, posicao) {
  return {
    carta,
    posicao,                                  // "ataque" ou "defesa"
    viradaParaBaixo: posicao === 'defesa',    // defesa começa virada para baixo
    equipamento: null,
    invocadoNesteTurno: true,
    jaAtacou: false,
    mudouPosicao: false,
  };
}

// ---------- Estatísticas da partida ----------
// Usadas pelos objetivos do Modo História (historia.js): um contador por jogador.
export function novasEstatisticas() {
  return {
    fusoes: 0, fusoesEspeciais: 0, armadilhasAtivadas: 0,
    danoDiretoSofrido: 0, monstrosPerdidos: 0, invocacoes: 0,
  };
}

// Soma "n" a um contador de estatística (ignora estados antigos sem o campo).
export function contar(estado, idJogador, campo, n = 1) {
  const s = estado.estatisticas?.[idJogador];
  if (s) s[campo] = (s[campo] ?? 0) + n;
}

// ---------- Criação do jogador e do estado ----------

// Monta um jogador. As listas recebidas já devem conter cartas "em jogo" (com uid).
export function criarJogador(id, listaDeckPrincipal, listaDeckExtra) {
  return {
    id,
    pontos_vida: PONTOS_VIDA_INICIAIS,
    mao: [],
    deck_principal: [...listaDeckPrincipal],
    deck_extra: [...listaDeckExtra],
    cemiterio: [],
    zona_monstros: new Array(TAMANHO_ZONA).fill(null),
    zona_magias_armadilhas: new Array(TAMANHO_ZONA).fill(null),
    flags: { invocouNormalNoTurno: false },
  };
}

// Transforma uma lista de IDS em cartas em jogo (cópias com uid e dono).
function idsParaCartas(ids, cartasPorId, dono) {
  return ids.map((id) => {
    const modelo = cartasPorId[id];
    if (!modelo) throw new Error(`Carta desconhecida no deck: "${id}"`);
    return criarCartaEmJogo(modelo, dono);
  });
}

// Cria o estado inicial da partida. Os decks chegam como listas de IDS.
// Passos: embaralhar -> montar jogadores -> comprar 5 -> sortear quem começa.
// O estado fica em turno 1, fase "draw"; quem chama deve usar iniciarTurno().
export function criarEstado(deck0, deckExtra0, deck1, deckExtra1, cartasPorId) {
  const jogador0 = criarJogador(0, embaralhar(idsParaCartas(deck0, cartasPorId, 0)), idsParaCartas(deckExtra0, cartasPorId, 0));
  const jogador1 = criarJogador(1, embaralhar(idsParaCartas(deck1, cartasPorId, 1)), idsParaCartas(deckExtra1, cartasPorId, 1));

  const jogadorInicial = Math.random() < 0.5 ? 0 : 1;
  const estado = {
    turno: 1,
    jogadorDaVez: jogadorInicial,
    jogadorInicial,        // guardamos quem começou: ele não compra nem ataca no turno 1
    fase: 'draw',
    cartaCampo: null,
    vencedor: null,
    jogadores: [jogador0, jogador1],
    estatisticas: [novasEstatisticas(), novasEstatisticas()],
  };

  for (const jogador of estado.jogadores) {
    for (let i = 0; i < CARTAS_INICIAIS; i++) comprarCarta(estado, jogador.id);
  }
  return estado;
}

// ---------- Operações básicas ----------

// Move a carta do topo do deck para a mão.
// Deck vazio = derrota por "deckout": o OPONENTE vence.
export function comprarCarta(estado, idJogador) {
  const jogador = estado.jogadores[idJogador];
  if (jogador.deck_principal.length === 0) {
    if (estado.vencedor === null) estado.vencedor = oponenteDe(idJogador);
    return { ok: false, motivo: 'deckout' };
  }
  const carta = jogador.deck_principal.shift(); // shift() tira o primeiro = topo do deck
  jogador.mao.push(carta);
  return { ok: true, carta };
}

// Coloca a carta no cemitério do DONO dela (campo "dono").
// Se a carta não tiver dono, usa o jogador informado.
export function enviarParaCemiterio(estado, idJogador, carta) {
  const idDono = carta.dono ?? idJogador;
  estado.jogadores[idDono].cemiterio.push(carta);
}

// Remove o monstro do slot e manda ele E o equipamento anexado ao cemitério.
export function destruirMonstro(estado, idJogador, indiceSlot) {
  const jogador = estado.jogadores[idJogador];
  const slot = jogador.zona_monstros[indiceSlot];
  if (!slot) return { ok: false, motivo: 'Não há monstro nesse slot.' };

  jogador.zona_monstros[indiceSlot] = null;
  enviarParaCemiterio(estado, idJogador, slot.carta);
  if (slot.equipamento) enviarParaCemiterio(estado, idJogador, slot.equipamento);
  return { ok: true, carta: slot.carta, equipamento: slot.equipamento };
}

// Índice do primeiro slot vazio da zona (lista de 5), ou -1 se estiver cheia.
export function encontrarSlotVazio(zona) {
  return zona.findIndex((slot) => slot === null);
}

// Aplica a seção "VITÓRIA / DERROTA" do Documento de Regras.
//  - os dois com PV <= 0 -> empate
//  - só um com PV <= 0   -> o outro vence
// Se já existe vencedor (ex.: deckout), mantém. Retorna estado.vencedor.
export function verificarVitoria(estado) {
  const [a, b] = estado.jogadores;
  const aMorto = a.pontos_vida <= 0;
  const bMorto = b.pontos_vida <= 0;
  if (aMorto && bMorto) estado.vencedor = 'empate';
  else if (aMorto) estado.vencedor = 1;
  else if (bMorto) estado.vencedor = 0;
  return estado.vencedor;
}

// Efeitos "básicos" que só mexem em vida e cartas: curar, causar dano, comprar.
// Fica aqui para turn_system.js (efeitos de standby) e rules_engine.js reaproveitarem.
// alvo "oponente" atinge o adversário; qualquer outro alvo atinge o próprio jogador.
export function aplicarEfeitoBasico(estado, idJogador, efeito) {
  const idAlvo = efeito.alvo === 'oponente' ? oponenteDe(idJogador) : idJogador;
  const alvo = estado.jogadores[idAlvo];

  switch (efeito.acao) {
    case 'curar_pv':
      alvo.pontos_vida += efeito.valor;
      return { ok: true, texto: `${nomeJogador(idAlvo)} recuperou ${efeito.valor} PV.` };

    case 'causar_dano_pv':
      alvo.pontos_vida = Math.max(0, alvo.pontos_vida - efeito.valor); // nunca abaixo de 0
      verificarVitoria(estado);
      return { ok: true, texto: `${nomeJogador(idAlvo)} sofreu ${efeito.valor} de dano.` };

    case 'comprar_carta': {
      for (let i = 0; i < efeito.valor; i++) {
        const resultado = comprarCarta(estado, idAlvo);
        if (!resultado.ok) return resultado; // deckout no meio da compra
      }
      return { ok: true, texto: `${nomeJogador(idAlvo)} comprou ${efeito.valor} carta(s).` };
    }

    default:
      return { ok: false, motivo: `Ação não é básica: ${efeito.acao}` };
  }
}

// ---------- Salvar / carregar ----------

// Como o estado é um objeto simples, JSON resolve.
export function serializarEstado(estado) {
  return JSON.stringify(estado);
}

export function carregarEstado(texto) {
  return JSON.parse(texto);
}
