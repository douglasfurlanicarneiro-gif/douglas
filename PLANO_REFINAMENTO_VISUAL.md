# Refinamento visual por tópicos

Preservar a paleta atual, o formato compacto dos cards e as regras de negócio.

1. Concluído em código: base tipográfica dos botões compartilhados e ações do checkout. Token único, sem redução automática da fonte nesses botões; ação de voltar e pagar na mesma escala; título de pagamento seguro consistente. TypeScript, verificação tipográfica, build web e 16 testes de checkout aprovados (393px e 1440px, Chromium). Não representa revisão completa de todas as telas nem teste em iPhone físico.
2. Concluído: observações recolhíveis (texto preservado), cupom aplicado sem repetir campo/botão Aplicar e remoção que permite inserir outro código. No computador, detalhes ficam à esquerda e resumo, prazos e privacidade à direita; no celular, o fluxo permanece em uma coluna. O bloco de pagamento seguro foi reduzido no desktop. TypeScript, tipografia, build e testes de checkout aprovados nas duas larguras, incluindo geometria, remover/reaplicar cupom e enviar observações recolhidas.
3. Pendente: revisão textual de entrega, prazo sob encomenda e conclusão; distinguir pedido recebido de pagamento confirmado.
4. Pendente: refinamento da vitrine, filtros, fotos e posição do atendimento flutuante, sem redesenhar os cards.
5. Pendente: transições, feedback de ações, teclado e acessibilidade; preservar o brilho inicial.

Cada etapa deve terminar com testes de celular/computador e registro do que foi realmente validado. Nenhuma alteração de regra de pagamento, estoque ou frete está incluída neste plano visual.
