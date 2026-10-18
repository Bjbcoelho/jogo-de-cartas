// teste_navegador.mjs
// ---------------------------------------------------------------
// Teste automático NO NAVEGADOR (abre um Chromium invisível, roda a Sala de Testes e tira fotos).
//
// Preparação (uma vez):   npm install --save-dev playwright   e   npx playwright install chromium
// Para rodar:             npm run teste:navegador
//
// O que faz:
//  1. sobe um servidor local para os arquivos do jogo;
//  2. abre index.html?sala&auto em 3 tamanhos de janela e espera as verificações da sala;
//  3. tira uma foto de cada cenário e da galeria na pasta  capturas/ ;
//  4. falha (código 1) se alguma verificação falhar ou se o console tiver erros.
// ---------------------------------------------------------------
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pasta = path.dirname(fileURLToPath(import.meta.url));
const saida = path.join(pasta, 'capturas');
fs.mkdirSync(saida, { recursive: true });

let playwright;
try { playwright = await import('playwright'); }
catch {
  const alternativo = process.env.PLAYWRIGHT_PATH; // caminho do módulo, se estiver instalado em outro lugar
  if (!alternativo) { console.error('Playwright não encontrado. Rode: npm install --save-dev playwright && npx playwright install chromium'); process.exit(1); }
  playwright = await import(alternativo);
}
const { chromium } = playwright;

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const servidor = http.createServer((req, res) => {
  const arquivo = path.join(pasta, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
  if (!arquivo.startsWith(pasta) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] ?? 'application/octet-stream' });
  fs.createReadStream(arquivo).pipe(res);
});
await new Promise((ok) => servidor.listen(0, ok));
const url = `http://localhost:${servidor.address().port}/index.html`;

const navegador = await chromium.launch({
  args: ['--no-sandbox'],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
let falhas = 0;
const falhar = (msg) => { falhas += 1; console.log(`  ✘ ${msg}`); };

for (const [largura, altura] of [[1366, 768], [1920, 1080], [1280, 720]]) {
  console.log(`\n== Janela ${largura}x${altura} ==`);
  const pagina = await (await navegador.newContext({ viewport: { width: largura, height: altura } })).newPage();
  const erros = [];
  pagina.on('pageerror', (e) => erros.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });

  await pagina.goto(`${url}?sala&auto`);
  await pagina.waitForFunction(() => window.__salaResultado, null, { timeout: 120000 });
  const r = await pagina.evaluate(() => window.__salaResultado);
  for (const v of r.resultados) {
    console.log(`  ${v.ok ? '✔' : '✘'} ${v.nome}${v.detalhe ? ` — ${v.detalhe}` : ''}`);
    if (!v.ok) falhas += 1;
  }

  // Fotos: cada cenário com a vitrine montada.
  await pagina.evaluate(() => document.getElementById('sala').classList.add('recolhida'));
  for (const nome of ['padrao', 'marte', 'terra', 'europa', 'floresta', 'cidade', 'solar']) {
    await pagina.evaluate(async (n) => {
      const sala = await import('./sala.js');
      sala.definirCenario(n); sala.montarVitrine();
    }, nome);
    await pagina.waitForTimeout(1700); // dá tempo da transição suave do cenário
    await pagina.screenshot({ path: path.join(saida, `${largura}x${altura}_${nome}.png`) });
  }
  if (largura === 1366) {
    await pagina.evaluate(() => document.querySelector('#sala .corpo').parentElement.classList.remove('recolhida'));
    await pagina.click('#sala button:has-text("Abrir galeria")');
    await pagina.waitForTimeout(500);
    await pagina.screenshot({ path: path.join(saida, 'galeria.png') });
  }
  if (erros.length) erros.forEach((e) => falhar(`erro no console: ${e}`));
  await pagina.context().close();
}

await navegador.close();
servidor.close();
console.log(falhas === 0 ? '\nTudo certo. Fotos em capturas/' : `\n${falhas} problema(s).`);
process.exit(falhas === 0 ? 0 : 1);
