# Desmanche

Painel para dividir o lucro dos desmanches em grupo no FiveM. A cada carro desmanchado, um toque lança o valor e o app divide entre quem está presente naquele momento.

**Acesse:** https://furyz1k.github.io/app-desmanche/

## O que ele faz

- **Divisão automática:** cada lançamento é dividido só entre os membros presentes. Quem sai deixa de receber a partir dali, e quem volta passa a receber de novo.
- **Botões rápidos:** 1 carro, 3 carros ou o valor que você quiser, com desfazer a qualquer momento.
- **Caixa da facção:** separa uma porcentagem de cada lançamento antes de dividir.
- **Ritmo:** quanto o grupo está rendendo por hora, sem contar as pausas.
- **Histórico:** entradas, saídas e pausas, com busca por nome ou horário.
- **Compartilhar:** relatório com o total de cada um ou a sessão completa.

## Como usar

1. Adicione os membros pelo campo **Nome do membro**.
2. Toque no membro para marcar se ele está **presente** ou **fora**.
3. A cada carro desmanchado, toque em **1 carro** ou **3 carros**. Para outro valor, use **Outro valor**.
4. Errou? Toque em **Desfazer**.
5. No fim, use **Copiar resumo** para colar no Discord.

O valor por carro, a porcentagem do caixa, os botões rápidos, a moeda e a pausa automática ficam nas **Configurações** (ícone de engrenagem).

### Atalhos de teclado

| Tecla | Ação |
| --- | --- |
| `1`, `2`, … | Lança o botão rápido correspondente |
| `P` | Pausa ou retoma o cronômetro do ritmo |
| `Ctrl` + `Z` | Desfaz a última ação |

Os atalhos `1`, `2`, … e `P` podem ser desligados nas Configurações.

## Compartilhar

No card **Divisão**, o botão de compartilhar gera dois tipos de link:

- **Relatório:** só o total de cada membro, para conferir o pagamento.
- **Sessão completa:** o painel inteiro, só para consulta. Quem abrir pode tocar em **Continuar daqui** para seguir a sessão no próprio aparelho, como uma cópia independente.

Os links levam uma cópia do momento em que foram gerados. Nada fica ligado ao painel de quem enviou.

## Onde ficam os dados

Tudo fica salvo **no navegador de cada pessoa**. Nada é enviado para servidor nenhum.

- Para trocar de aparelho ou guardar uma cópia, use **Configurações → Backup → Exportar** e depois **Importar** no outro aparelho.
- Limpar os dados do navegador apaga o painel. Exporte um backup antes.
- Com o painel aberto em mais de uma aba, as abas ficam sincronizadas.

## Instalar no celular

Abra o site e escolha **Adicionar à tela de início**: no iPhone, pelo botão de compartilhar do Safari; no Android, pelo menu do Chrome. O painel passa a abrir em tela cheia, como um app.

## Desenvolvimento

Requer **Node 24** e **pnpm 12**.

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build    # gera o site estático em out/
```

Feito com Next.js (exportação estática), React, Tailwind CSS e Base UI.

| Pasta | Conteúdo |
| --- | --- |
| `app/` | Página, estilos globais, manifesto e ícones |
| `components/ui/` | Botão, campo de texto, diálogos e avisos |
| `lib/` | Cálculo da divisão e do ritmo, links de compartilhamento, armazenamento e preferências |

## Deploy

Cada push na branch `main` gera e publica o site no GitHub Pages, pelo workflow em `.github/workflows/deploy.yml`.

Em um repositório novo, ative uma vez: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
