# subagent-advisor

Mod para o Claude Code que avisa quando uma tarefa fica melhor com subagentes e compara tokens, dólares e tempo com e sem eles.

Created by LUKADSGR.

## O que faz

No início de uma tarefa que já se divide em duas ou mais etapas capazes de rodar ao mesmo tempo, o Claude informa ao mod quantas etapas ela tem, quantas podem rodar ao mesmo tempo, quanto precisa ler e se é arriscada. O mod calcula as duas opções e mostra uma faixa acima do campo de mensagem:

| Cor | Veredito | Quando |
| --- | --- | --- |
| Verde | Subagentes recomendados | Ganha bastante tempo sem custar muito mais, ou a leitura é pesada |
| Amarelo | Subagentes: você decide | Paga mais para terminar antes, ou a tarefa é arriscada e ganha uma revisão independente |
| Vermelho | Subagentes não recomendados | Dividir custaria mais sem ganho que compense |

A faixa só aparece quando há duas ou mais etapas que podem rodar ao mesmo tempo. Tarefas sequenciais e de uma etapa não mostram nada, e nelas o Claude nem chama o mod, para não gastar um turno à toa. No verde e no amarelo, o Claude espera sua escolha antes de começar: aperte **Sem subagentes** ou **Com subagentes** na faixa e o trabalho segue sozinho, sem precisar digitar. Responder por mensagem também vale. Quando você começa outra tarefa, a faixa da anterior some.

## Instalar

No prompt de uma sessão de terminal:

```
/plugin install subagent-advisor --marketplace lukadsgr/subagent-advisor
```

Em um shell:

```bash
claude plugin install subagent-advisor --marketplace lukadsgr/subagent-advisor
```

No app desktop, onde `/plugin` não roda: clique em + ao lado do campo de mensagem, depois em Plugins, Add marketplace com `lukadsgr/subagent-advisor` e Add plugin.

Para usar subagentes quando a faixa recomendar, o mod sugere o `/savvy-flow:savvy-flow`, do [claude-kit](https://github.com/johnnyvizz/claude-kit), quando ele está instalado. Ele não é obrigatório: sem ele, o Claude oferece dividir a tarefa com os próprios subagentes.

## Sobre os números

São estimativas, não medições nem cobrança.

- Cada número é uma faixa: do caso típico até 3 vezes ele, a distância medida entre a mediana e o percentil 90 de tarefas reais.
- O tamanho da etapa pesa mais que tudo. `small` e `medium` vêm de 215 tarefas reais sem subagentes; `large` vem de apenas 3 subagentes de uma sessão, então é o dado mais fraco. Os valores ficam em `hooks/estimate.ts`.
- Os dólares usam preços de tabela de 10/10/2026. Em uma assinatura, leia como custo equivalente.
- Tokens somam tudo, inclusive releituras em cache, como no painel Agents.
- O veredito é decidido pelo custo em dólares, porque releituras em cache custam pouco.
- A linha "Real" mostra o gasto medido da tarefa, incluindo a sessão principal. Por isso pode passar do custo do painel Agents, que soma só os subagentes.

## Licença

MIT
