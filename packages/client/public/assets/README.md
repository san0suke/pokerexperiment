# Assets

**O conteúdo desta pasta não é versionado.** Só este README vai para o git.

São ~900 MB de arquivos, e git guarda cada versão para sempre: uma faixa reconvertida
deixa as duas no histórico, o clone passa a arrastar tudo, e limpar depois exige
reescrever o histórico. Por isso os assets ficam locais e são montados por máquina.

Em segundo plano, a licença também pesa — são pacotes da Unity Asset Store, licenciados
para uso em projetos e não para redistribuição.

Consequência prática: **num clone novo esta pasta vem vazia e o jogo carrega sem arte
nem som.** Não é bug; é preciso montá-la seguindo o passo a passo abaixo.

## Estrutura

```
assets/
  ui/      PNGs de interface (botões, molduras, popups, ícones)
  audio/   Faixas de música já convertidas para web (.ogg + .mp3)
```

Só entra aqui o que já está pronto para servir. O Vite copia esta pasta inteira para o
`dist/`, então um `.wav` de 39 MB esquecido aqui vai parar no build e no navegador do
jogador.

## De onde vem

Origem na máquina de desenvolvimento:

```
E:\Unity\emptyProjectForAssets\New Unity Project\Assets
```

### `ui/` — Layer Lab GUI Pro-FantasyRPG

```
Layer Lab\GUI Pro-FantasyRPG\ResourcesData\Sprites\Component\
```

Copie só os PNGs das categorias em uso (`Button`, `Frame`, `Popup`, `Slider`,
`Label-Title`, ícones). São 4528 arquivos no pacote inteiro — copiar tudo infla o
`dist/` sem motivo.

Ignore `Prefabs/`, `Scene/`, `Extensions/`, `.mat` e `.meta`: são formato Unity e não
têm uso no Phaser.

### `audio/` — as duas trilhas

```
25 Rpg Game Tracks\        (29 faixas, só .wav, 625 MB)
Medieval Music Pack\       (8 faixas, .wav e .mp3, 335 MB)
```

**Converta antes de copiar.** Os originais são grandes demais para web — há `.wav` de
até 39 MB, que no celular trava o carregamento. Para música de fundo, 96-128 kbps
resolve e leva cada faixa para 1-3 MB:

```bash
ffmpeg -i "Ambient 3.wav" -c:a libvorbis -b:a 112k ambient-3.ogg
ffmpeg -i "Ambient 3.wav" -c:a libmp3lame -b:a 128k ambient-3.mp3
```

O `.ogg` cobre Chrome, Firefox e Android; o `.mp3` é o fallback do Safari. Vale gerar
os dois para cada faixa.

Nomes com espaço e maiúsculas (`Night Ambient 2 (Loop).wav`) viram URL no navegador —
renomeie para minúsculas com hífen ao converter.

## Créditos

Os pacotes usados precisam ser creditados no jogo. Manter a lista aqui conforme forem
entrando, para não descobrir na véspera do lançamento quem precisa aparecer.

- Layer Lab — GUI Pro-FantasyRPG (interface)
- 25 RPG Game Tracks (música)
- Medieval Music Pack (música)

As fontes do pacote de UI (Alata, Josefin Sans, Play) são do Google Fonts e têm licença
própria — baixe do Google Fonts, não do pacote.
