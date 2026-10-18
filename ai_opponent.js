// ai_opponent.js
// ---------------------------------------------------------------
// Oponente simples controlado pelo computador.
// Regra: a IA usa SOMENTE as funções públicas dos outros módulos.
// Ela nunca mexe no estado diretamente, só lê o estado para decidir.
//
// Estratégia de um turno (nesta ordem):
//  1. Main Phase: evoluir -> ativar campo/magias úteis -> invocar o melhor monstro
//  2. Battle Phase: atacar só quando vence pelos valores EFETIVOS
//  3. Finalizar o turno
// ---------------------------------------------------------------

import { encontrarSlotVazio, oponenteDe } from './game_state.js';
import { avancarFase, invocarNormal, posicionarCarta, finalizarTurno, tributosNecessarios } from './turn_system.js';
import {
  calcularStatsEfetivos, podeEvoluir, evoluir, ativarMagia, declararAtaque, descreverAtaque, efeitoViavel,
} from './rules_engine.js';

// Pausa opcional entre ações, para a UI ficar acompanhável.
// Com atraso 0 (como nos testes) nem criamos timer: fica instantâneo.
function pausa(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

// ---------- Funções de leitura (só olham o estado) ----------

// IDs únicos das cartas do deck extra.
function idsUnicos(cartas) {
  return [...new Set(cartas.map((c) => c.id))];
}

// Uma carta é "reservada" se serve de material para alguma fusão que ainda
// está no deck extra: a IA evita gastá-la como magia/equipamento comum.
function ehMaterialReservado(jogador, carta) {
  return jogador.deck_extra.some((f) => (f.requisitos_fusao ?? []).some((r) => r.id === carta.id));
}

// Pontua uma carta de campo do ponto de vista da IA:
// bônus nos monstros dela contam a favor; bônus nos do oponente contam contra.
// Monstros na mão valem um pouco (25%), pois logo estarão em campo.
function valorDoCampo(estado, campo, idJogador) {
  if (!campo) return 0;
  const pontos = (mod) => mod.mod_atk + mod.mod_def * 0.5;
  let valor = 0;
  for (const id of [0, 1]) {
    for (const slot of estado.jogadores[id].zona_monstros) {
      if (!slot) continue;
      for (const mod of campo.modificadores_globais) {
        if (mod.bioma === slot.carta.bioma) valor += (id === idJogador ? 1 : -1) * pontos(mod);
      }
    }
  }
  for (const c of estado.jogadores[idJogador].mao) {
    if (c.tipo !== 'monstro') continue;
    for (const mod of campo.modificadores_globais) {
      if (mod.bioma === c.bioma) valor += 0.25 * pontos(mod);
    }
  }
  return valor;
}

// Maior ATK efetivo entre os monstros de um jogador (0 se não tiver nenhum).
function maiorAtk(estado, idJogador) {
  let maior = 0;
  estado.jogadores[idJogador].zona_monstros.forEach((slot, i) => {
    if (slot) maior = Math.max(maior, calcularStatsEfetivos(estado, idJogador, i).atk);
  });
  return maior;
}

// Decide se vale a pena usar uma magia agora.
function vale_a_pena(estado, jogador, oponente, carta, nivel = 3) {
  const ef = carta.efeito;
  if (!ef) return false;
  // Nível 1 só usa magias "simples" (cura e compra); as táticas aparecem a partir do nível 2.
  if (nivel < 2 && !['curar_pv', 'comprar_carta'].includes(ef.acao)) return false;
  if (!efeitoViavel(estado, jogador.id, ef)) return false;
  switch (ef.acao) {
    case 'descartar_carta': return true;
    case 'reviver_monstro': return true;
    case 'mod_atk':
    case 'mod_def':
      if (ef.alvo === 'monstros_oponente') return ef.valor < 0 && oponente.zona_monstros.filter(Boolean).length >= 1;
      if (ef.alvo === 'todos_monstros') return ef.valor > 0 && jogador.zona_monstros.filter(Boolean).length >= 2;
      return false;
    case 'destruir_monstro':
      if (ef.alvo === 'todos_monstros') {
        // Terremoto: só quando o oponente perde mais do que você.
        const soma = (j) => j.zona_monstros.reduce((t, sl) => t + (sl ? sl.carta.atk : 0), 0);
        return soma(oponente) > soma(jogador) + 500;
      }
      return ef.alvo === 'oponente' || ef.alvo === 'monstros_oponente';
    case 'causar_dano_pv': return true; // dano é sempre bom
    case 'curar_pv': return jogador.pontos_vida <= 8000 - ef.valor * 0.75 || jogador.pontos_vida <= 6500;
    case 'comprar_carta': return jogador.mao.length <= 4 && jogador.deck_principal.length > ef.valor + 3;
    default: return false; // não sabemos usar: guarda a carta
  }
}

// ---------- O turno da IA ----------
// opcoes.atrasoMs: pausa entre ações. opcoes.aoAgir(texto): chamada a cada ação (para a UI).
// opcoes.aguardar(): função opcional que pode devolver uma Promise; a IA espera por ela depois de cada ação
//   (a UI usa isso para "congelar" a IA enquanto o menu de pausa está aberto).
// opcoes.aoEvoluir(carta): chamada (e aguardada) quando a IA evolui, para a UI tocar a animação de fusão.
// opcoes.nivel (1 a 5): dificuldade da IA (usada no Modo História).
//   1: não evolui, não usa armadilhas/equipamentos, só magias simples, só ataca com folga grande.
//   2: evolui só às vezes, já usa armadilhas, equipamentos e magias táticas.
//   3: IA completa (padrão).   4: também respeita as armadilhas do oponente (ataca com cautela).
//   5: igual ao 4 e ainda escolhe o melhor alvo para tributo/ataque direto com prioridade.
// Devolve a lista de ações (textos em português).
export async function jogarTurnoIA(estado, idJogador, opcoes = {}) {
  const { atrasoMs = 0, aoAgir = null, aguardar = null, aoEvoluir = null, nivel = 3, semFusao = false, nome: nomeIA = null } = opcoes;
  const usaFusao = !semFusao && (nivel >= 3 || (nivel === 2 && Math.random() < 0.5));
  const usaApoio = nivel >= 2; // equipamentos e armadilhas
  const margemAtaque = nivel <= 1 ? 300 : 0;
  const acoes = [];
  const registrar = async (texto) => {
    acoes.push(texto);
    if (aoAgir) aoAgir(texto);
    await pausa(atrasoMs);
    if (aguardar) await aguardar();
  };

  if (estado.vencedor !== null) return acoes;
  if (estado.jogadorDaVez !== idJogador) return ['A IA tentou jogar fora da sua vez.'];
  if (estado.fase !== 'main') return [`A IA esperava a Main Phase, mas a fase é "${estado.fase}".`];

  const jogador = estado.jogadores[idJogador];
  const idOp = oponenteDe(idJogador);
  const oponente = estado.jogadores[idOp];
  const nome = nomeIA ?? `Jogador ${idJogador + 1} (IA)`;

  // ===== 1a. Evoluir sempre que possível =====
  // Repetimos porque uma evolução pode abrir caminho para outra (com limite de segurança).
  let evoluiu = true;
  let guarda = 0;
  while (usaFusao && evoluiu && guarda < 10 && estado.vencedor === null) {
    guarda += 1;
    evoluiu = false;
    for (const id of idsUnicos(jogador.deck_extra)) {
      if (!podeEvoluir(estado, idJogador, id).ok) continue;
      const r = evoluir(estado, idJogador, id);
      if (r.ok) {
        if (aoEvoluir) await aoEvoluir(r.carta);
        await registrar(`${nome} evoluiu para ${r.carta.nome}.`);
        for (const t of [...(r.armadilhas ?? []), ...(r.efeitos ?? [])]) await registrar(t);
        evoluiu = true;
        break; // recomeça a busca com o estado novo
      }
    }
  }

  // ===== 1b. Campo, equipamentos, magias e armadilhas =====
  // Percorremos uma "foto" dos uids da mão, pois a mão muda enquanto jogamos.
  for (const uid of jogador.mao.map((c) => c.uid)) {
    if (estado.vencedor !== null) break;
    const idx = jogador.mao.findIndex((c) => c.uid === uid);
    if (idx < 0) continue;
    const carta = jogador.mao[idx];

    if (carta.tipo === 'campo') {
      // Só troca o campo se o novo for melhor que o atual (e positivo para a IA).
      const novo = valorDoCampo(estado, carta, idJogador);
      const atual = valorDoCampo(estado, estado.cartaCampo, idJogador);
      if (novo > 0 && novo > atual) {
        const r = ativarMagia(estado, idJogador, idx);
        if (r.ok) await registrar(`${nome} ativou o campo ${carta.nome}.`);
      }
    } else if (carta.tipo === 'equipamento') {
      if (!usaApoio || ehMaterialReservado(jogador, carta)) continue;
      // Equipa no monstro com maior ATK efetivo.
      let melhor = -1;
      let melhorAtk = -1;
      jogador.zona_monstros.forEach((slot, i) => {
        if (!slot) return;
        const atk = calcularStatsEfetivos(estado, idJogador, i).atk;
        if (atk > melhorAtk) { melhorAtk = atk; melhor = i; }
      });
      if (melhor >= 0) {
        const nomeMonstro = jogador.zona_monstros[melhor].carta.nome;
        const r = ativarMagia(estado, idJogador, idx, { indiceAlvo: melhor });
        if (r.ok) await registrar(`${nome} equipou ${carta.nome} em ${nomeMonstro}.`);
      }
    } else if (carta.tipo === 'magia') {
      if (ehMaterialReservado(jogador, carta)) continue; // guarda para a fusão
      if (!vale_a_pena(estado, jogador, oponente, carta, nivel)) continue;
      const r = ativarMagia(estado, idJogador, idx);
      if (r.ok) {
        await registrar(`${nome} ativou ${carta.nome}: ${carta.efeito.descricao_texto}`);
        for (const t of [...(r.armadilhas ?? []), ...(r.efeitos ?? [])]) await registrar(t);
        if (r.negada) await registrar('A magia foi anulada!');
      }
    } else if (carta.tipo === 'armadilha') {
      if (!usaApoio) continue;
      const r = posicionarCarta(estado, idx);
      if (r.ok) await registrar(`${nome} baixou uma carta virada para baixo.`);
    }
  }

  // ===== 1c. Invocação Normal =====
  if (estado.vencedor === null && !jogador.flags.invocouNormalNoTurno) {
    const forcaOponente = maiorAtk(estado, idOp);

    // Candidatos: monstros da mão, do mais forte para o mais fraco.
    const candidatos = jogador.mao
      .map((carta, idx) => ({ carta, idx }))
      .filter((x) => x.carta.tipo === 'monstro')
      .sort((a, b) => b.carta.atk - a.carta.atk);

    // Monstros em campo, do mais fraco para o mais forte (os melhores tributos são os mais fracos).
    const emCampo = jogador.zona_monstros
      .map((slot, i) => (slot ? { i, atk: calcularStatsEfetivos(estado, idJogador, i).atk } : null))
      .filter(Boolean)
      .sort((a, b) => a.atk - b.atk);

    for (const { carta, idx } of candidatos) {
      const necessarios = tributosNecessarios(carta.nivel);
      if (emCampo.length < necessarios) continue; // não há monstros suficientes para tributar
      const tributos = emCampo.slice(0, necessarios);
      const somaTributos = tributos.reduce((s, t) => s + t.atk, 0);
      // Só sacrifica se o monstro novo for mais forte que o que se perde.
      if (necessarios > 0 && carta.atk <= somaTributos) continue;
      if (necessarios === 0 && encontrarSlotVazio(jogador.zona_monstros) === -1) continue;

      // Se o oponente tem algo mais forte, invoca em defesa (virado para baixo).
      const posicao = forcaOponente > carta.atk ? 'defesa' : 'ataque';
      const r = invocarNormal(estado, idx, posicao, tributos.map((t) => t.i));
      if (r.ok) {
        const sacrificio = necessarios > 0 ? ` (tributando ${necessarios} monstro(s))` : '';
        await registrar(`${nome} invocou ${carta.nome} em ${posicao}${sacrificio}.`);
        for (const t of [...(r.armadilhas ?? []), ...(r.efeitos ?? [])]) await registrar(t);
        break;
      }
    }
  }

  // ===== 2. Battle Phase =====
  if (estado.vencedor === null) {
    const av = avancarFase(estado);
    if (av.ok && estado.turno !== 1) {
      const decididos = new Set(); // monstros que já atacaram ou que decidimos não usar
      // Nível 4+: se o oponente tem armadilhas armadas, ataca com cautela (no máximo 2 ataques contra monstros).
      const armadas = nivel >= 4
        ? oponente.zona_magias_armadilhas.filter((r) => r && r.carta.tipo === 'armadilha' && (r.turnoBaixada ?? 0) < estado.turno).length
        : 0;
      let ataquesCautelosos = 0;
      for (let tentativa = 0; tentativa < 12 && estado.vencedor === null; tentativa++) {
        // Próximo atacante: o de maior ATK efetivo que ainda pode atacar.
        let atacante = null;
        jogador.zona_monstros.forEach((slot, i) => {
          if (!slot || slot.posicao !== 'ataque' || slot.jaAtacou || decididos.has(slot.carta.uid)) return;
          const atk = calcularStatsEfetivos(estado, idJogador, i).atk;
          if (!atacante || atk > atacante.atk) atacante = { i, atk, uid: slot.carta.uid };
        });
        if (!atacante) break;

        const alvos = oponente.zona_monstros
          .map((slot, j) => (slot ? { j, slot, stats: calcularStatsEfetivos(estado, idOp, j) } : null))
          .filter(Boolean);

        let indiceAlvo = null;
        if (alvos.length > 0) {
          // Entre os alvos que vencemos, escolhe o mais forte.
          // Em ataque: precisa ATK > ATK. Em defesa: precisa ATK > DEF.
          const vencidos = alvos
            .map((a) => ({ ...a, valor: a.slot.posicao === 'ataque' ? a.stats.atk : a.stats.def }))
            .filter((a) => atacante.atk > a.valor + margemAtaque)
            .sort((a, b) => b.valor - a.valor);
          if (vencidos.length === 0) {
            decididos.add(atacante.uid); // não vale atacar: guarda o monstro
            continue;
          }
          indiceAlvo = vencidos[0].j;
        }

        if (armadas > 0 && indiceAlvo !== null) {
          if (ataquesCautelosos >= 2) { decididos.add(atacante.uid); continue; }
          ataquesCautelosos += 1;
        }
        const log = declararAtaque(estado, idJogador, atacante.i, indiceAlvo);
        decididos.add(atacante.uid);
        if (log.ok) await registrar(`${nome}: ${descreverAtaque(log)}`);
      }
    }
  }

  // ===== 3. Finalizar o turno =====
  if (estado.vencedor === null) {
    const fim = finalizarTurno(estado);
    if (fim.ok) await registrar(`${nome} finalizou o turno.`);
  }
  return acoes;
}
