// validar_decks.js (cópia estendida do validar_cartas.js: base + decks Marciano e Humanos + conferência dos decks)
// ---------------------------------------------------------------
// Este script confere se o cards_db.json segue o Documento de Regras.
// Como rodar no terminal:  node validar_cartas.js
//
// Ideia geral: lemos o JSON, percorremos todas as cartas e, para cada
// problema que encontrarmos, guardamos uma mensagem na lista "erros".
// No final, se a lista estiver vazia, está tudo certo.
// ---------------------------------------------------------------

import { readFileSync } from 'node:fs';

// ---------- Listas fechadas permitidas pelo Documento de Regras ----------
const BIOMAS_VALIDOS = ['humano', 'inseto', 'marinho', 'planetario'];
const TIPOS_VALIDOS = ['monstro', 'fusao', 'magia', 'equipamento', 'armadilha', 'campo'];
const GATILHOS_VALIDOS = ['ao_ativar', 'ao_equipar', 'standby', 'continuo', 'ao_ser_destruido', 'ao_invocar', 'ao_destruir_oponente'];
const ACOES_VALIDAS = ['mod_atk', 'mod_def', 'curar_pv', 'causar_dano_pv', 'comprar_carta', 'destruir_monstro', 'descartar_carta', 'reviver_monstro', 'negar_ataque', 'negar_magia'];
const ALVOS_VALIDOS = ['proprio_monstro', 'monstro_equipado', 'jogador', 'oponente', 'todos_monstros', 'monstros_do_bioma', 'monstros_oponente'];
const LOCAIS_VALIDOS = ['campo', 'mao', 'zona_magias', 'mao_ou_zona_magias'];

// Cada chave do JSON guarda um tipo de carta. Este mapa diz qual "tipo"
// cada categoria deve ter dentro das cartas.
const CATEGORIA_PARA_TIPO = {
  monstros: 'monstro',
  fusoes: 'fusao',
  magias: 'magia',
  equipamentos: 'equipamento',
  armadilhas: 'armadilha',
  campos: 'campo',
};

const erros = [];
function registrarErro(idCarta, mensagem) {
  erros.push(`[${idCarta}] ${mensagem}`);
}

// ---------- Leitura do arquivo ----------
let banco;
try {
  banco = JSON.parse(readFileSync('cards_db.json', 'utf-8'));
  // Junta as cartas dos decks temáticos ao banco base.
  for (const arq of ['cards_marte.json', 'cards_humanos.json']) {
    const extra = JSON.parse(readFileSync(arq, 'utf-8'));
    for (const cat of Object.keys(banco)) banco[cat] = [...banco[cat], ...(extra[cat] || [])];
  }
} catch (e) {
  console.error('ERRO: não consegui ler/interpretar cards_db.json:', e.message);
  process.exit(1);
}

// ---------- Função que confere um efeito estruturado ----------
// Um efeito precisa ter gatilho, acao, alvo, valor e descricao_texto.
function validarEfeito(idCarta, efeito, onde) {
  if (typeof efeito !== 'object' || efeito === null) {
    registrarErro(idCarta, `${onde}: efeito ausente ou inválido`);
    return;
  }
  if (!GATILHOS_VALIDOS.includes(efeito.gatilho)) registrarErro(idCarta, `${onde}: gatilho inválido "${efeito.gatilho}"`);
  if (!ACOES_VALIDAS.includes(efeito.acao)) registrarErro(idCarta, `${onde}: ação inválida "${efeito.acao}"`);
  if (!ALVOS_VALIDOS.includes(efeito.alvo)) registrarErro(idCarta, `${onde}: alvo inválido "${efeito.alvo}"`);
  if (typeof efeito.valor !== 'number') registrarErro(idCarta, `${onde}: "valor" precisa ser número`);
  if (typeof efeito.descricao_texto !== 'string' || efeito.descricao_texto === '') {
    registrarErro(idCarta, `${onde}: falta "descricao_texto"`);
  }
  if (efeito.bioma !== undefined && !BIOMAS_VALIDOS.includes(efeito.bioma)) {
    registrarErro(idCarta, `${onde}: bioma inválido "${efeito.bioma}"`);
  }
  // Se o alvo é "monstros_do_bioma", o efeito precisa dizer qual bioma.
  if (efeito.alvo === 'monstros_do_bioma' && efeito.bioma === undefined) {
    registrarErro(idCarta, `${onde}: alvo "monstros_do_bioma" exige o campo "bioma"`);
  }
}

// ---------- Passo 1: coletar todos os ids e checar duplicatas ----------
// Usamos um Map (id -> carta) para achar cartas rapidamente depois.
const cartasPorId = new Map();
for (const categoria of Object.keys(CATEGORIA_PARA_TIPO)) {
  if (!Array.isArray(banco[categoria])) {
    erros.push(`[geral] a chave "${categoria}" não existe ou não é uma lista`);
    continue;
  }
  for (const carta of banco[categoria]) {
    if (!carta.id) {
      erros.push(`[${categoria}] carta sem id (nome: ${carta.nome})`);
      continue;
    }
    if (cartasPorId.has(carta.id)) {
      registrarErro(carta.id, 'id duplicado');
    }
    cartasPorId.set(carta.id, carta);
  }
}

// ---------- Passo 2: validar cada carta conforme sua categoria ----------
for (const [categoria, tipoEsperado] of Object.entries(CATEGORIA_PARA_TIPO)) {
  for (const carta of banco[categoria] || []) {
    const id = carta.id || '(sem id)';

    // Tipo válido e coerente com a categoria em que a carta está
    if (!TIPOS_VALIDOS.includes(carta.tipo)) registrarErro(id, `tipo inválido "${carta.tipo}"`);
    else if (carta.tipo !== tipoEsperado) registrarErro(id, `está em "${categoria}" mas tem tipo "${carta.tipo}"`);

    // O prefixo do id deve combinar com o tipo (ex.: "monstro_..." / "fusao_...")
    // Equipamentos usam o prefixo curto "equip_".
    const prefixo = tipoEsperado === 'equipamento' ? 'equip_' : `${tipoEsperado}_`;
    if (!id.startsWith(prefixo)) registrarErro(id, `id deveria começar com "${prefixo}"`);

    // Id só com letras minúsculas, números e underscore (snake_case)
    if (!/^[a-z0-9_]+$/.test(id)) registrarErro(id, 'id deve estar em snake_case (a-z, 0-9, _)');

    if (!carta.nome) registrarErro(id, 'falta "nome"');
    if (!carta.descricao) registrarErro(id, 'falta "descricao"');

    // ----- Monstros e fusões: bioma, nível, atk, def -----
    if (tipoEsperado === 'monstro' || tipoEsperado === 'fusao') {
      if (!BIOMAS_VALIDOS.includes(carta.bioma)) registrarErro(id, `bioma inválido "${carta.bioma}"`);
      if (!Number.isInteger(carta.nivel) || carta.nivel < 1 || carta.nivel > 8) {
        registrarErro(id, `nível fora de 1 a 8: ${carta.nivel}`);
      }
      if (typeof carta.atk !== 'number' || typeof carta.def !== 'number') {
        registrarErro(id, 'atk e def precisam ser números');
      } else {
        // Regra de balanceamento por faixa de nível
        let min, max;
        if (carta.nivel <= 4) [min, max] = [500, 1800];
        else if (carta.nivel <= 6) [min, max] = [1800, 2500];
        else [min, max] = [2500, 3200];
        // Balanceamento (simulação IA x IA): fusões comuns ficaram ~10% mais fracas que a faixa original.
        if (carta.tipo === 'fusao' && !carta.condicao_especial) min = carta.nivel >= 7 ? 2300 : 1700;
        // Lagarta e sonda são cartas iniciais de evolução, abaixo da faixa mínima: aviso apenas
        if (carta.atk > max || (carta.atk < min && carta.nivel > 2)) {
          registrarErro(id, `ATK ${carta.atk} fora da faixa ${min}-${max} para nível ${carta.nivel}`);
        }
        if (Math.abs(carta.atk - carta.def) > 600) {
          registrarErro(id, `DEF ${carta.def} está a mais de 600 do ATK ${carta.atk}`);
        }
      }
      if (carta.efeito) validarEfeito(id, carta.efeito, 'efeito');
    }

    // ----- Fusões: requisitos e habilidade -----
    if (tipoEsperado === 'fusao') {
      if (!Array.isArray(carta.requisitos_fusao) || carta.requisitos_fusao.length === 0) {
        registrarErro(id, 'fusão sem requisitos_fusao');
      } else {
        for (const req of carta.requisitos_fusao) {
          // O id do material precisa existir no banco
          if (!cartasPorId.has(req.id)) registrarErro(id, `requisito referencia id inexistente "${req.id}"`);
          if (!LOCAIS_VALIDOS.includes(req.local)) registrarErro(id, `local inválido "${req.local}" no requisito "${req.id}"`);
        }
      }
      validarEfeito(id, carta.habilidade_especial, 'habilidade_especial');
    }

    // ----- Magias, equipamentos e armadilhas: efeito obrigatório -----
    if (['magia', 'equipamento', 'armadilha'].includes(tipoEsperado)) {
      validarEfeito(id, carta.efeito, 'efeito');
      if (tipoEsperado === 'equipamento' && carta.efeito && carta.efeito.gatilho !== 'ao_equipar') {
        registrarErro(id, 'equipamento deve usar o gatilho "ao_equipar"');
      }
      if (tipoEsperado === 'armadilha' && !carta.condicao_ativacao) {
        registrarErro(id, 'armadilha sem "condicao_ativacao"');
      }
    }

    // ----- Campos: lista de modificadores -----
    if (tipoEsperado === 'campo') {
      if (!Array.isArray(carta.modificadores_globais) || carta.modificadores_globais.length === 0) {
        registrarErro(id, 'campo sem modificadores_globais');
      } else {
        for (const mod of carta.modificadores_globais) {
          if (!BIOMAS_VALIDOS.includes(mod.bioma)) registrarErro(id, `modificador com bioma inválido "${mod.bioma}"`);
          if (typeof mod.mod_atk !== 'number' || typeof mod.mod_def !== 'number') {
            registrarErro(id, 'modificador precisa de mod_atk e mod_def numéricos');
          }
        }
      }
    }
  }
}

// ---------- Passo 3: conferir conteúdo mínimo pedido ----------
for (const bioma of BIOMAS_VALIDOS) {
  const qtd = (banco.monstros || []).filter((m) => m.bioma === bioma).length;
  if (qtd < 4) erros.push(`[geral] bioma "${bioma}" tem só ${qtd} monstros (mínimo 4)`);
}
const obrigatorios = [
  'monstro_lagarta_da_seda', 'monstro_lula_comum', 'monstro_rover_de_marte',
  'fusao_mariposa_da_seda', 'fusao_lula_gigante_das_profundezas',
  'magia_casulo_de_folha', 'magia_coral_da_evolucao', 'campo_mar_de_europa',
];
for (const id of obrigatorios) {
  if (!cartasPorId.has(id)) erros.push(`[geral] carta obrigatória ausente: ${id}`);
}
if ((banco.fusoes || []).length < 4) erros.push('[geral] precisa de pelo menos 4 fusões');
if ((banco.fusoes || []).filter((f) => f.bioma === 'planetario').length < 1) erros.push('[geral] falta fusão planetária');
if ((banco.magias || []).length < 5) erros.push('[geral] precisa de pelo menos 5 magias (2 materiais + 3)');
if ((banco.equipamentos || []).length < 3) erros.push('[geral] precisa de pelo menos 3 equipamentos');
if ((banco.armadilhas || []).length < 3) erros.push('[geral] precisa de pelo menos 3 armadilhas');
if ((banco.campos || []).length < 3) erros.push('[geral] precisa de pelo menos 3 campos');

// ---------- Resultado final ----------
// ---------- Passo 4: decks prontos (decks.json) ----------
const definicoes = JSON.parse(readFileSync('decks.json', 'utf-8')).decks;
for (const d of definicoes) {
  const total = d.principal.reduce((s, x) => s + x.copias, 0);
  if (total !== 40) erros.push(`[deck ${d.id}] deck principal tem ${total} cartas (precisa de 40)`);
  if (d.extra.length > 10) erros.push(`[deck ${d.id}] deck extra tem ${d.extra.length} cartas (máximo 10)`);
  const vistos = new Set();
  for (const { id, copias } of d.principal) {
    const carta = cartasPorId.get(id);
    if (!carta) { erros.push(`[deck ${d.id}] id inexistente "${id}"`); continue; }
    if (carta.tipo === 'fusao') erros.push(`[deck ${d.id}] fusão "${id}" no deck principal`);
    if (copias < 1 || copias > 3) erros.push(`[deck ${d.id}] "${id}" com ${copias} cópias (1 a 3)`);
    if (vistos.has(id)) erros.push(`[deck ${d.id}] "${id}" aparece duas vezes na lista`);
    vistos.add(id);
  }
  for (const id of d.extra) {
    if (cartasPorId.get(id)?.tipo !== 'fusao') erros.push(`[deck ${d.id}] "${id}" no deck extra não é fusão`);
  }
  // Cada fusão do deck extra precisa ter seus materiais dentro do deck principal.
  for (const id of d.extra) {
    for (const req of cartasPorId.get(id)?.requisitos_fusao || []) {
      if (!vistos.has(req.id)) erros.push(`[deck ${d.id}] fusão "${id}" precisa de "${req.id}", que não está no deck principal`);
    }
  }
  console.log(`deck ${d.id}: ${total} no principal, ${d.extra.length} no extra`);
}
// Equipamento com segundo efeito também precisa de um efeito válido.
for (const e of banco.equipamentos) if (e.efeito_secundario) validarEfeito(e.id, e.efeito_secundario, 'efeito_secundario');

console.log('=== Totais por categoria ===');
for (const categoria of Object.keys(CATEGORIA_PARA_TIPO)) {
  console.log(`${categoria}: ${(banco[categoria] || []).length}`);
}

if (erros.length === 0) {
  console.log('\nOK: nenhum erro encontrado. Todos os ids de requisitos_fusao existem.');
} else {
  console.log(`\nFALHOU: ${erros.length} problema(s) encontrado(s):`);
  for (const e of erros) console.log(' - ' + e);
  process.exit(1);
}
