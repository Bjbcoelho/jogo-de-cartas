// rules_engine.js
// ---------------------------------------------------------------
// Regras avançadas: stats efetivos, fusão/evolução, efeitos estruturados,
// magias e batalha. Reaproveita as funções de game_state.js e turn_system.js.
// ---------------------------------------------------------------

import {
  comprarCarta, destruirMonstro, enviarParaCemiterio, encontrarSlotVazio,
  criarSlotMonstro, oponenteDe, verificarVitoria, contar,
} from './game_state.js';
import { validarMain, falha, posicionarCarta } from './turn_system.js';

// Uma carta pode ter o efeito em "habilidade_especial" (fusões) ou em "efeito".
function efeitoDe(carta) {
  return carta.habilidade_especial ?? carta.efeito ?? null;
}

// Tira o prefixo do id e troca "_" por espaço, só para mensagens amigáveis.
function nomeAmigavel(id) {
  return id.replace(/^(monstro|fusao|magia|equip|armadilha|campo)_/, '').replace(/_/g, ' ');
}

// Tira pontos de vida sem deixar ficarem negativos.
function perderPV(estado, idJogador, valor) {
  const j = estado.jogadores[idJogador];
  j.pontos_vida = Math.max(0, j.pontos_vida - valor);
}

// ---------------------------------------------------------------
// ATK/DEF EFETIVO
// efetivo = base + bônus da carta de campo + equipamento + bônus de efeitos
// Nunca altera os valores base da carta: tudo é recalculado na hora.
// ---------------------------------------------------------------
export function calcularStatsEfetivos(estado, idJogador, indiceSlot) {
  const jogador = estado.jogadores[idJogador];
  const slot = jogador?.zona_monstros[indiceSlot];
  if (!slot) return { atk: 0, def: 0 };

  const carta = slot.carta;
  let atk = carta.atk;
  let def = carta.def;

  // 1) Carta de campo (compartilhada: vale para os monstros dos DOIS jogadores).
  if (estado.cartaCampo) {
    for (const mod of estado.cartaCampo.modificadores_globais ?? []) {
      if (mod.bioma === carta.bioma) {
        atk += mod.mod_atk;
        def += mod.mod_def;
      }
    }
  }

  // 2) Equipamento anexado.
  // Um equipamento pode ter um segundo efeito ("efeito_secundario"), ex.: +300 ATK e +300 DEF.
  for (const efEquip of [slot.equipamento?.efeito, slot.equipamento?.efeito_secundario]) {
    if (!efEquip) continue;
    if (efEquip.acao === 'mod_atk') atk += efEquip.valor;
    if (efEquip.acao === 'mod_def') def += efEquip.valor;
  }

  // 3) Bônus permanentes vindos de magias (mod_atk/mod_def aplicados no slot).
  atk += slot.bonusAtk ?? 0;
  def += slot.bonusDef ?? 0;

  // 4) Habilidades contínuas dos monstros virados para cima do mesmo dono.
  jogador.zona_monstros.forEach((outro, i) => {
    if (!outro || outro.viradaParaBaixo) return;
    const ef = efeitoDe(outro.carta);
    if (!ef || ef.gatilho !== 'continuo') return;
    const aplica =
      (ef.alvo === 'proprio_monstro' && i === indiceSlot) ||
      ef.alvo === 'todos_monstros' ||
      (ef.alvo === 'monstros_do_bioma' && ef.bioma === carta.bioma);
    if (!aplica) return;
    if (ef.acao === 'mod_atk') atk += ef.valor;
    if (ef.acao === 'mod_def') def += ef.valor;
  });

  // 5) Auras do OPONENTE: habilidades contínuas com alvo "monstros_oponente" (ex.: -200 ATK nos seus monstros).
  estado.jogadores[oponenteDe(idJogador)].zona_monstros.forEach((outro) => {
    if (!outro || outro.viradaParaBaixo) return;
    const ef = efeitoDe(outro.carta);
    if (!ef || ef.gatilho !== 'continuo' || ef.alvo !== 'monstros_oponente') return;
    if (ef.bioma && ef.bioma !== carta.bioma) return;
    if (ef.acao === 'mod_atk') atk += ef.valor;
    if (ef.acao === 'mod_def') def += ef.valor;
  });

  return { atk: Math.max(0, atk), def: Math.max(0, def) };
}

// ---------------------------------------------------------------
// FUSÕES ESPECIAIS: condições únicas
// ---------------------------------------------------------------
// Uma fusão pode ter "condicao_especial": { tipo, valor?, id?, descricao_texto }. Além dos materiais,
// a condição precisa ser verdadeira NA HORA de evoluir. Tipos:
//   pv_maximo / pv_minimo       -> seus PV <= valor / >= valor
//   pv_menor_que_oponente       -> você está com menos PV que o oponente
//   cemiterio_minimo            -> pelo menos "valor" cartas no seu cemitério
//   campo_ativo                 -> a carta de campo "id" precisa estar ativa
//   turno_minimo                -> o turno global já chegou em "valor"
//   monstros_minimo             -> você tem pelo menos "valor" monstros em campo
export const TIPOS_CONDICAO = ['pv_maximo', 'pv_minimo', 'pv_menor_que_oponente', 'cemiterio_minimo', 'campo_ativo', 'turno_minimo', 'monstros_minimo'];

export function verificarCondicaoEspecial(estado, idJogador, cond) {
  if (!cond) return { ok: true };
  const jogador = estado.jogadores[idJogador];
  const oponente = estado.jogadores[oponenteDe(idJogador)];
  let ok;
  switch (cond.tipo) {
    case 'pv_maximo': ok = jogador.pontos_vida <= cond.valor; break;
    case 'pv_minimo': ok = jogador.pontos_vida >= cond.valor; break;
    case 'pv_menor_que_oponente': ok = jogador.pontos_vida < oponente.pontos_vida; break;
    case 'cemiterio_minimo': ok = jogador.cemiterio.length >= cond.valor; break;
    case 'campo_ativo': ok = estado.cartaCampo?.id === cond.id; break;
    case 'turno_minimo': ok = estado.turno >= cond.valor; break;
    case 'monstros_minimo': ok = ocupados(jogador.zona_monstros).length >= cond.valor; break;
    default: ok = false;
  }
  return ok ? { ok: true } : { ok: false, motivo: `Condição especial: ${cond.descricao_texto}` };
}

// ---------------------------------------------------------------
// FUSÃO / EVOLUÇÃO
// ---------------------------------------------------------------

// Procura onde está um material, sem reutilizar uma carta já "usada" por outro requisito.
function localizarMaterial(jogador, requisito, usados) {
  const buscas = {
    campo: () => {
      const i = jogador.zona_monstros.findIndex((s) => s && s.carta.id === requisito.id && !usados.has(s.carta.uid));
      return i >= 0 ? { local: 'campo', indice: i, uid: jogador.zona_monstros[i].carta.uid } : null;
    },
    mao: () => {
      const i = jogador.mao.findIndex((c) => c.id === requisito.id && !usados.has(c.uid));
      return i >= 0 ? { local: 'mao', indice: i, uid: jogador.mao[i].uid } : null;
    },
    zona_magias: () => {
      const i = jogador.zona_magias_armadilhas.findIndex((r) => r && r.carta.id === requisito.id && !usados.has(r.carta.uid));
      return i >= 0 ? { local: 'zona_magias', indice: i, uid: jogador.zona_magias_armadilhas[i].carta.uid } : null;
    },
  };
  const ordem = requisito.local === 'mao_ou_zona_magias' ? ['mao', 'zona_magias'] : [requisito.local];
  for (const local of ordem) {
    if (!buscas[local]) continue;
    const achado = buscas[local]();
    if (achado) return { id: requisito.id, ...achado };
  }
  return null;
}

// Confere se o jogador tem a fusão no deck extra e todos os materiais nos lugares certos.
export function podeEvoluir(estado, idJogador, idCartaFusao) {
  const jogador = estado.jogadores[idJogador];
  const fusao = jogador.deck_extra.find((c) => c.id === idCartaFusao);
  if (!fusao) return { ok: false, motivo: 'Essa fusão não está no seu deck extra.', materiais: [] };

  const condicao = verificarCondicaoEspecial(estado, idJogador, fusao.condicao_especial);
  if (!condicao.ok) return { ok: false, motivo: condicao.motivo, materiais: [] };

  const usados = new Set();
  const materiais = [];
  for (const req of fusao.requisitos_fusao ?? []) {
    const achado = localizarMaterial(jogador, req, usados);
    if (!achado) {
      const onde = { campo: 'em campo', mao: 'na mão', zona_magias: 'na zona de magias', mao_ou_zona_magias: 'na mão ou na zona de magias' }[req.local] ?? req.local;
      return { ok: false, motivo: `Falta o material "${nomeAmigavel(req.id)}" ${onde}.`, materiais: [] };
    }
    usados.add(achado.uid);
    materiais.push(achado);
  }
  return { ok: true, motivo: '', materiais };
}

// Realiza a evolução: materiais vão ao cemitério e a fusão entra em campo.
// NÃO conta como Invocação Normal.
export function evoluir(estado, idJogador, idCartaFusao) {
  const erro = validarMain(estado);
  if (erro) return erro;
  if (idJogador !== estado.jogadorDaVez) return falha('Não é a sua vez.');

  const analise = podeEvoluir(estado, idJogador, idCartaFusao);
  if (!analise.ok) return falha(analise.motivo);

  const jogador = estado.jogadores[idJogador];
  const materiaisCampo = analise.materiais.filter((m) => m.local === 'campo');

  // Slot vago: um material de campo libera espaço, então só falha se nada liberar.
  if (encontrarSlotVazio(jogador.zona_monstros) === -1 && materiaisCampo.length === 0) {
    return falha('Não há slot de monstro vago para a evolução.');
  }

  // Materiais da mão: removemos do maior índice para o menor, para os índices não "andarem".
  const indicesMao = analise.materiais.filter((m) => m.local === 'mao').map((m) => m.indice).sort((a, b) => b - a);
  for (const i of indicesMao) {
    const [c] = jogador.mao.splice(i, 1);
    enviarParaCemiterio(estado, idJogador, c);
  }
  // Materiais da zona de magias.
  for (const m of analise.materiais.filter((m) => m.local === 'zona_magias')) {
    const registro = jogador.zona_magias_armadilhas[m.indice];
    jogador.zona_magias_armadilhas[m.indice] = null;
    enviarParaCemiterio(estado, idJogador, registro.carta);
  }
  // Materiais de campo (destruirMonstro também leva o equipamento anexado).
  for (const m of materiaisCampo) destruirMonstro(estado, idJogador, m.indice);

  // A fusão sai do deck extra e entra no primeiro slot vago, em ataque e virada para cima.
  const posExtra = jogador.deck_extra.findIndex((c) => c.id === idCartaFusao);
  const [fusao] = jogador.deck_extra.splice(posExtra, 1);
  const indiceSlot = encontrarSlotVazio(jogador.zona_monstros);
  jogador.zona_monstros[indiceSlot] = criarSlotMonstro(fusao, 'ataque', false); // invocadoNesteTurno = true
  // Balanceamento: a fusão chega "exausta" e não ataca no turno em que é criada (como em Forbidden Memories).
  jogador.zona_monstros[indiceSlot].jaAtacou = true;
  contar(estado, idJogador, 'fusoes');
  if (fusao.condicao_especial) contar(estado, idJogador, 'fusoesEspeciais');

  // Armadilhas do oponente que respondem a fusões e, se a fusão sobreviver, o efeito "ao_invocar" dela.
  const armadilhas = dispararArmadilhas(estado, 'fusao', oponenteDe(idJogador), { indiceAlvo: indiceSlot });
  const efeitos = jogador.zona_monstros[indiceSlot]?.carta === fusao ? dispararInvocacao(estado, idJogador, indiceSlot) : [];
  verificarVitoria(estado);
  return { ok: true, indiceSlot, carta: fusao, armadilhas, efeitos };
}

// Efeito "ao_invocar": acontece quando o monstro entra em campo VIRADO PARA CIMA (ataque ou fusão).
// Devolve a lista de frases para o registro de ações.
export function dispararInvocacao(estado, idJogador, indiceSlot) {
  const slot = estado.jogadores[idJogador].zona_monstros[indiceSlot];
  if (!slot || slot.viradaParaBaixo) return [];
  const ef = efeitoDe(slot.carta);
  if (!ef || ef.gatilho !== 'ao_invocar') return [];
  const r = aplicarEfeito(estado, idJogador, ef, { indiceAlvo: alvoProprio(ef, indiceSlot), origem: slot.carta });
  verificarVitoria(estado);
  return r.ok ? [`✨ ${slot.carta.nome}: ${ef.descricao_texto}`] : [];
}

// ---------------------------------------------------------------
// EFEITOS ESTRUTURADOS
// ---------------------------------------------------------------

// Destrói um monstro e, se ele tiver efeito "ao_ser_destruido", resolve o efeito
// em nome do DONO do monstro.
export function destruirMonstroComEfeito(estado, idJogador, indiceSlot) {
  const slot = estado.jogadores[idJogador].zona_monstros[indiceSlot];
  if (!slot) return falha('Não há monstro nesse slot.');
  const carta = slot.carta;
  const resultado = destruirMonstro(estado, idJogador, indiceSlot);
  contar(estado, idJogador, 'monstrosPerdidos');
  const ef = efeitoDe(carta);
  if (ef && ef.gatilho === 'ao_ser_destruido') aplicarEfeito(estado, idJogador, ef, { origem: carta });
  return resultado;
}

// Só passa o slot do próprio monstro quando o efeito mira nele (senão, "oponente" usaria o índice errado).
function alvoProprio(ef, indice) {
  return ef.alvo === 'proprio_monstro' || ef.alvo === 'monstro_equipado' ? indice : undefined;
}

// Índices dos slots ocupados de uma zona.
function ocupados(zona) {
  return zona.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
}

// Interpreta um efeito { gatilho, acao, alvo, valor, bioma? } e altera o estado.
// "contexto.indiceAlvo" diz qual slot de monstro é o alvo, quando o efeito precisa de um.
export function aplicarEfeito(estado, idJogador, efeito, contexto = {}) {
  if (!efeito || typeof efeito !== 'object') return falha('Efeito inválido.');
  const idOponente = oponenteDe(idJogador);
  const idAlvoPV = efeito.alvo === 'oponente' ? idOponente : idJogador;

  switch (efeito.acao) {
    case 'curar_pv':
      estado.jogadores[idAlvoPV].pontos_vida += efeito.valor;
      return { ok: true };

    case 'causar_dano_pv':
      perderPV(estado, idAlvoPV, efeito.valor);
      verificarVitoria(estado);
      return { ok: true };

    case 'comprar_carta': {
      for (let i = 0; i < efeito.valor; i++) {
        const r = comprarCarta(estado, idJogador);
        if (!r.ok) return { ok: true, deckout: true }; // deckout já definiu o vencedor
      }
      return { ok: true };
    }

    case 'mod_atk':
    case 'mod_def': {
      const zona = estado.jogadores[idJogador].zona_monstros;
      let indices = [];
      if (efeito.alvo === 'proprio_monstro' || efeito.alvo === 'monstro_equipado') {
        if (!zona[contexto.indiceAlvo]) return falha('Escolha um monstro seu como alvo.');
        indices = [contexto.indiceAlvo];
      } else if (efeito.alvo === 'todos_monstros') {
        indices = ocupados(zona);
      } else if (efeito.alvo === 'monstros_do_bioma') {
        indices = ocupados(zona).filter((i) => zona[i].carta.bioma === efeito.bioma);
      } else if (efeito.alvo === 'monstros_oponente') {
        // Enfraquece (ou fortalece) TODOS os monstros do oponente de forma permanente.
        const zonaOp = estado.jogadores[idOponente].zona_monstros;
        const campoOp = efeito.acao === 'mod_atk' ? 'bonusAtk' : 'bonusDef';
        for (const i of ocupados(zonaOp)) zonaOp[i][campoOp] = (zonaOp[i][campoOp] ?? 0) + efeito.valor;
        return { ok: true };
      } else {
        return falha(`Alvo "${efeito.alvo}" não é válido para ${efeito.acao}.`);
      }
      const campo = efeito.acao === 'mod_atk' ? 'bonusAtk' : 'bonusDef';
      for (const i of indices) zona[i][campo] = (zona[i][campo] ?? 0) + efeito.valor;
      return { ok: true };
    }

    case 'destruir_monstro': {
      let alvos = []; // lista de { id, indice }
      if (efeito.alvo === 'todos_monstros') {
        for (const id of [0, 1]) for (const i of ocupados(estado.jogadores[id].zona_monstros)) alvos.push({ id, indice: i });
      } else if (efeito.alvo === 'proprio_monstro') {
        if (!estado.jogadores[idJogador].zona_monstros[contexto.indiceAlvo]) return falha('Escolha um monstro seu como alvo.');
        alvos = [{ id: idJogador, indice: contexto.indiceAlvo }];
      } else if (efeito.alvo === 'oponente') {
        const zona = estado.jogadores[idOponente].zona_monstros;
        const lista = ocupados(zona);
        if (lista.length === 0) return falha('O oponente não tem monstros para destruir.');
        if (contexto.indiceAlvo !== undefined && contexto.indiceAlvo !== null) {
          if (!zona[contexto.indiceAlvo]) return falha('Não há monstro nesse slot do oponente.');
          alvos = [{ id: idOponente, indice: contexto.indiceAlvo }];
        } else {
          // Sem alvo escolhido: destrói os mais fortes (quantidade = valor).
          const porForca = lista
            .map((i) => ({ i, atk: calcularStatsEfetivos(estado, idOponente, i).atk }))
            .sort((a, b) => b.atk - a.atk)
            .slice(0, Math.max(1, efeito.valor));
          alvos = porForca.map((x) => ({ id: idOponente, indice: x.i }));
        }
      } else if (efeito.alvo === 'monstros_oponente') {
        const lista = ocupados(estado.jogadores[idOponente].zona_monstros);
        if (lista.length === 0) return falha('O oponente não tem monstros para destruir.');
        alvos = lista.map((i) => ({ id: idOponente, indice: i }));
      } else {
        return falha(`Alvo "${efeito.alvo}" não é válido para destruir_monstro.`);
      }
      for (const a of alvos) destruirMonstroComEfeito(estado, a.id, a.indice);
      verificarVitoria(estado);
      return { ok: true, destruidos: alvos.length };
    }

    case 'descartar_carta': {
      // O oponente descarta as últimas cartas da mão (sem escolha: mantém o jogo previsível).
      const mao = estado.jogadores[idOponente].mao;
      if (mao.length === 0) return falha('O oponente não tem cartas na mão.');
      const n = Math.min(mao.length, Math.max(1, efeito.valor));
      for (let i = 0; i < n; i++) enviarParaCemiterio(estado, idOponente, mao.pop());
      return { ok: true, descartadas: n };
    }

    case 'reviver_monstro': {
      // Traz de volta o monstro comum mais forte do SEU cemitério, em ataque.
      const jogador = estado.jogadores[idJogador];
      const candidatos = jogador.cemiterio.filter((c) => c.tipo === 'monstro').sort((a, b) => b.atk - a.atk);
      if (candidatos.length === 0) return falha('Não há monstros no seu cemitério.');
      const indiceSlot = encontrarSlotVazio(jogador.zona_monstros);
      if (indiceSlot === -1) return falha('Não há slot de monstro vago.');
      const carta = candidatos[0];
      jogador.cemiterio.splice(jogador.cemiterio.indexOf(carta), 1);
      jogador.zona_monstros[indiceSlot] = criarSlotMonstro(carta, 'ataque');
      contar(estado, idJogador, 'invocacoes');
      return { ok: true, indiceSlot, carta };
    }

    case 'negar_ataque':
      // Só faz sentido dentro de uma armadilha: avisa a batalha que o ataque foi anulado.
      if (!contexto.sinais) return falha('Esse efeito só funciona em resposta a um ataque.');
      contexto.sinais.ataqueNegado = true;
      return { ok: true };

    case 'negar_magia':
      if (!contexto.sinais) return falha('Esse efeito só funciona em resposta a uma magia.');
      contexto.sinais.magiaNegada = true;
      return { ok: true };

    default:
      return falha(`Ação de efeito desconhecida: "${efeito.acao}".`);
  }
}

// Confere, SEM alterar nada, se um efeito de magia teria algum resultado agora
// (evita gastar a carta, ou disparar armadilhas, à toa).
export function efeitoViavel(estado, idJogador, efeito, contexto = {}) {
  const jogador = estado.jogadores[idJogador];
  const oponente = estado.jogadores[oponenteDe(idJogador)];
  switch (efeito.acao) {
    case 'destruir_monstro':
      if (efeito.alvo === 'proprio_monstro') return !!jogador.zona_monstros[contexto.indiceAlvo];
      if (efeito.alvo === 'todos_monstros') return ocupados(jogador.zona_monstros).length + ocupados(oponente.zona_monstros).length > 0;
      return ocupados(oponente.zona_monstros).length > 0;
    case 'descartar_carta': return oponente.mao.length > 0;
    case 'reviver_monstro':
      return jogador.cemiterio.some((c) => c.tipo === 'monstro') && encontrarSlotVazio(jogador.zona_monstros) !== -1;
    case 'mod_atk':
    case 'mod_def':
      if (efeito.alvo === 'proprio_monstro' || efeito.alvo === 'monstro_equipado') return !!jogador.zona_monstros[contexto.indiceAlvo];
      if (efeito.alvo === 'monstros_oponente') return ocupados(oponente.zona_monstros).length > 0;
      return ocupados(jogador.zona_monstros).length > 0;
    default: return true;
  }
}

// ---------------------------------------------------------------
// ATIVAR CARTAS DA MÃO
// ---------------------------------------------------------------
// - magia: aplica o efeito e vai ao cemitério
// - equipamento: anexa ao monstro escolhido (contexto.indiceAlvo)
// - campo: vira a carta de campo ativa
export function ativarMagia(estado, idJogador, indiceMao, contexto = {}) {
  const erro = validarMain(estado);
  if (erro) return erro;
  if (idJogador !== estado.jogadorDaVez) return falha('Não é a sua vez.');

  const jogador = estado.jogadores[idJogador];
  const carta = jogador.mao[indiceMao];
  if (!carta) return falha('Não há carta nessa posição da mão.');

  if (carta.tipo === 'campo') return posicionarCarta(estado, indiceMao);

  if (carta.tipo === 'equipamento') {
    const slot = jogador.zona_monstros[contexto.indiceAlvo];
    if (!slot) return falha('Escolha um monstro seu para equipar.');
    if (slot.equipamento) enviarParaCemiterio(estado, idJogador, slot.equipamento); // substitui o antigo
    slot.equipamento = carta;
    jogador.mao.splice(indiceMao, 1);
    return { ok: true };
  }

  if (carta.tipo === 'magia') {
    if (!efeitoViavel(estado, idJogador, carta.efeito, contexto)) {
      return falha('Essa magia não teria nenhum efeito agora.'); // a carta continua na mão
    }
    // O oponente pode ter uma armadilha que NEGA a magia (ela é gasta sem efeito).
    const sinais = {};
    const armadilhas = dispararArmadilhas(estado, 'ativacao_magia', oponenteDe(idJogador), { sinais });
    let negada = false;
    let efeitos = [];
    if (sinais.magiaNegada) {
      negada = true;
    } else {
      const r = aplicarEfeito(estado, idJogador, carta.efeito, contexto);
      if (!r.ok) return r; // efeito inválido: a carta continua na mão
      if (r.carta) efeitos = dispararInvocacao(estado, idJogador, r.indiceSlot); // magia que revive um monstro
    }
    // O efeito pode ter comprado cartas, então procuramos a magia pelo uid.
    const pos = jogador.mao.findIndex((c) => c.uid === carta.uid);
    if (pos >= 0) jogador.mao.splice(pos, 1);
    enviarParaCemiterio(estado, idJogador, carta);
    verificarVitoria(estado);
    return { ok: true, negada, armadilhas, efeitos };
  }

  return falha('Esse tipo de carta não pode ser ativado direto da mão.');
}

// ---------------------------------------------------------------
// ARMADILHAS
// ---------------------------------------------------------------
// Uma armadilha fica virada para baixo na zona de magias/armadilhas e se ATIVA SOZINHA quando
// o evento descrito na sua "condicao_ativacao" acontece. Regras:
//   * só ativa se tiver sido baixada em um turno ANTERIOR;
//   * ao ativar: é revelada, o efeito acontece e ela vai ao cemitério.
// Eventos: "ataque_declarado" (o DONO da armadilha é o defensor), "invocacao" e "fusao" (o dono é o oponente de
// quem invocou/fundiu), "ativacao_magia" (o dono é o oponente de quem ativou) e "dano_de_batalha" (o dono é quem
// perdeu PV). "contexto.sinais" é um objeto onde efeitos como negar_ataque/negar_magia avisam quem chamou.
const EVENTO_POR_CONDICAO = {
  'Quando um monstro do oponente declarar um ataque.': 'ataque_declarado',
  'Quando o oponente invocar um monstro.': 'invocacao',
  'Quando você sofrer dano de batalha.': 'dano_de_batalha',
  'Quando o oponente fizer uma fusão.': 'fusao',
  'Quando o oponente ativar uma magia.': 'ativacao_magia',
};

export function eventoDaArmadilha(carta) {
  return carta.evento_ativacao ?? EVENTO_POR_CONDICAO[carta.condicao_ativacao] ?? null;
}

// Procura (e resolve) as armadilhas do jogador "idDono" que respondem ao evento.
// contexto.indiceAlvo = slot do monstro do OPONENTE que causou o evento (atacante/invocado).
// Devolve a lista de frases para o registro de ações.
export function dispararArmadilhas(estado, evento, idDono, contexto = {}) {
  const textos = [];
  const dono = estado.jogadores[idDono];
  for (let i = 0; i < dono.zona_magias_armadilhas.length; i++) {
    if (estado.vencedor !== null) break;
    const reg = dono.zona_magias_armadilhas[i];
    if (!reg || reg.carta.tipo !== 'armadilha' || !reg.viradaParaBaixo) continue;
    if (eventoDaArmadilha(reg.carta) !== evento) continue;
    if ((reg.turnoBaixada ?? 0) >= estado.turno) continue; // baixada neste turno: ainda não pode ativar

    const efeito = reg.carta.efeito;
    // Armadilhas que destroem o atacante/invocado precisam de alvo: se ele já não existe, não ativam.
    if (efeito.acao === 'destruir_monstro' && efeito.alvo === 'oponente') {
      const alvo = estado.jogadores[oponenteDe(idDono)].zona_monstros[contexto.indiceAlvo];
      if (!alvo) continue;
    }
    const r = aplicarEfeito(estado, idDono, efeito, { indiceAlvo: contexto.indiceAlvo, sinais: contexto.sinais });
    if (!r.ok) continue; // efeito não pôde ser resolvido: a armadilha continua armada
    dono.zona_magias_armadilhas[i] = null;
    enviarParaCemiterio(estado, idDono, reg.carta);
    contar(estado, idDono, 'armadilhasAtivadas');
    textos.push(`🪤 Jogador ${idDono + 1} ativou a armadilha ${reg.carta.nome}: ${efeito.descricao_texto}`);
  }
  return textos;
}

// ---------------------------------------------------------------
// BATALHA
// ---------------------------------------------------------------
export function declararAtaque(estado, idJogador, indiceAtacante, indiceDefensor = null) {
  if (estado.vencedor !== null) return falha('A partida já terminou.');
  if (idJogador !== estado.jogadorDaVez) return falha('Não é a sua vez.');
  if (estado.fase !== 'battle') return falha('Ataques só podem ser declarados na Battle Phase.');
  if (estado.turno === 1) return falha('O jogador que começa não pode atacar no primeiro turno.');

  const jogador = estado.jogadores[idJogador];
  const idOp = oponenteDe(idJogador);
  const oponente = estado.jogadores[idOp];

  const slotAtk = jogador.zona_monstros[indiceAtacante];
  if (!slotAtk) return falha('Não há monstro atacante nesse slot.');
  if (slotAtk.posicao !== 'ataque') return falha('Só monstros em posição de ataque podem atacar.');
  if (slotAtk.jaAtacou) return falha('Este monstro já atacou neste turno.');

  let atkA = calcularStatsEfetivos(estado, idJogador, indiceAtacante).atk;
  const log = {
    ok: true, tipoResultado: '', atkAtacante: atkA, valorDefensor: null, danoCausado: 0,
    quemPerdeuPV: null, monstrosDestruidos: [], defensorRevelado: false,
    nomeAtacante: slotAtk.carta.nome, nomeDefensor: null, armadilhas: [], efeitos: [],
  };

  // Ao declarar o ataque, o oponente pode ter armadilhas que respondem (algumas anulam o ataque).
  const sinais = {};
  log.armadilhas.push(...dispararArmadilhas(estado, 'ataque_declarado', idOp, { indiceAtacante, indiceAlvo: indiceAtacante, sinais }));
  if (estado.vencedor !== null || jogador.zona_monstros[indiceAtacante] !== slotAtk) {
    // O atacante foi destruído (ou a partida acabou): o ataque é anulado.
    slotAtk.jaAtacou = true;
    log.tipoResultado = 'ataque_anulado';
    verificarVitoria(estado);
    return log;
  }
  if (sinais.ataqueNegado) {
    slotAtk.jaAtacou = true;
    log.tipoResultado = 'ataque_negado';
    return log;
  }
  // Armadilhas como a Névoa Sombria mudam o ATK do atacante: recalcula antes da batalha.
  atkA = calcularStatsEfetivos(estado, idJogador, indiceAtacante).atk;
  log.atkAtacante = atkA;

  // ----- Ataque direto -----
  if (indiceDefensor === null || indiceDefensor === undefined) {
    if (ocupados(oponente.zona_monstros).length > 0) {
      return falha('Você só pode atacar diretamente se o oponente não tiver monstros.');
    }
    slotAtk.jaAtacou = true;
    perderPV(estado, idOp, atkA);
    contar(estado, idOp, 'danoDiretoSofrido', atkA);
    log.tipoResultado = 'ataque_direto';
    log.danoCausado = atkA;
    log.quemPerdeuPV = idOp;
    log.armadilhas.push(...dispararArmadilhas(estado, 'dano_de_batalha', idOp));
    verificarVitoria(estado);
    return log;
  }

  // ----- Ataque contra monstro -----
  const slotDef = oponente.zona_monstros[indiceDefensor];
  if (!slotDef) return falha('Não há monstro defensor nesse slot.');
  slotAtk.jaAtacou = true; // marca antes, pois o atacante pode ser destruído
  log.nomeDefensor = slotDef.carta.nome;

  // Defensor virado para baixo é revelado ANTES do cálculo.
  if (slotDef.viradaParaBaixo) {
    slotDef.viradaParaBaixo = false;
    log.defensorRevelado = true;
  }
  const statsDef = calcularStatsEfetivos(estado, idOp, indiceDefensor);

  if (slotDef.posicao === 'ataque') {
    log.valorDefensor = statsDef.atk;
    if (atkA > statsDef.atk) {
      log.tipoResultado = 'atacante_venceu';
      log.danoCausado = atkA - statsDef.atk;
      log.quemPerdeuPV = idOp;
      log.monstrosDestruidos.push(log.nomeDefensor);
      perderPV(estado, idOp, log.danoCausado);
      destruirMonstroComEfeito(estado, idOp, indiceDefensor);
    } else if (atkA < statsDef.atk) {
      log.tipoResultado = 'atacante_perdeu';
      log.danoCausado = statsDef.atk - atkA;
      log.quemPerdeuPV = idJogador;
      log.monstrosDestruidos.push(log.nomeAtacante);
      perderPV(estado, idJogador, log.danoCausado);
      destruirMonstroComEfeito(estado, idJogador, indiceAtacante);
    } else {
      log.tipoResultado = 'empate';
      log.monstrosDestruidos.push(log.nomeAtacante, log.nomeDefensor);
      destruirMonstroComEfeito(estado, idOp, indiceDefensor);
      destruirMonstroComEfeito(estado, idJogador, indiceAtacante);
    }
  } else {
    // Defensor em posição de defesa: compara ATK do atacante com a DEF.
    log.valorDefensor = statsDef.def;
    if (atkA > statsDef.def) {
      log.tipoResultado = 'defensor_destruido';
      log.monstrosDestruidos.push(log.nomeDefensor);
      destruirMonstroComEfeito(estado, idOp, indiceDefensor);
    } else if (atkA < statsDef.def) {
      log.tipoResultado = 'reflexo'; // atacante sobrevive, mas sofre o dano de reflexo
      log.danoCausado = statsDef.def - atkA;
      log.quemPerdeuPV = idJogador;
      perderPV(estado, idJogador, log.danoCausado);
    } else {
      log.tipoResultado = 'nada';
    }
  }

  if (log.quemPerdeuPV !== null && log.danoCausado > 0) {
    log.armadilhas.push(...dispararArmadilhas(estado, 'dano_de_batalha', log.quemPerdeuPV));
  }

  // Efeito "ao_destruir_oponente": quem sobreviveu e destruiu o monstro rival em batalha ativa a habilidade.
  const vencedorDaBatalha = {
    atacante_venceu: [idJogador, indiceAtacante, slotAtk],
    defensor_destruido: [idJogador, indiceAtacante, slotAtk],
    atacante_perdeu: [idOp, indiceDefensor, slotDef],
  }[log.tipoResultado];
  if (vencedorDaBatalha && estado.vencedor === null) {
    const [idV, indiceV, slotV] = vencedorDaBatalha;
    const ef = efeitoDe(slotV.carta);
    if (ef?.gatilho === 'ao_destruir_oponente' && estado.jogadores[idV].zona_monstros[indiceV] === slotV && !slotV.viradaParaBaixo) {
      const r = aplicarEfeito(estado, idV, ef, { indiceAlvo: alvoProprio(ef, indiceV), origem: slotV.carta });
      if (r.ok) log.efeitos.push(`⚔️ ${slotV.carta.nome}: ${ef.descricao_texto}`);
    }
  }
  verificarVitoria(estado);
  return log;
}

// Transforma o log de um ataque em uma frase em português (usado pela UI e pela IA).
export function descreverAtaque(l) {
  const base = [descreverBase(l), ...(l.efeitos ?? [])].join(' ');
  return l.armadilhas?.length ? `${l.armadilhas.join(' ')} ${base}` : base;
}

function descreverBase(l) {
  const a = l.nomeAtacante;
  const d = l.nomeDefensor;
  switch (l.tipoResultado) {
    case 'ataque_direto': return `${a} atacou diretamente: ${l.danoCausado} de dano.`;
    case 'atacante_venceu': return `${a} atacou ${d} e venceu: ${l.danoCausado} de dano ao oponente.`;
    case 'atacante_perdeu': return `${a} atacou ${d} e foi destruído: ${l.danoCausado} de dano ao atacante.`;
    case 'empate': return `${a} e ${d} se destruíram mutuamente.`;
    case 'defensor_destruido': return `${a} destruiu ${d} (em defesa), sem dano de vida.`;
    case 'reflexo': return `${a} não rompeu a defesa de ${d}: ${l.danoCausado} de dano de reflexo.`;
    case 'nada': return `${a} atacou ${d} em defesa: nada aconteceu.`;
    case 'ataque_anulado': return `${a} foi destruído antes de atacar: o ataque foi anulado.`;
    case 'ataque_negado': return `O ataque de ${a} foi anulado!`;
    default: return `${a} atacou.`;
  }
}
