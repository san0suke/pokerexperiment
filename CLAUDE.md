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

### Estado das mesas é in-memory

`server/src/tables/table.registry.ts` guarda as mesas num `Map` de módulo, com três
mesas fixas semeadas na carga. Reiniciar o servidor zera assentos. Só o `User` está no
Postgres (`prisma/schema.prisma`) — `chips` é `BigInt` e é convertido para `Number` na
fronteira da API (`auth.service.ts`). Persistir mãos e saldo é fase futura; o registry
já está escrito prevendo que hand/pot state entrem nele.

Fluxo de assentos: `table.handlers.ts` trata join/leave/disconnect, sempre emitindo
`table:state` para a sala `table:<id>` **e** `broadcastLobby(io)` para atualizar a
contagem no lobby. Desconexão usa `unseatUserEverywhere` porque o socket não sabe em
que mesa estava.

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

O Phaser roda em `Scale.RESIZE` — o canvas tem o tamanho real da área visível, não há
resolução de projeto. Consequências para **toda cena nova**:

- Leia as medidas com `readLayout(this.scale)` (`ui/layout.ts`) e posicione tudo a
  partir de `width/height/portrait/short/ui/padX/...`; use `px()` e `space()` para
  fontes e espaçamentos proporcionais. Coordenadas fixas voltam a quebrar no celular.
- Escute `Phaser.Scale.Events.RESIZE` e **reconstrua** a cena; remova o listener no
  `SHUTDOWN` (junto com os `socket.off`). Veja `LobbyScene`/`TableScene` como modelo.
- Alvos de toque saem de `createButton` (`ui/button.ts`), que garante os 44px mínimos —
  um `Text` interativo vira um alvo de poucos pixels no celular.
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

## Estado atual

Pronto: auth JWT, socket autenticado, lobby com contagem em tempo real, entrar/sair de
mesa com assentos sincronizados, liberação de assento no disconnect, avaliador de mãos
completo (melhor 5 de 7, desempate por kickers, 24 testes).

Pronto também: pronto/não pronto por jogador (`table:set-ready`) e a mão completa de
Texas Hold'em — dealer button girando, blinds cobrados a cada mão, baralho embaralhado
com RNG criptográfico, hole cards entregues socket a socket (`hand:private-state`),
rodadas de aposta com fold/check/call/raise validados no servidor (`hand:action`),
flop/turn/river, all-in com side pots e showdown pelo avaliador (`hand:ended`).
Buy-in fixo de 1000 fichas ao sentar, com recompra automática de quem quebra
(`BUY_IN` em `table.registry.ts`), até existir loja/saldo por jogador. Sair no meio da
mão é fold: o pote fica para quem sobrou.

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

Ainda não existe: relógio de ação (uma mesa espera para sempre por quem não joga),
histórico de mãos e persistência — reiniciar o servidor zera tudo.
