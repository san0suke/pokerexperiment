# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Jogo de Texas Hold'em multiplayer para navegador, com fichas virtuais (sem dinheiro
real — decisão deliberada para evitar requisitos regulatórios de gambling).
Monorepo npm workspaces: `@poker/shared`, `@poker/server`, `@poker/client`.
Respostas e comentários novos em português, seguindo o que já existe no repositório.

## Comandos

```bash
npm run dev          # server (:3000) + client (:5173) em watch, juntos
npm run build        # compila shared -> server -> client, nessa ordem
npm run test         # vitest em shared e server
npm run lint         # eslint no monorepo inteiro
```

Um teste só (rode de dentro do pacote — o `vitest.config.ts` fica lá):

```bash
cd packages/shared && npx vitest run src/poker/hand-evaluator.test.ts
cd packages/shared && npx vitest run -t "flush"      # por nome do teste
```

Banco e smoke test:

```bash
npm run prisma:migrate -w @poker/server -- --name <nome>
npm run prisma:studio  -w @poker/server
npm run smoke          -w @poker/server              # requer o server rodando
SMOKE_API=http://192.168.0.190:3000 npm run smoke -w @poker/server
```

### Links de workspace no Windows (se voltar a dar "Cannot find module '@poker/shared'")

Os links em `node_modules/@poker/*` já vieram, uma vez, num formato que o Windows
recusa atravessar ("o caminho contém um ponto de montagem não confiável"). O sintoma
é amplo: falha no `tsc --noEmit`, no `vitest` do server e até em runtime se algo
importar um **valor** de `@poker/shared` (só os `import type` sobrevivem, porque
somem na compilação). O `vite build` continua funcionando e disfarça o problema — ele
tem alias próprio.

Conserto (não precisa de admin, e não altera nada versionado):

```powershell
foreach ($p in 'shared','server','client') {
  cmd /c rmdir "node_modules\@poker\$p"
  cmd /c mklink /J "node_modules\@poker\$p" "<raiz>\packages\$p"
}
```

Depois disso `npx tsc --noEmit` passa nos três pacotes.

## Arquitetura

### `shared` é o contrato, não uma pasta de utilitários

`packages/shared/src/socket/` define `ClientToServerEvents` e `ServerToClientEvents`.
Os dois lados tipam o Socket.IO a partir dessas interfaces (`PokerServer`/`PokerSocket`
em `server/src/socket/lobby.handlers.ts`, `PokerClientSocket` no cliente), então mudar
um payload quebra a compilação em vez de quebrar em produção. **Todo evento novo entra
primeiro em `shared`.** O pacote é consumido como TypeScript cru (`main: src/index.ts`),
sem build intermediário em dev.

### O servidor é a autoridade — regra permanente

O servidor é o único dono do baralho, do embaralhamento e da validação de ações:

- Hole cards vão **só** para o socket do dono, nunca no estado compartilhado.
- `TableState` (broadcast para a sala) não pode carregar informação oculta, nem
  "para o cliente ignorar" — qualquer carta que chegue ao cliente é visível no DevTools.
- Toda ação (fold/check/call/raise/all-in) é validada no servidor; o cliente só sugere.
- `Deck.shuffle()` aceita um parâmetro `random` para o servidor injetar um RNG
  criptográfico no lugar de `Math.random`.

Ao implementar a máquina de estados do jogo, separe explicitamente o estado público
da mesa do estado privado por jogador e emita os dois por canais distintos.

### Estado das mesas é in-memory, mas o saldo não

`server/src/tables/table.registry.ts` guarda as mesas num `Map` de módulo, com três
mesas fixas semeadas na carga. Reiniciar o servidor zera assentos. Só o `User` está no
Postgres (`prisma/schema.prisma`) — `chips` é `BigInt` e é convertido para `Number` na
fronteira da API (`auth.service.ts`) e em `users/balance.service.ts`. Persistir o
histórico de mãos continua sendo fase futura; o registry já está escrito prevendo que
hand/pot state entrem nele.

**O stack na mesa é o saldo da conta.** Não há buy-in fixo: `seatUser` recebe as
fichas de fora e quem senta leva o saldo inteiro. O registry continua sem falar com o
banco — quem lê e grava é `table.handlers.ts`, nos dois únicos instantes em que o
stack é um número fechado:

- **fim de mão** (`persistTableBalances`) — pela ação, pelo relógio da vez ou por uma
  saída que encerrou a mão;
- **`table:leave`** — o `UnseatResult.chips` é o que ele levou embora.

No meio da mão o banco fica com o saldo de antes dela, de propósito: o que está no
pote ainda não é de ninguém, e um servidor que caia agora devolve a todos o que
tinham quando a mão começou.

Duas consequências que já custaram caro:

- **Uma mesa por jogador.** `table:join` recusa quem já está sentado em outra
  (`getSeatedTableId`): o saldo é um só e viaja inteiro, então em duas mesas as mesmas
  fichas existiriam duas vezes e a mão que acabasse por último apagaria a outra.
- **Sentar de novo não repõe nada.** Reconexão e segunda aba caem no assento que já
  existe, e o valor recebido é ignorado — as fichas de quem está jogando são as da
  mesa, que podem estar bem à frente do último saldo gravado.

Quebrou, quebrou: não existe recompra automática. `playableSeats` deixa de fora quem
está zerado, então a mesa segue sem ele, e a `TableScene` troca o botão de pronto por
um "Sem fichas" desligado. Uma loja ou um crédito diário entra aqui, em
`balance.service.ts`, e é a única coisa que devolve fichas a uma conta zerada.

O saldo novo volta para o dono por `user:balance` (socket a socket — saldo é assunto
de quem o tem). O `socket-client` o grava no `localStorage` assim que chega, e a
`LobbyScene` só se redesenha: sem isso o cabeçalho do lobby mostraria o saldo do
login até o próximo login.

Fluxo de assentos: `table.handlers.ts` trata join/leave/disconnect, sempre emitindo
`table:state` para a sala `table:<id>` **e** `broadcastLobby(io)` para atualizar a
contagem no lobby.

**Cair não é sair — e o assento não é liberado nunca.** No `disconnect`,
`markUserDisconnected` marca o assento (`TableSeat.disconnected`, público) e derruba
o `ready`. Só isso. Não há prazo de reconexão nem varredura: a mesa não some porque
a internet oscilou, e quem volta encontra o próprio assento, as próprias fichas e os
vizinhos onde estavam — ausentes ou não. Só o próprio jogador se levanta, pelo
`table:leave`. Uma conexão nova desfaz a marca já no `registerTableHandlers`, antes
de qualquer `table:join`.

O ausente fica **de fora da próxima mão**, não da mesa: `playableSeats` o exclui,
então ele não paga blind e — o ponto que trava tudo se esquecido — não entra na
conta do `canStartHand`, que exige o pronto de *todos* os que podem jogar. Um
assento ausente nunca fica pronto; contá-lo deixaria a mesa sem começar mais
nenhuma mão. A mão em que ele já estava, essa segue com ele: o relógio da vez passa
ou desiste no lugar dele a cada 25s, até o fim, mesmo que não sobre ninguém
conectado na mesa.

**Uma queda são dois sockets.** O socket.io reconecta em um segundo, mas o servidor
só percebe a morte do socket antigo pelo ping (até ~45s depois). O `disconnect`
atrasado chega com o jogador já de volta e jogando; tratá-lo como queda marcava
como ausente quem estava na frente da tela. Por isso `liveSockets` conta as
conexões vivas por usuário em `table.handlers.ts`: só a queda da **última** conta.

Do lado do cliente, a `TableScene` cobre a mesa com o aviso "Reconectando..."
(`ui/dialog.ts`) enquanto o socket está fora, e refaz o `table:join` a cada `connect`
— o socket que volta é outro e não está mais na sala. `services/table-session.ts`
guarda a mesa em `sessionStorage` para que uma recarga da página (o celular descarta
a aba em segundo plano) volte para ela em vez de cair no lobby.

### Autenticação

JWT em duas portas: `requireAuth` (Express, header `Authorization`) e
`socketAuthMiddleware` (handshake `socket.handshake.auth.token`, rejeita a conexão se
inválido). O socket autenticado carrega `socket.data.user`, que é a identidade usada
por todos os handlers — nunca confie em id de usuário vindo no payload.

### Configuração de rede (o jogo precisa abrir no celular)

- `.env` fica na **raiz do monorepo** e é carregado por `server/src/config/env.ts` com
  um caminho relativo (`../../../../.env`) — mover o arquivo quebra isso.
- `HOST=0.0.0.0` expõe o server na LAN; `index.ts` imprime os IPs alcançáveis no boot.
- `config/cors.ts`: com `CORS_ORIGIN` vazio roda em modo "rede local" (loopback, faixas
  privadas, `.local` e CGNAT `100.64/10` do Tailscale liberados). Em produção, defina
  as origens exatas. Coberto por testes em `cors.test.ts`.
- `client/src/services/backend-url.ts` deriva o backend do host da própria página,
  trocando só a porta. Nunca hardcode `localhost` no cliente — no celular `localhost`
  é o próprio celular.

### Cliente: layout sem resolução fixa

O Phaser roda em `Scale.NONE` com o tamanho gerenciado por
`services/canvas-scale.ts` — o canvas tem a área visível **em pixels do aparelho** e o
`zoom` do Phaser o encolhe de volta no CSS. Não há resolução de projeto. O `RESIZE`
resolvia o tamanho, mas dimensiona o canvas em pixels de CSS e ignora o `zoom`: numa
tela de densidade 2 ou 3 o navegador amplia uma imagem menor que a tela e o jogo
parece de baixa resolução. Consequências para **toda cena nova**:

- Leia as medidas com `readLayout(this.scale)` (`ui/layout.ts`) e posicione tudo a
  partir de `width/height/portrait/short/ui/padX/...`; use `px()` e `space()` para
  fontes e espaçamentos proporcionais. Coordenadas fixas voltam a quebrar no celular.
- **Tudo do `Layout` vem em unidades do canvas**, não em pixels de CSS: `ui` já traz a
  densidade embutida, então `56 * ui` continua certo. Número cru vindo de fora — piso
  de toque, limite de largura, espessura de traço — passa por `dp(layout, valor)`
  antes de ser comparado ou somado. Esquecer disso deixa o elemento do tamanho de um
  terço no celular.
- `pixelArt: false` fica escrito na config: o Phaser o liga sozinho quando o zoom é
  diferente de 1, e aí desliga o antialias.
- Escute `Phaser.Scale.Events.RESIZE` e **reconstrua** a cena; remova o listener no
  `SHUTDOWN` (junto com os `socket.off`). Veja `LobbyScene`/`TableScene` como modelo.
- Alvos de toque saem de `createButton` (`ui/button.ts`), que recebe o `Layout` e
  garante os 44px de CSS mínimos — um `Text` interativo vira um alvo de poucos pixels
  no celular.
- **`hitArea` de Container precisa vir deslocada.** O Phaser soma o `displayOrigin` do
  container (metade do tamanho) ao ponto local antes de testar a hitArea. Passar o
  mesmo retângulo usado para desenhar deixa a área clicável meio elemento acima e à
  esquerda — no celular ela sai de cima do botão e o toque não faz nada. Use
  `Rectangle(left + width / 2, top + height / 2, width, height)`.
- `env(safe-area-inset-*)` só existe no CSS; `layout.ts` mede os recortes de notch com
  um elemento invisível e devolve em `safe`.
- Campos de texto (login) ficam num overlay DOM, com layout no CSS do `index.html`;
  `services/viewport-height.ts` mantém `--app-height` igual ao viewport visual, porque
  `100vh` no celular é maior que a tela e trava a rolagem.

### Empacotamento futuro condiciona o cliente

A meta é exportar para Android/iOS via Capacitor e desktop via Electron — ambos apenas
empacotam o `dist/` do Vite. Antes de introduzir uma dependência ou API no cliente,
confirme que funciona dentro de um WebView; evite APIs de navegador além do canvas e de
um overlay DOM simples.

## Assets (ainda não integrados)

Origem: `E:\Unity\emptyProjectForAssets\New Unity Project\Assets`. São pacotes da Unity
Asset Store, e o projeto não tem nenhum deles hoje.

**Todo asset usado no jogo vai para `packages/client/public/assets/`**, em `ui/` ou
`audio/`. O Vite serve essa pasta em `/assets/...` e a copia para o `dist/`, sem passo
de build nenhum.

O conteúdo dela é ignorado pelo git — só o `README.md` de dentro é versionado, e é ele
que explica de onde vêm os arquivos e como convertê-los. **Num clone novo a pasta vem
vazia e o jogo carrega sem arte nem som**; isso é esperado, não é bug.

Só entre aqui o que já está pronto para servir: a pasta inteira vai para o `dist/`,
então um `.wav` de 39 MB esquecido nela chega ao navegador do jogador.

### UI: `Layer Lab\GUI Pro-FantasyRPG`

O pacote de UI escolhido. O que interessa está em `ResourcesData/Sprites/Component/`,
com 4528 PNGs organizados em `Button`, `Frame`, `Popup`, `Slider`, `Label-Title`,
`Chest`, `UI_Etc` e quatro conjuntos de ícones (`IconMisc`, `Icon_EquipIcons`,
`Icon_Flag`, `Icon_ItemIcons`, `Icon_PictoIcons`).

**Ignore `Prefabs/`, `Scene/`, `Extensions/`, os `.mat` e todos os `.meta`** — são
formato Unity e não têm uso no Phaser. Só os PNGs atravessam.

Os botões vêm em variações de cor sobre a mesma forma (`Button_Circle_01_Blue`,
`_Green`, `_Red`…), então dá para mapear estado (normal/hover/desabilitado) trocando o
sprite em vez de desenhar. Isso substituiria o desenho por código de `ui/button.ts`.

O pacote usa as fontes Alata, Josefin Sans e Play, todas do Google Fonts — **baixe do
Google Fonts**, não do pacote, e confira a licença de cada uma. A pasta
`ResourcesData/Fonts` não traz `.ttf`/`.otf`.

### Música de fundo

Dois pacotes, com estilos diferentes o bastante para dividir por tela:

- `25 Rpg Game Tracks` — 29 faixas: `Ambient 1-10`, `Light Ambient 1-5 (Loop)`,
  `Night Ambient 1-5 (Loop)`, `Action 1-5 (Loop)`, e as pontuais `Victory`, `Death`,
  `Complete`, `Strange`.
- `Medieval Music Pack` — 8 faixas (`Medieval Vol. 2 1` a `8`), com `.mp3` além do `.wav`.

Sugestão de uso — as faixas marcadas `(Loop)` são as que emendam sem costura, e por isso
são as certas para tela parada:

| Momento | Faixa |
| --- | --- |
| Login e lobby | `Medieval Vol. 2 *` — dá o clima de taverna antes de sentar |
| Mesa aguardando jogadores | `Light Ambient * (Loop)` — discreta, não cansa na espera |
| Mão em andamento | `Night Ambient * (Loop)` — tensão baixa e constante |
| All-in / river decisivo | `Action * (Loop)` — sobe a temperatura no momento certo |
| Ganhou o pote | `Victory` (pontual) |
| Quebrou / saiu sem fichas | `Complete` ou `Strange` — `Death` é dramática demais para poker |

Vale sortear entre as faixas equivalentes a cada sessão em vez de fixar uma: são 5 de
cada tipo, e repetir sempre a mesma cansa rápido num jogo de partidas longas.

### Converter antes de usar — os arquivos são grandes demais para web

`25 Rpg Game Tracks` tem 625 MB, só `.wav`, com faixas de até 39 MB. O `Medieval Music
Pack` tem 335 MB (`.wav` ~30 MB; os `.mp3` do próprio pacote já caem para ~7 MB).

Servir isso quebra o jogo no celular. Converta para `.ogg` (com `.mp3` de fallback para
Safari) em bitrate de música de fundo — algo em torno de 96-128 kbps leva uma faixa
para 1-3 MB. Carregue sob demanda por cena, não tudo no boot.

### Por que a pasta é ignorada

```gitignore
packages/client/public/assets/*
!packages/client/public/assets/README.md
```

**O motivo é tamanho e histórico, não visibilidade do repositório.** Ele é privado desde
19/08/2026, e a regra continua valendo — não a remova por achar que era só exposição
pública.

São ~900 MB de assets, e git guarda cada versão para sempre. Reconverteu uma faixa de
áudio? As duas ficam no histórico. O clone passa a arrastar tudo, e limpar depois exige
reescrever o histórico (`filter-repo` + force push), o que quebra qualquer clone
existente. Se o repositório voltar a ser público um dia, os assets estarão em todos os
commits passados, não só no atual — privar depois não desfaz isso.

**Nunca force a entrada de um asset com `git add -f`.** Se algum precisar mesmo ser
versionado, a exceção vai explícita no `.gitignore`, onde fica visível para quem vier
depois — não por flag na linha de comando.

Em segundo plano, a licença também pesa: pacotes da Unity Asset Store são licenciados
para uso em projetos, não para redistribuição. Nenhum dos três em uso traz licença
própria, então valem os termos padrão da Asset Store — confirme o que a sua compra
permite antes de publicar o jogo.

Os créditos dos pacotes ficam no `README.md` da pasta de assets — mantenha a lista
atualizada conforme forem entrando.

## Estado atual

Pronto: auth JWT, socket autenticado, lobby com contagem em tempo real, entrar/sair de
mesa com assentos sincronizados, liberação de assento no disconnect, avaliador de mãos
completo (melhor 5 de 7, desempate por kickers, 24 testes).

Pronto também: pronto/não pronto por jogador (`table:set-ready`) e a mão completa de
Texas Hold'em — dealer button girando, blinds cobrados a cada mão, baralho embaralhado
com RNG criptográfico, hole cards entregues socket a socket (`hand:private-state`),
rodadas de aposta com fold/check/call/raise validados no servidor (`hand:action`),
flop/turn/river, all-in com side pots e showdown pelo avaliador (`hand:ended`).
Saldo por conta: `User.chips` nasce com 1000 (default do Postgres), vira o stack ao
sentar e é regravado ao fim de cada mão e na saída da mesa.

**Sair no meio da mão é desistir dela, e a mão continua sem ele.** `unseatUser` faz
`foldSeat` antes de soltar o assento: o que ele já apostou fica no pote, a vez passa
para o próximo (com prazo novo — quem herda a vez não herda o relógio do outro) e a
mesa ouve um `hand:action-taken` de fold, senão o assento apenas sumiria e ninguém
entenderia por que o jogo seguiu. Só quando sobra um é que a mão acaba ali, com o
pote inteiro para quem ficou. Sair pela porta (`table:leave`) é diferente de cair: a
queda guarda o assento, a saída o libera na hora.

### A máquina de apostas mora em `hand-engine.ts`

`tables/hand.ts` só monta o começo (botão, blinds, distribuição). Todo o resto da mão
está em `tables/hand-engine.ts`, como funções sobre um `HandRuntime` — é onde ficam as
regras que costumam sair erradas:

- Heads-up inverte tudo: o dealer é o small blind e fala primeiro no pré-flop, mas por
  último depois do flop (a regra "primeiro ativo à esquerda do botão" já resolve os dois).
- O big blind tem a opção de aumentar mesmo quando todos só pagaram: por isso `acted`
  por jogador, em vez de comparar apostas.
- Um all-in menor que o aumento mínimo **não** reabre a ação para quem já falou.
- Aposta que ninguém cobriu volta para quem apostou antes de o pote ser entregue —
  então o pote anunciado num fold pré-flop é 10, não 15.
- Side pots saem por nível de `committed`, e a ficha ímpar de um pote dividido vai para
  o primeiro assento à esquerda do botão.

`table.registry.ts` só orquestra: guarda o runtime, copia para os assentos o que é
público (`syncSeatsFromHand`) e devolve as cartas privadas por usuário. O
`hand-engine.test.ts` cobre esses casos (21 testes), sempre conferindo que a soma das
fichas na mesa não muda.

Pronto também: queda e volta do jogador — assento guardado por 45s, aviso de
reconexão no cliente e retorno à mesa depois de uma recarga da página.

### O relógio da vez

`TURN_TIMEOUT_MS` (25s, em `table.registry.ts`) limita cada vez. Estourado o prazo,
`applyTurnTimeout` joga pelo jogador: **passa quando dá para passar e desiste quando
há aposta na mesa** — nunca gasta ficha de quem não está na frente da tela. A ação
sai como qualquer outra, com `ActionTakenPayload.timedOut` ligado para a mesa saber
o que aconteceu.

A divisão segue a mesma das remoções por queda: o registry guarda o prazo
(`Table.turnDeadline`, horário absoluto) e decide a jogada; quem acorda sozinho e
avisa a sala é `syncTurnTimer` em `table.handlers.ts`, um `setTimeout` por mesa,
reagendado depois de tudo que mexe na mão. Como o prazo é absoluto, reagendar não
estende a vez de ninguém.

No `PublicHandState` o prazo viaja como **quanto falta** (`turnEndsInMs`), não como
horário: o relógio do celular pode estar minutos fora do relógio do servidor, e a
diferença viraria um contador errado. O cliente conta a partir do que recebeu, no
`update()` da `TableScene` — o anel do assento e a linha do rodapé são as duas
únicas coisas que mudam sem evento nenhum, e mexem só nos objetos já desenhados
(refazer a cena a cada segundo engoliria o toque de quem está com o dedo no botão).

Ainda não existe: histórico de mãos, e loja ou crédito para repor uma conta zerada.
Reiniciar o servidor zera assentos e mesas — o saldo das contas sobrevive, menos o que
estiver no meio de uma mão.
