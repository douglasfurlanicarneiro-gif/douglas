# Refinamento visual por tópicos

Preservar a paleta atual, o formato compacto dos cards e as regras de negócio.

1. Concluído: tipografia semântica unificada na vitrine, detalhes, descoberta, pedidos, checkout e conclusão. Títulos, corpo, legendas, rótulos e botões usam a escala central; somente a marca mantém a fonte editorial. A redução automática de letras foi removida e bloqueada pela verificação de qualidade. Preserva a composição compacta dos cards. TypeScript, build web e 54 testes funcionais aprovados em 393px e 1440px no Chromium. Não representa teste em iPhone físico.
2. Concluído: observações recolhíveis (texto preservado), cupom aplicado sem repetir campo/botão Aplicar e remoção que permite inserir outro código. No computador, detalhes ficam à esquerda e resumo, prazos e privacidade à direita; no celular, o fluxo permanece em uma coluna. O bloco de pagamento seguro foi reduzido no desktop. TypeScript, tipografia, build e testes de checkout aprovados nas duas larguras, incluindo geometria, remover/reaplicar cupom e enviar observações recolhidas.
3. Concluído: textos de entrega, prazo sob encomenda e conclusão revisados. Pronta entrega (até 3 dias úteis para postagem) foi distinguida de Sob encomenda (até 14 dias de disponibilidade, preparação e maturação), sempre somando o prazo da transportadora após a postagem. Pagamento pendente, Pix manual, pagamento confirmado e pedido apenas registrado agora usam mensagens diferentes e ações diretas. TypeScript, lint, build web e 18 testes do fluxo aprovados em 393px e 1440px no Chromium.
4. Pendente: refinamento da vitrine, filtros, fotos e posição do atendimento flutuante, sem redesenhar os cards.
5. Pendente: transições, feedback de ações, teclado e acessibilidade; preservar o brilho inicial.

Cada etapa deve terminar com testes de celular/computador e registro do que foi realmente validado. Nenhuma alteração de regra de pagamento, estoque ou frete está incluída neste plano visual.
