# Assets

Duas origens, com regras diferentes de versionamento.

## `ui/` — versionado

Assets do **[Kenney UI Pack 2.0](https://kenney.nl/assets/ui-pack)**, licença **CC0**
(domínio público): livres para uso comercial, sem exigência de atribuição, e a
redistribuição é permitida — inclusive dentro deste repositório.

Como são poucos KB, ficam versionados. Um clone novo abre com a arte no lugar, sem
passo de preparação.

Em uso hoje:

| Arquivo | Origem no pacote |
| --- | --- |
| `button-gold.png` | `PNG/Yellow/Default/button_rectangle_depth_gradient.png` |

Para acrescentar outro, copie do pacote e commite junto — não há motivo para deixar
fora. O pacote também tem checkboxes (o "pronto" da mesa), sliders (o valor do raise),
setas e ícones.

**Só os controles vêm de sprite.** Painel, campos de texto, fundo de feltro e o título
são CSS, no `index.html`: degradê descreve tecido e metal melhor que um PNG esticado —
e o pacote não traz painel nem campo de texto de qualquer forma.

## `audio/` — **não** versionado

As trilhas vêm de pacotes da Unity Asset Store, licenciados para uso em projetos e não
para redistribuição. Os originais passam de 600 MB e git guarda cada versão para
sempre, então ficam locais e são montados por máquina.

**Num clone novo esta pasta vem vazia e o jogo roda sem som.** É esperado.

Origem na máquina de desenvolvimento:

```
E:\Unity\emptyProjectForAssets\New Unity Project\Assets\
  25 Rpg Game Tracks\      (29 faixas, só .wav, 625 MB)
  Medieval Music Pack\     (8 faixas, .wav e .mp3, 335 MB)
```

**Converta antes de copiar.** Há `.wav` de até 39 MB, que no celular trava o
carregamento. Para música de fundo, 96-128 kbps resolve e leva cada faixa para 1-3 MB:

```bash
ffmpeg -i "Ambient 3.wav" -c:a libvorbis -b:a 112k ambient-3.ogg
ffmpeg -i "Ambient 3.wav" -c:a libmp3lame -b:a 128k ambient-3.mp3
```

O `.ogg` cobre Chrome, Firefox e Android; o `.mp3` é o fallback do Safari. Vale gerar
os dois para cada faixa.

Nomes com espaço e maiúsculas (`Night Ambient 2 (Loop).wav`) viram URL no navegador —
renomeie para minúsculas com hífen ao converter.

## Créditos

CC0 não exige atribuição, e a licença da Unity Asset Store não permite redistribuir —
mas creditar quem fez é boa prática, e a lista precisa existir antes do lançamento.

- Kenney — UI Pack 2.0 (interface), CC0
- 25 RPG Game Tracks (música)
- Medieval Music Pack (música)
