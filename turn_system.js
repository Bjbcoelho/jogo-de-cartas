// turn_system.js
// ---------------------------------------------------------------
// Controla as FASES do turno e as ações da Main Phase.
// Regra de ouro: jogada inválida NUNCA lança exceção; devolve
// { ok:false, motivo:"..." }. Jogada válida devolve { ok:true, ... }.
// ---------------------------------------------------------------

import {
  comprarCarta, destruirMonstro, enviarParaCemiterio, encontrarSlotVazio,
  criarSlotMonstro, oponenteDe, verificarVitoria, contar,
} from './game_state.js';
import { dispararArmadilhas, dispararInvocacao } from './rules_engine.js';

export const LIMITE_MAO = 6;

// Atalho para montar a resposta de erro.
export function falha(motivo) {
  return { ok: false, motivo };
}

// Confere se a partida continua e se estamos na Main Phase.
// Devolve o objeto de erro (se houver problema) ou null (se está tudo certo).
export function validarMain(estado) {
  if (estado.vencedor !== null) return falha('A partida já terminou.');
  if (estado.fase !== 'main') return falha('Essa ação só pode ser feita na Main Phase.');
  return null;
}

// Quantos tributos cada nível exige (regra do Documento de Regras).
export function tributosNecessarios(nivel) {
  if (nivel <= 4) return 0;
  if (nivel <= 6) return 1;
  return 2;
}

// Efeitos simples usados na Standby Phase (o motor completo está no rules_engine.js,
// que depende deste arquivo; por isso aqui fica uma versão enxuta para evitar import circular).
function aplicarEfeitoStandby(estado, idJogador, efeito) {
  const idAlvo = efeito.alvo === 'oponente' ? oponenteDe(idJogador) : idJogador;
  if (efeito.acao === 'curar_pv') {
    estado.jogadores[idAlvo].pontos_vida += efeito.valor;
  } else if (efeito.acao === 'causar_dano_pv') {
    const j = estado.jogadores[idAlvo];
    j.pontos_vida = Math.max(0, j.pontos_vida - efeito.valor);
  } else if (efeito.acao === 'comprar_carta') {
    for (let i = 0; i < efeito.valor; i++) comprarCarta(estado, idJogador);
  }
}

// 1) Começo do turno: fase "draw".
// - zera as flags do jogador da vez;
// - compra 1 carta (exceto o jogador que começa, no turno 1);
// - avança para "standby".
export function iniciarTurno(estado) {
  if (estado.vencedor !== null) return falha('A partida já terminou.');
  estado.fase = 'draw';
  const jogador = estado.jogadores[estado.jogadorDaVez];

  jogador.flags.invocouNormalNoTurno = false;
  for (const slot of jogador.zona_monstros) {
    if (!slot) continue;
    slot.jaAtacou = false;
    slot.mudouPosicao = false;
    slot.invocadoNesteTurno = false;
  }

  // O turno 1 é sempre do jogador que começou: ele não compra.
  if (estado.turno !== 1) {
    const resultado = comprarCarta(estado, jogador.id);
    if (!resultado.ok) return resultado; // deckout: o vencedor já foi definido
  }

  estado.fase = 'standby';
  return { ok: true };
}

// 2) Standby Phase: monstros virados para cima com efeito de gatilho "standby" agem.
// Depois avança para a Main Phase.
export function resolverStandby(estado) {
  if (estado.vencedor !== null) return falha('A partida já terminou.');
  if (estado.fase !== 'standby') return falha('Não estamos na Standby Phase.');
  const jogador = estado.jogadores[estado.jogadorDaVez];

  for (const slot of jogador.zona_monstros) {
    if (!slot || slot.viradaParaBaixo) continue;
    const efeito = slot.carta.habilidade_especial ?? slot.carta.efeito;
    if (efeito && efeito.gatilho === 'standby') aplicarEfeitoStandby(estado, jogador.id, efeito);
  }

  verificarVitoria(estado);
  if (estado.vencedor === null) estado.fase = 'main';
  return { ok: true };
}

// Atalho para começar a partida: turno 1 = iniciarTurno + resolverStandby (cai na Main Phase).
export function comecarPartida(estado) {
  const r = iniciarTurno(estado);
  if (!r.ok) return r;
  return resolverStandby(estado);
}

// 3) Avança a fase: main -> battle -> end.
export function avancarFase(estado) {
  if (estado.vencedor !== null) return falha('A partida já terminou.');
  if (estado.fase === 'main') {
    estado.fase = 'battle';
    if (estado.turno === 1) {
      // A fase existe, mas declararAtaque vai recusar ataques neste turno.
      return { ok: true, aviso: 'Ataques estão bloqueados no primeiro turno do jogador que começa.' };
    }
    return { ok: true };
  }
  if (estado.fase === 'battle') {
    estado.fase = 'end';
    return { ok: true };
  }
  return falha(`Não é possível avançar a partir da fase "${estado.fase}".`);
}

// 4) Invocação Normal: 1 por turno, da mão para um slot vago.
// "indicesTributos" são os slots de monstro (do próprio jogador) que serão sacrificados.
export function invocarNormal(estado, indiceMao, posicao, indicesTributos = []) {
  const erro = validarMain(estado);
  if (erro) return erro;

  const jogador = estado.jogadores[estado.jogadorDaVez];
  if (jogador.flags.invocouNormalNoTurno) return falha('Você já fez a Invocação Normal neste turno.');
  if (posicao !== 'ataque' && posicao !== 'defesa') return falha('Posição inválida: use "ataque" ou "defesa".');

  const carta = jogador.mao[indiceMao];
  if (!carta) return falha('Não há carta nessa posição da mão.');
  if (carta.tipo !== 'monstro') return falha('Só monstros comuns podem ser invocados normalmente.');

  // Valida os tributos: quantidade exata, slots ocupados e sem repetição.
  const necessarios = tributosNecessarios(carta.nivel);
  if (indicesTributos.length !== necessarios) {
    return falha(`${carta.nome} (nível ${carta.nivel}) exige ${necessarios} tributo(s); você escolheu ${indicesTributos.length}.`);
  }
  if (new Set(indicesTributos).size !== indicesTributos.length) return falha('Você escolheu o mesmo monstro mais de uma vez.');
  for (const i of indicesTributos) {
    if (!jogador.zona_monstros[i]) return falha('Um dos tributos escolhidos não tem monstro.');
  }

  // Os tributos liberam slots, então contamos vagas + tributos.
  const vagas = jogador.zona_monstros.filter((s) => s === null).length + indicesTributos.length;
  if (vagas < 1) return falha('Não há slot de monstro vago.');

  // Tudo certo: sacrifica, tira da mão e coloca no primeiro slot vago.
  for (const i of indicesTributos) destruirMonstro(estado, jogador.id, i);
  jogador.mao.splice(indiceMao, 1);
  const indiceSlot = encontrarSlotVazio(jogador.zona_monstros);
  jogador.zona_monstros[indiceSlot] = criarSlotMonstro(carta, posicao, posicao === 'defesa');
  jogador.flags.invocouNormalNoTurno = true;
  // O oponente pode ter armadilhas que respondem a invocações.
  contar(estado, jogador.id, 'invocacoes');
  const armadilhas = dispararArmadilhas(estado, 'invocacao', oponenteDe(jogador.id), { indiceAlvo: indiceSlot });
  // Se o monstro sobreviveu às armadilhas e entrou virado para cima, o efeito "ao_invocar" dele acontece.
  const efeitos = jogador.zona_monstros[indiceSlot]?.carta === carta ? dispararInvocacao(estado, jogador.id, indiceSlot) : [];
  verificarVitoria(estado);
  return { ok: true, indiceSlot, armadilhas, efeitos };
}

// 5) Posicionar magia, armadilha, equipamento ou carta de campo.
export function posicionarCarta(estado, indiceMao) {
  const erro = validarMain(estado);
  if (erro) return erro;

  const jogador = estado.jogadores[estado.jogadorDaVez];
  const carta = jogador.mao[indiceMao];
  if (!carta) return falha('Não há carta nessa posição da mão.');
  if (carta.tipo === 'monstro' || carta.tipo === 'fusao') {
    return falha('Monstros são invocados, não posicionados.');
  }

  if (carta.tipo === 'campo') {
    // Só existe UMA carta de campo no jogo: a antiga vai ao cemitério do dono.
    if (estado.cartaCampo) enviarParaCemiterio(estado, jogador.id, estado.cartaCampo);
    estado.cartaCampo = carta;
    jogador.mao.splice(indiceMao, 1);
    return { ok: true, local: 'campo' };
  }

  const indiceSlot = encontrarSlotVazio(jogador.zona_magias_armadilhas);
  if (indiceSlot === -1) return falha('A zona de magias/armadilhas está cheia.');
  jogador.zona_magias_armadilhas[indiceSlot] = {
    carta,
    viradaParaBaixo: carta.tipo === 'armadilha', // armadilhas ficam viradas para baixo
    turnoBaixada: estado.turno,                  // armadilha só ativa a partir do turno seguinte
  };
  jogador.mao.splice(indiceMao, 1);
  return { ok: true, local: 'zona_magias', indiceSlot };
}

// 6) Mudar a posição (ataque <-> defesa): 1 vez por turno, só na main phase,
// e nunca no turno em que o monstro foi invocado.
export function mudarPosicao(estado, indiceSlot) {
  const erro = validarMain(estado);
  if (erro) return erro;

  const jogador = estado.jogadores[estado.jogadorDaVez];
  const slot = jogador.zona_monstros[indiceSlot];
  if (!slot) return falha('Não há monstro nesse slot.');
  if (slot.invocadoNesteTurno) return falha('Não é possível mudar a posição de um monstro invocado neste turno.');
  if (slot.mudouPosicao) return falha('Este monstro já mudou de posição neste turno.');

  // Ao mudar, o monstro sempre fica virado para cima.
  slot.posicao = slot.posicao === 'ataque' ? 'defesa' : 'ataque';
  slot.viradaParaBaixo = false;
  slot.mudouPosicao = true;
  return { ok: true, posicao: slot.posicao };
}

// 7) Fim do turno: descarta o excesso de mão, passa a vez e começa o próximo turno.
export function finalizarTurno(estado) {
  if (estado.vencedor !== null) return falha('A partida já terminou.');
  if (!['main', 'battle', 'end'].includes(estado.fase)) return falha('Você só pode finalizar o turno a partir da Main/Battle/End Phase.');

  estado.fase = 'end';
  const jogador = estado.jogadores[estado.jogadorDaVez];

  // Descarta as últimas cartas da mão até sobrar o limite.
  let descartadas = 0;
  while (jogador.mao.length > LIMITE_MAO) {
    enviarParaCemiterio(estado, jogador.id, jogador.mao.pop());
    descartadas += 1;
  }

  estado.jogadorDaVez = oponenteDe(estado.jogadorDaVez);
  estado.turno += 1;

  const inicio = iniciarTurno(estado);
  if (!inicio.ok) return { ...inicio, descartadas };
  resolverStandby(estado);
  return { ok: true, descartadas };
}
