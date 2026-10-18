// mini_teste.js
// ---------------------------------------------------------------
// Um "mini framework" de testes, sem bibliotecas externas.
// Ideia: cada teste é uma função. Se ela terminar sem erro, imprimimos OK.
// Se alguma afirmação falhar, ela lança um erro e imprimimos FALHOU com o motivo.
// ---------------------------------------------------------------

let total = 0;
let falhas = 0;

// Lança um erro se a condição for falsa.
export function afirmar(condicao, mensagem = 'afirmação falhou') {
  if (!condicao) throw new Error(mensagem);
}

// Compara dois valores simples (números, textos...) com ===.
export function igual(real, esperado, mensagem = '') {
  if (real !== esperado) {
    throw new Error(`${mensagem} (esperado: ${esperado}, veio: ${real})`.trim());
  }
}

// Executa um teste síncrono e imprime o resultado.
export function teste(nome, funcao) {
  total += 1;
  try {
    funcao();
    console.log(`OK: ${nome}`);
  } catch (erro) {
    falhas += 1;
    console.log(`FALHOU: ${nome} -> ${erro.message}`);
  }
}

// Imprime o resumo final e marca o processo com código de erro se algo falhou.
export function resumo() {
  console.log(`\n${total - falhas}/${total} testes OK`);
  if (falhas > 0) process.exitCode = 1;
}

// Versão assíncrona: use com "await testeAsync(...)" (módulos ES aceitam await no topo do arquivo).
export async function testeAsync(nome, funcao) {
  total += 1;
  try {
    await funcao();
    console.log(`OK: ${nome}`);
  } catch (erro) {
    falhas += 1;
    console.log(`FALHOU: ${nome} -> ${erro.message}`);
  }
}
