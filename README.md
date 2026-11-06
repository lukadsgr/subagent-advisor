# subagent-advisor

Mod para o Claude Code que avisa quando uma tarefa fica melhor com subagentes e compara tokens, dólares e tempo com e sem eles.

Created by LZKDSGR.

## O que faz

No início de uma tarefa, o Claude informa ao mod quantas etapas ela tem, quantas podem rodar ao mesmo tempo, quanto precisa ler e se é arriscada. O mod calcula as duas opções e mostra uma faixa acima do campo de mensagem:

| Cor | Veredito | Quando |
| --- | --- | --- |
| Verde | Subagentes recomendados | Ganha bastante tempo sem custar muito mais, ou a leitura é pesada |
| Amarelo | Subagentes: você decide | Paga mais para terminar antes, ou a tarefa é arriscada e ganha uma revisão independente |
| Vermelho | Subagentes não recomendados | Dividir custaria mais sem ganho que compense |

A faixa só aparece quando há duas ou mais etapas que podem rodar ao mesmo tempo. Tarefas sequenciais e de uma etapa não mostram nada. No verde e no amarelo, o Claude pergunta como você quer seguir antes de começar.

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

Para usar subagentes quando a faixa recomendar, o mod sugere o `/savvy-flow:savvy-flow`, do [claude-kit](https://github.com/johnnyvizz/claude-kit). Ele não é obrigatório: o mod funciona sem ele.

## Sobre os números

São estimativas, não medições nem cobrança.

- As constantes (como 20 segundos por turno e 4 turnos por etapa) são suposições, e podem ser ajustadas em `hooks/estimate.ts`.
- Os dólares usam preços de tabela de 10/10/2026. Em uma assinatura, leia como custo equivalente.
- Tokens somam entrada nova, saída e 10% das releituras em cache.
- O veredito é decidido pelo custo em dólares, porque releituras em cache custam pouco.
- A linha "Real até agora" mostra o gasto medido da tarefa, para comparar com a estimativa.

## Licença

MIT
