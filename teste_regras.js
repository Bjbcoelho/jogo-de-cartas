// teste_regras.js
// Testes do rules_engine.js. Rode com:  node teste_regras.js

import { readFileSync } from 'node:fs';
import { teste, afirmar, igual, resumo } from './mini_teste.js';
import { criarEstado, criarCartaEmJogo, criarSlotMonstro, encontrarSlotVazio, verificarVitoria } from './game_state.js';
import { indexarBanco, montarDeckAleatorio } from './deck_builder.js';
import { comecarPartida } from './turn_system.js';
import {
  calcularStatsEfetivos, podeEvoluir, evoluir, aplicarEfeito, ativarMagia, declararAtaque,
} from './rules_engine.js';

const banco = JSON.parse(readFileSync(new URL('./cards_db.json', import.meta.url), 'utf-8'));
const cartasPorId = indexarBanco(banco);
const carta = (id, dono) => criarCartaEmJogo(cartasPorId[id], dono);

// Cenário limpo: vez do jogador 0, turno 2 (ataques liberados), mãos e zonas vazias.
function cenario() {
  const { deckPrincipal, deckExtra } = montarDeckAleatorio(cartasPorId);
  const e = criarEstado(deckPrincipal, deckExtra, deckPrincipal, deckExtra, cartasPorId);
  comecarPartida(e);
  e.turno = 2;
  e.jogadorDaVez = 0;
  e.fase = 'main';
  e.cartaCampo = null;
  for (const j of e.jogadores) {
    // Deck extra com UMA cópia de cada fusão do banco (o sorteio normal só leva 5 tipos).
    j.deck_extra = Object.values(cartasPorId).filter((c) => c.tipo === 'fusao').map((c, i) => carta(c.id, j.id));
    j.mao = [];
    j.cemiterio = [];
    j.zona_monstros = Array(5).fill(null);
    j.zona_magias_armadilhas = Array(5).fill(null);
    j.pontos_vida = 8000;
  }
  return e;
}

// Coloca um monstro em campo e devolve o índice do slot.
function colocar(e, idJogador, idCarta, posicao = 'ataque', viradaParaBaixo = false) {
  const zona = e.jogadores[idJogador].zona_monstros;
  const i = encontrarSlotVazio(zona);
  const slot = criarSlotMonstro(carta(idCarta, idJogador), posicao, viradaParaBaixo);
  slot.invocadoNesteTurno = false;
  zona[i] = slot;
  return i;
}

// Prepara para atacar: fase battle.
function modoBatalha(e) {
  e.fase = 'battle';
}

// ---------- Stats efetivos ----------
teste('campo Mar de Europa: +300 ATK / -200 DEF para marinhos de AMBOS os jogadores', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_lula_comum');
  const b = colocar(e, 1, 'monstro_lula_comum');
  e.cartaCampo = carta('campo_mar_de_europa', 0);
  igual(calcularStatsEfetivos(e, 0, a).atk, 1300, 'ATK jogador 0');
  igual(calcularStatsEfetivos(e, 1, b).atk, 1300, 'ATK jogador 1');
  igual(calcularStatsEfetivos(e, 0, a).def, 1000, 'DEF jogador 0');
});

teste('removendo o campo, o bônus some e os valores base nunca mudaram', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_lula_comum');
  e.cartaCampo = carta('campo_mar_de_europa', 0);
  e.cartaCampo = null;
  igual(calcularStatsEfetivos(e, 0, a).atk, 1000, 'ATK voltou ao normal');
  igual(e.jogadores[0].zona_monstros[a].carta.atk, 1000, 'valor base intacto');
});

teste('campo Mar de Europa reduz ATK de insetos em 200 e não afeta humanos', () => {
  const e = cenario();
  const inseto = colocar(e, 0, 'monstro_besouro_blindado');
  const humano = colocar(e, 0, 'monstro_aprendiz_de_espada');
  e.cartaCampo = carta('campo_mar_de_europa', 0);
  igual(calcularStatsEfetivos(e, 0, inseto).atk, 1300, 'inseto');
  igual(calcularStatsEfetivos(e, 0, humano).atk, 1200, 'humano');
});

teste('equipamento soma ao ATK efetivo sem alterar a carta', () => {
  const e = cenario();
  const i = colocar(e, 0, 'monstro_peixe_espada');
  e.jogadores[0].mao = [carta('equip_espada_de_ferro', 0)];
  const r = ativarMagia(e, 0, 0, { indiceAlvo: i });
  igual(r.ok, true, 'equipar');
  igual(calcularStatsEfetivos(e, 0, i).atk, 2200, 'ATK efetivo');
  igual(e.jogadores[0].zona_monstros[i].carta.atk, 1700, 'ATK base');
  igual(e.jogadores[0].mao.length, 0, 'saiu da mão');
});

teste('equipamento vai ao cemitério junto com o monstro destruído', () => {
  const e = cenario();
  const i = colocar(e, 0, 'monstro_besouro_blindado');
  e.jogadores[0].mao = [carta('equip_escudo_de_carapaca', 0)];
  ativarMagia(e, 0, 0, { indiceAlvo: i });
  const b = colocar(e, 1, 'monstro_titan_de_saturno');
  e.jogadorDaVez = 1;
  modoBatalha(e);
  declararAtaque(e, 1, b, i);
  igual(e.jogadores[0].cemiterio.length, 2, 'monstro + equipamento');
});

teste('habilidade contínua: Lula-Gigante dá +200 DEF aos marinhos do dono (inclusive a si)', () => {
  const e = cenario();
  const lula = colocar(e, 0, 'monstro_lula_comum');
  const gigante = colocar(e, 0, 'fusao_lula_gigante_das_profundezas');
  const lulaDoOponente = colocar(e, 1, 'monstro_lula_comum');
  igual(calcularStatsEfetivos(e, 0, lula).def, 1400, 'lula do dono');
  igual(calcularStatsEfetivos(e, 0, gigante).def, 2700, 'a própria fusão');
  igual(calcularStatsEfetivos(e, 1, lulaDoOponente).def, 1200, 'oponente não ganha');
});

teste('habilidade contínua: Cavaleiro de Aço ganha +200 ATK', () => {
  const e = cenario();
  const i = colocar(e, 0, 'fusao_cavaleiro_de_aco');
  igual(calcularStatsEfetivos(e, 0, i).atk, cartasPorId.fusao_cavaleiro_de_aco.atk + 200);
});

// ---------- Evolução ----------
teste('Evolução: Lagarta-da-seda + Casulo na mão vira Mariposa-da-seda', () => {
  const e = cenario();
  const j = e.jogadores[0];
  const i = colocar(e, 0, 'monstro_lagarta_da_seda');
  j.mao = [carta('magia_casulo_de_folha', 0)];
  const antes = j.deck_extra.length;
  igual(podeEvoluir(e, 0, 'fusao_mariposa_da_seda').ok, true, 'podeEvoluir');
  const r = evoluir(e, 0, 'fusao_mariposa_da_seda');
  igual(r.ok, true, 'evoluir');
  igual(j.zona_monstros[r.indiceSlot].carta.id, 'fusao_mariposa_da_seda', 'fusão em campo');
  igual(j.zona_monstros[r.indiceSlot].posicao, 'ataque', 'posição');
  igual(j.zona_monstros[r.indiceSlot].viradaParaBaixo, false, 'virada para cima');
  igual(j.zona_monstros[i] === null, false, 'o slot do material foi reutilizado');
  igual(j.cemiterio.length, 2, 'materiais no cemitério');
  igual(j.mao.length, 0, 'casulo saiu da mão');
  igual(j.deck_extra.length, antes - 1, 'saiu do deck extra');
  igual(j.flags.invocouNormalNoTurno, false, 'não conta como Invocação Normal');
});

teste('Evolução falha sem o Casulo e não altera nada', () => {
  const e = cenario();
  const j = e.jogadores[0];
  colocar(e, 0, 'monstro_lagarta_da_seda');
  const r = evoluir(e, 0, 'fusao_mariposa_da_seda');
  igual(r.ok, false);
  afirmar(r.motivo.includes('casulo'), 'motivo deveria citar o casulo');
  igual(j.cemiterio.length, 0, 'nada no cemitério');
  igual(j.zona_monstros.filter(Boolean).length, 1, 'lagarta continua em campo');
});

teste('Evolução com Casulo na zona de magias também funciona', () => {
  const e = cenario();
  const j = e.jogadores[0];
  colocar(e, 0, 'monstro_lagarta_da_seda');
  j.zona_magias_armadilhas[0] = { carta: carta('magia_casulo_de_folha', 0), viradaParaBaixo: false };
  igual(evoluir(e, 0, 'fusao_mariposa_da_seda').ok, true);
  igual(j.zona_magias_armadilhas[0], null, 'zona liberada');
});

teste('Evolução com zona de monstros cheia funciona se um material de campo libera espaço', () => {
  const e = cenario();
  const j = e.jogadores[0];
  colocar(e, 0, 'monstro_lagarta_da_seda');
  for (let k = 0; k < 4; k++) colocar(e, 0, 'monstro_arqueira_da_vila');
  j.mao = [carta('magia_casulo_de_folha', 0)];
  igual(encontrarSlotVazio(j.zona_monstros), -1, 'zona cheia');
  igual(evoluir(e, 0, 'fusao_mariposa_da_seda').ok, true);
});

teste('Evolução só na Main Phase', () => {
  const e = cenario();
  colocar(e, 0, 'monstro_lagarta_da_seda');
  e.jogadores[0].mao = [carta('magia_casulo_de_folha', 0)];
  e.fase = 'battle';
  igual(evoluir(e, 0, 'fusao_mariposa_da_seda').ok, false);
});

teste('Evolução do Colosso Orbital exige os dois monstros em campo', () => {
  const e = cenario();
  colocar(e, 0, 'monstro_rover_de_marte');
  igual(podeEvoluir(e, 0, 'fusao_colosso_orbital').ok, false, 'falta a sonda');
  colocar(e, 0, 'monstro_sonda_orbital');
  igual(evoluir(e, 0, 'fusao_colosso_orbital').ok, true, 'com os dois');
});

// ---------- Efeitos e magias ----------
teste('aplicarEfeito: ação desconhecida retorna ok:false', () => {
  const e = cenario();
  const r = aplicarEfeito(e, 0, { gatilho: 'ao_ativar', acao: 'teletransportar', alvo: 'jogador', valor: 1, descricao_texto: '' });
  igual(r.ok, false);
});

teste('Poção de Cura recupera 1000 PV e vai ao cemitério', () => {
  const e = cenario();
  e.jogadores[0].pontos_vida = 5000;
  e.jogadores[0].mao = [carta('magia_pocao_de_cura', 0)];
  igual(ativarMagia(e, 0, 0).ok, true);
  igual(e.jogadores[0].pontos_vida, 6000, 'PV');
  igual(e.jogadores[0].cemiterio.length, 1, 'cemitério');
});

teste('Chuva de Meteoros causa 800 de dano ao oponente', () => {
  const e = cenario();
  e.jogadores[0].mao = [carta('magia_chuva_de_meteoros', 0)];
  ativarMagia(e, 0, 0);
  igual(e.jogadores[1].pontos_vida, 7200);
});

teste('Sabedoria Antiga compra 2 cartas e a magia sai da mão', () => {
  const e = cenario();
  e.jogadores[0].mao = [carta('magia_sabedoria_antiga', 0)];
  ativarMagia(e, 0, 0);
  igual(e.jogadores[0].mao.length, 2, 'mão');
});

teste('Erupção de Luz destrói o monstro mais forte do oponente', () => {
  const e = cenario();
  colocar(e, 1, 'monstro_lula_comum');
  const forte = colocar(e, 1, 'monstro_tubarao_martelo');
  e.jogadores[0].mao = [carta('magia_erupcao_de_luz', 0)];
  igual(ativarMagia(e, 0, 0).ok, true);
  igual(e.jogadores[1].zona_monstros[forte], null, 'o mais forte foi destruído');
  igual(e.jogadores[1].zona_monstros.filter(Boolean).length, 1, 'o outro sobrou');
});

teste('Erupção de Luz sem alvos falha e a carta continua na mão', () => {
  const e = cenario();
  e.jogadores[0].mao = [carta('magia_erupcao_de_luz', 0)];
  igual(ativarMagia(e, 0, 0).ok, false);
  igual(e.jogadores[0].mao.length, 1, 'carta ainda na mão');
});

// ---------- Batalha ----------
teste('ataque vs ataque: atacante maior destrói o defensor e o dono dele perde a diferença', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_rover_de_marte'); // 1400
  const b = colocar(e, 1, 'monstro_aprendiz_de_espada'); // 1200
  modoBatalha(e);
  const log = declararAtaque(e, 0, a, b);
  igual(log.ok, true);
  igual(log.tipoResultado, 'atacante_venceu');
  igual(e.jogadores[1].zona_monstros[b], null, 'defensor destruído');
  igual(e.jogadores[1].pontos_vida, 7800, 'PV do defensor');
  igual(e.jogadores[0].pontos_vida, 8000, 'PV do atacante');
});

teste('ataque vs ataque: atacante menor é destruído e perde a diferença', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_aprendiz_de_espada'); // 1200
  const b = colocar(e, 1, 'monstro_rover_de_marte'); // 1400
  modoBatalha(e);
  const log = declararAtaque(e, 0, a, b);
  igual(log.tipoResultado, 'atacante_perdeu');
  igual(e.jogadores[0].zona_monstros[a], null, 'atacante destruído');
  igual(e.jogadores[0].pontos_vida, 7800, 'PV do atacante');
});

teste('ataque vs ataque: empate destrói os dois sem dano', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_lula_comum');
  const b = colocar(e, 1, 'monstro_lula_comum');
  modoBatalha(e);
  const log = declararAtaque(e, 0, a, b);
  igual(log.tipoResultado, 'empate');
  igual(e.jogadores[0].zona_monstros[a], null);
  igual(e.jogadores[1].zona_monstros[b], null);
  igual(e.jogadores[0].pontos_vida + e.jogadores[1].pontos_vida, 16000, 'ninguém perdeu PV');
});

teste('ataque vs defesa: ATK > DEF destrói o defensor sem dano de vida', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_peixe_espada'); // 1700
  const b = colocar(e, 1, 'monstro_lula_comum', 'defesa'); // DEF 1200
  modoBatalha(e);
  const log = declararAtaque(e, 0, a, b);
  igual(log.tipoResultado, 'defensor_destruido');
  igual(e.jogadores[1].zona_monstros[b], null);
  igual(e.jogadores[1].pontos_vida, 8000, 'sem dano');
});

teste('ataque vs defesa: ATK < DEF causa dano de reflexo no atacante, que sobrevive', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_besouro_blindado'); // 1500
  const b = colocar(e, 1, 'monstro_rover_de_marte', 'defesa'); // DEF 1800
  modoBatalha(e);
  const log = declararAtaque(e, 0, a, b);
  igual(log.tipoResultado, 'reflexo');
  igual(e.jogadores[0].pontos_vida, 7700, 'reflexo de 300');
  afirmar(e.jogadores[0].zona_monstros[a] !== null, 'atacante sobrevive');
  afirmar(e.jogadores[1].zona_monstros[b] !== null, 'defensor sobrevive');
});

teste('ataque vs defesa: ATK = DEF não acontece nada', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_lula_comum'); // 1000
  const b = colocar(e, 1, 'monstro_sonda_orbital', 'defesa'); // DEF 1000
  modoBatalha(e);
  const log = declararAtaque(e, 0, a, b);
  igual(log.tipoResultado, 'nada');
  igual(e.jogadores[0].pontos_vida + e.jogadores[1].pontos_vida, 16000);
  afirmar(e.jogadores[0].zona_monstros[a] && e.jogadores[1].zona_monstros[b], 'os dois continuam');
});

teste('defensor virado para baixo é revelado antes do cálculo', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_besouro_blindado');
  const b = colocar(e, 1, 'monstro_rover_de_marte', 'defesa', true);
  modoBatalha(e);
  const log = declararAtaque(e, 0, a, b);
  igual(log.defensorRevelado, true, 'log informa revelação');
  igual(e.jogadores[1].zona_monstros[b].viradaParaBaixo, false, 'agora virado para cima');
  igual(log.valorDefensor, 1800, 'usou a DEF real');
});

teste('o cálculo da batalha usa ATK efetivo (campo Mar de Europa)', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_lula_comum'); // 1000 +300 = 1300
  const b = colocar(e, 1, 'monstro_besouro_blindado'); // 1500 -200 = 1300
  e.cartaCampo = carta('campo_mar_de_europa', 0);
  modoBatalha(e);
  const log = declararAtaque(e, 0, a, b);
  igual(log.atkAtacante, 1300, 'ATK do atacante');
  igual(log.tipoResultado, 'empate', 'empate com valores efetivos');
});

teste('ataque direto causa o ATK inteiro como dano', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_peixe_espada');
  modoBatalha(e);
  const log = declararAtaque(e, 0, a, null);
  igual(log.tipoResultado, 'ataque_direto');
  igual(e.jogadores[1].pontos_vida, 6300);
});

teste('ataque direto é recusado se o oponente tem monstros', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_peixe_espada');
  colocar(e, 1, 'monstro_lula_comum');
  modoBatalha(e);
  igual(declararAtaque(e, 0, a, null).ok, false);
});

teste('cada monstro ataca só 1 vez por turno', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_peixe_espada');
  modoBatalha(e);
  igual(declararAtaque(e, 0, a, null).ok, true);
  igual(declararAtaque(e, 0, a, null).ok, false);
});

teste('monstro em defesa não pode atacar', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_peixe_espada', 'defesa');
  modoBatalha(e);
  igual(declararAtaque(e, 0, a, null).ok, false);
});

teste('o jogador que começa não ataca no turno 1', () => {
  const e = cenario();
  e.turno = 1;
  const a = colocar(e, 0, 'monstro_peixe_espada');
  modoBatalha(e);
  igual(declararAtaque(e, 0, a, null).ok, false);
});

teste('ataque fora da Battle Phase é recusado', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_peixe_espada');
  igual(declararAtaque(e, 0, a, null).ok, false);
});

teste('efeito "ao ser destruído": Colosso Orbital causa 500 de dano ao oponente do dono', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_titan_de_saturno'); // 3200
  const b = colocar(e, 1, 'fusao_colosso_orbital');
  modoBatalha(e);
  declararAtaque(e, 0, a, b);
  igual(e.jogadores[1].pontos_vida, 8000 - (3200 - cartasPorId.fusao_colosso_orbital.atk), 'dono do colosso perde a diferença da batalha');
  igual(e.jogadores[0].pontos_vida, 7500, 'atacante perde 500 pelo efeito');
});

// ---------- Vitória ----------
teste('derrota quando os pontos de vida chegam a 0', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_peixe_espada');
  e.jogadores[1].pontos_vida = 1000;
  modoBatalha(e);
  declararAtaque(e, 0, a, null);
  igual(e.jogadores[1].pontos_vida, 0, 'PV zerados');
  igual(e.vencedor, 0, 'vencedor');
});

teste('depois da vitória não é possível atacar mais', () => {
  const e = cenario();
  const a = colocar(e, 0, 'monstro_peixe_espada');
  const c = colocar(e, 0, 'monstro_besouro_blindado');
  e.jogadores[1].pontos_vida = 1000;
  modoBatalha(e);
  declararAtaque(e, 0, a, null);
  igual(declararAtaque(e, 0, c, null).ok, false);
});

teste('dano por magia também termina o jogo; empate se os dois zeram', () => {
  const e = cenario();
  e.jogadores[1].pontos_vida = 500;
  e.jogadores[0].mao = [carta('magia_chuva_de_meteoros', 0)];
  ativarMagia(e, 0, 0);
  igual(e.vencedor, 0, 'vitória por magia');
  const f = cenario();
  f.jogadores[0].pontos_vida = 0;
  f.jogadores[1].pontos_vida = 0;
  igual(verificarVitoria(f), 'empate');
});

resumo();
