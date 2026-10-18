// deck_builder.js
// ---------------------------------------------------------------
// Funções auxiliares para montar decks a partir do cards_db.json.
// Elas NÃO leem arquivos: recebem o banco já carregado (objeto),
// assim funcionam tanto no Node (testes) quanto no navegador (UI).
// ---------------------------------------------------------------

import { embaralhar } from './game_state.js';

// Cria um "dicionário" id -> carta, juntando todas as categorias do banco.
// Exemplo: cartasPorId["monstro_lula_comum"] devolve a carta da Lula-comum.
export function indexarBanco(banco) {
  const porId = {};
  for (const categoria of ['monstros', 'fusoes', 'magias', 'equipamentos', 'armadilhas', 'campos']) {
    for (const carta of banco[categoria] || []) {
      porId[carta.id] = carta;
    }
  }
  return porId;
}

// Repete cada id "copias" vezes: (["a","b"], 2) -> ["a","a","b","b"].
function repetir(ids, copias) {
  const saida = [];
  for (const id of ids) for (let i = 0; i < copias; i++) saida.push(id);
  return saida;
}

// Monta um deck aleatório VÁLIDO: 40 cartas (máx. 3 cópias de cada) + deck extra.
// Receita: 20 monstros (até 2 cópias de cada) + 20 cartas de apoio (até 3 cópias).
// O deck extra recebe 2 cópias de cada fusão sorteada (dentro do limite de 10 cartas).
// Recebe o dicionário id -> carta e retorna { deckPrincipal: [ids], deckExtra: [ids] }.
export function montarDeckAleatorio(cartasPorId) {
  // Cartas dos decks temáticos (campo "deck") ficam de fora do sorteio: elas só funcionam juntas.
  const todas = Object.values(cartasPorId).filter((c) => !c.deck);
  const idsMonstros = todas.filter((c) => c.tipo === 'monstro').map((c) => c.id);
  const idsApoio = todas
    .filter((c) => ['magia', 'equipamento', 'armadilha', 'campo'].includes(c.tipo))
    .map((c) => c.id);
  // O deck extra aceita no máximo 10 cartas: sorteamos até 5 fusões diferentes, 2 cópias de cada.
  const idsFusoes = embaralhar(todas.filter((c) => c.tipo === 'fusao').map((c) => c.id)).slice(0, 5);

  const monstros = embaralhar(repetir(idsMonstros, 2)).slice(0, 20);
  const apoio = embaralhar(repetir(idsApoio, 3)).slice(0, 20);
  return {
    deckPrincipal: embaralhar([...monstros, ...apoio]),
    deckExtra: repetir(idsFusoes, 2),
  };
}

// Monta um deck pronto a partir de uma definição de decks.json:
// { principal: [{id, copias}], extra: [ids] } -> { deckPrincipal: [ids], deckExtra: [ids] }
export function montarDeckPronto(definicao) {
  const deckPrincipal = [];
  for (const { id, copias } of definicao.principal) {
    for (let i = 0; i < copias; i++) deckPrincipal.push(id);
  }
  return { deckPrincipal: embaralhar(deckPrincipal), deckExtra: [...definicao.extra] };
}
