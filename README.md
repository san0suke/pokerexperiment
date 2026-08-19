# Poker — Texas Hold'em multiplayer

Jogo de poker 2D para navegador, com multiplayer em tempo real. Fichas virtuais,
sem dinheiro real. A base já está preparada para ser empacotada depois para
Android/iOS (Capacitor) e desktop (Electron).

## Stack

| Parte         | Tecnologia                 |
| ------------- | -------------------------- |
| Jogo          | TypeScript + Phaser 3      |
| Bundler       | Vite                       |
| Multiplayer   | Socket.IO (WebSockets)     |
| Backend       | Node.js + Express + TS     |
| Banco         | PostgreSQL + Prisma        |
| Autenticação  | JWT + bcrypt               |

## Estrutura

Monorepo com npm workspaces:

```
packages/
  shared/   @poker/shared  — tipos, baralho, avaliador de mãos, contratos de socket
  server/   @poker/server  — API REST, autenticação, servidor Socket.IO
  client/   @poker/client  — jogo em Phaser
```

O pacote `shared` é a fonte única de verdade dos contratos entre client e server:
os eventos de socket são tipados nos dois lados a partir das mesmas interfaces,
então uma mudança de payload quebra a compilação em vez de quebrar em produção.

## Setup

Requer Node 20+ e PostgreSQL rodando localmente.

```bash
# 1. Instalar dependências (na raiz, resolve os 3 workspaces)
npm install

# 2. Configurar o ambiente
cp .env.example .env
#    ajuste DATABASE_URL com a senha do seu Postgres e troque JWT_SECRET

# 3. Criar o banco e aplicar o schema
npm run prisma:migrate -w @poker/server -- --name init
```

## Rodando

```bash
npm run dev     # sobe server (:3000) e client (:5173) juntos
```

Abra <http://localhost:5173>, crie uma conta e entre numa mesa.
Para testar o multiplayer, abra uma segunda aba anônima com outra conta.

### Jogando de outros aparelhos (celular, tablet, outro PC)

Ao subir, o servidor imprime os endereços de rede. Use um deles no aparelho:

```
[server]   network: http://192.168.0.190:3000
[client]   Network: http://192.168.0.190:5173   <- abra este no celular
```

Abra a porta **5173** no aparelho (a 3000 é só o backend; o cliente a alcança
sozinho). O cliente descobre o backend a partir do endereço da própria página,
então o mesmo comando funciona em localhost, no IP da rede local e via Tailscale,
sem trocar nenhuma configuração.

Se não abrir no celular, verifique nesta ordem:

1. **O IP está certo?** Use exatamente o que o servidor imprimiu. Endereços de
   Tailscale começam com `100.`, não `10.` — é um engano fácil de cometer.
2. **O aparelho está na mesma rede?** Wi-Fi do celular e cabo do PC precisam
   estar no mesmo roteador (ou ambos no Tailscale).
3. **Firewall do Windows.** O `node.exe` precisa estar liberado no perfil da rede
   ativa (veja com `Get-NetConnectionProfile`). Para liberar as portas
   explicitamente, num PowerShell **como administrador**:

   ```powershell
   New-NetFirewallRule -DisplayName "Poker dev" -Direction Inbound `
     -Protocol TCP -LocalPort 3000,5173 -Action Allow -Profile Private
   ```

> Em modo dev o servidor aceita qualquer origem da rede local, o que é prático
> para testar mas significa que qualquer um na mesma rede alcança o jogo. Para
> produção, defina `CORS_ORIGIN` com os domínios exatos e `HOST=127.0.0.1` se o
> servidor ficar atrás de um proxy.

## Scripts

| Comando                        | O que faz                                        |
| ------------------------------ | ------------------------------------------------ |
| `npm run dev`                  | Server + client em modo watch                     |
| `npm run build`                | Compila os três pacotes                           |
| `npm run test`                 | Testes de mãos de poker e de CORS (Vitest)        |
| `npm run lint`                 | ESLint em todo o monorepo                         |
| `npm run smoke -w @poker/server` | Smoke test do socket (requer o server rodando)  |
| `npm run prisma:studio -w @poker/server` | Interface visual do banco               |

Para conferir que o jogo responde de verdade pela rede, rode o smoke test
apontando para o IP em vez de localhost:

```bash
SMOKE_API=http://192.168.0.190:3000 npm run smoke -w @poker/server
```

## Estado atual

Já funciona:

- Registro e login com JWT, senhas com hash bcrypt
- Conexão Socket.IO autenticada (handshake rejeita token inválido/ausente)
- Lobby com mesas, contagem de jogadores em tempo real
- Entrar/sair de mesa, assentos sincronizados entre todos os clientes
- Liberação do assento quando o jogador desconecta
- Avaliador de mãos de Texas Hold'em completo (melhor mão de 5 entre 7, com
  desempate por kickers), coberto por 24 testes

Próxima fase — a máquina de estados do jogo:

- Rodadas de aposta (pre-flop, flop, turn, river), blinds e dealer button
- Ações do jogador (fold, check, call, raise, all-in) com validação no servidor
- Distribuição de cartas, side pots e showdown
- Renderização de cartas, fichas e controles de aposta na `TableScene`
- Persistência de mãos e saldo de fichas

## Nota de design

As cartas e ações **nunca** devem ser decididas no cliente — o servidor é a
autoridade sobre o baralho e sobre o que cada jogador pode ver. As hole cards de
um jogador são enviadas só para ele, e o `TableState` compartilhado nunca carrega
informação oculta. Essa regra precisa ser respeitada em todas as fases seguintes.

Para o empacotamento futuro em mobile/desktop, o cliente deve continuar sem
depender de APIs exclusivas de navegador além do canvas e de um overlay DOM
simples — Capacitor e Electron apenas empacotam o `dist/` gerado pelo Vite.

O jogo não tem resolução de projeto fixa. O Phaser roda em `Scale.RESIZE`, ou
seja, o canvas tem o tamanho real da área visível, e cada cena se desenha a
partir das medidas de `client/src/ui/layout.ts` (largura, altura, orientação,
recortes de notch e um multiplicador de fontes). Toda cena nova deve seguir o
mesmo padrão — calcular posições a partir dessas medidas e se redesenhar no
evento `resize` — para continuar legível em pé e deitado. Coordenadas fixas
voltam a quebrar no celular. As telas com campos de texto (login) ficam no
overlay DOM, com o layout no CSS do `index.html`.
