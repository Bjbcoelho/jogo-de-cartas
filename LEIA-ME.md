# Real Battle Card — protótipo jogável

## Como abrir
O jogo usa módulos JavaScript, então **não abre com duplo clique**. No terminal, dentro desta pasta:

    python3 -m http.server 8000      (ou: npm run servidor)

e acesse http://localhost:8000

## Como testar
    npm test                 # validações + todas as suítes (cartas, regras, efeitos, decks, história, IA)
    npm run balanceamento    # simula centenas de partidas IA x IA e mostra taxas de vitória por deck e por fusão

## O que tem
- **Visual novo da carta** (arte em destaque; em Opções ou na Coleção dá para voltar ao clássico): cor da moldura = tipo (simples, com efeito, fusão, magia, equipamento, armadilha, campo); ícone redondo = bioma; losangos laranja = tributos; sem estrelas de nível; texto do efeito só no painel ao passar o mouse, com a carta ampliada. Cada carta pode ter `icone` (emoji) ou `imagem` (arquivo) como arte.
- **Raridades** (`raridade` em cada carta): gema no canto (● comum, ◆ rara, ★ super rara, ✦ lendária) e brilho crescente; a cor da moldura não muda.
- **Sons** (`sons.js`, sintetizados): carta puxada do deck; fanfarra de monstro Super Raro; trovão + coro de monstro Lendário. Opção liga/desliga em Opções.
- **Efeitos de monstros**: gatilhos `ao_invocar`, `ao_destruir_oponente`, `ao_ser_destruido`, `standby`, `continuo` (inclui auras que enfraquecem o oponente).
- **Magias novas**: reviver monstro, descartar carta, enfraquecer monstros do oponente, bônus em massa, destruir todos.
- **Armadilhas novas**: negar ataque, negar magia, destruir fusão recém-criada, enfraquecer atacantes.
- **Fusões especiais** (`condicao_especial`): PV máximo/mínimo, menos PV que o oponente, cemitério, carta de campo ativa, turno mínimo.
- **Balanceamento**: ver `simular_balanceamento.js`. Decks ficam ~50% x 50%; fusão chega exausta (não ataca no turno em que nasce).
- **Modo História** (`historia.json` + `historia.js`): 10 fases, IA nível 1→5, PV extra e cartas extras para o oponente, objetivos (vencer, fusões, sem dano direto, sem perder monstros, em N turnos, PV mínimo, armadilhas), progresso salvo no navegador.

## Como criar conteúdo
- **Carta nova**: edite `cards_db.json` (ou `cards_marte.json` / `cards_humanos.json`) e rode `node validar_cartas.js`.
- **Fase nova**: acrescente em `historia.json` (a dificuldade não pode diminuir; toda fase precisa do objetivo `vencer`). `node teste_historia.js` valida.

## Campo de batalha novo, Sala de Testes e cartas novas

**Campo (visual novo):** zonas com runas (azul = suas, vermelho = do oponente; as do lado da vez pulsam), círculo mágico girando sob o tabuleiro, linha de energia no meio, vinheta e partículas que mudam com o cenário. Monstro em campo ganha poça de luz na cor do tipo; lendária ganha runa dourada. Pilhas viraram versos de carta (Deck dourado, Cemitério com redemoinho, Extra roxo). No visual "Clássico" nada disso é aplicado.

**Cenários (7):** padrão (arena arcana), Marte, Terra, Europa, Floresta, Cidade e Tempestade Solar (nova). Mapeados em `CENARIOS` no `ui.js`.

**Sala de Testes:** abra `index.html?sala` (com o servidor local rodando, ex.: `npm run sala` e depois `http://localhost:8000/index.html?sala`). Painel à esquerda com: troca de cenário, vitrine (todas as raridades na mesa), duelo IA × IA ao vivo, simulação rápida de 30 duelos, galeria de todas as cartas e o botão "Rodar todas" (verificações).

**Teste automático de navegador:** `npm install --save-dev playwright`, `npx playwright install chromium`, depois `npm run teste:navegador`. Roda as verificações em 3 tamanhos de janela e salva fotos de cada cenário em `capturas/`.

**Cartas novas (23, total 128):** 9 monstros, 4 fusões (2 especiais: Enguia da Tempestade pede 3+ cartas no cemitério; Eclipse Eterno pede turno 8+), 4 magias, 3 armadilhas, 2 equipamentos e o campo Tempestade Solar. Todas as 49 cartas de apoio que não tinham arte agora têm ícone próprio.

## Fundos panorâmicos dos campos (estilo "render 3D")

Cada cenário usa uma imagem em `fundos/` (marte, terra, europa, floresta, cidade, solar, padrao). Elas são geradas por `ferramentas/gerar_fundos.py`, que monta um terreno 3D com relevo, névoa de distância, sol, planeta e céu, no estilo da paisagem de Marte de referência.

- Gerar tudo de novo: `pip install numpy pillow` (uma vez) e depois `python ferramentas/gerar_fundos.py` (ou `npm run fundos`). Só um cenário: `python ferramentas/gerar_fundos.py marte`. Versão rápida de teste: acrescente `--rapido`.
- Para mudar um cenário, edite o dicionário dele em `CENAS` (cores do céu, posição do sol/planeta, altura do relevo, semente do terreno) e gere de novo.
- Para usar uma imagem sua (arte feita à mão, gerada por IA, foto com licença), basta salvar um JPG 1920×1080 com o mesmo nome em `fundos/`, ex.: `fundos/marte.jpg`. Dica: deixe o horizonte a cerca de 1/3 da altura, porque o tabuleiro cobre o centro da tela.
- O fundo faz um zoom lento de "respiração" (desligado se o sistema pedir menos movimento). No visual Clássico os fundos não são usados.

## Campo vivo (Fase 2, bloco A): clima, parallax e áudio ambiente

- **Clima (`clima.js`)**: partículas num canvas, uma camada atrás do tabuleiro e outra bem fraca na frente. Poeira e rajadas de vento em Marte, neve em Europa, vaga-lumes e folhas na Floresta, brasas na Tempestade Solar, poeira dourada na Cidade, estrelinhas na arena. Há brilho e reflexo de lente no ponto do sol. O fundo e o tabuleiro se mexem um pouco com o mouse (parallax).
- **Áudio ambiente (`ambiente.js`)**: tudo sintetizado, sem arquivos de áudio. Cada cenário tem camadas contínuas (vento, mar, rugido), eventos aleatórios (pios, estalos de gelo, sinos) e uma trilha suave de acordes. Ao trocar o campo o som antigo some devagar e o novo entra (crossfade). O vento de Marte acompanha as rajadas de poeira da tela. Cada cenário tem um fator de volume em `NIVEL_CENARIO` para todos soarem no mesmo nível.
- **Opções** (tela Opções): Som do ambiente (liga/desliga), Volume do ambiente (Baixo/Médio/Alto) e Qualidade dos efeitos do campo (Alta/Média/Baixa, controla a quantidade de partículas). "Reduzir movimento" do sistema deixa o clima parado.
- **Testes**: a Sala de Testes ganhou duas verificações: o clima precisa custar menos de 4 ms por quadro e a qualidade precisa reduzir as partículas; o áudio dos 7 ambientes é renderizado sem alto-falante e precisa ser válido, sem estourar e com volumes parecidos.
- **Plano da Fase 2**: está no documento `claude/fase2-roteiro.md` do projeto (blocos A a D).
