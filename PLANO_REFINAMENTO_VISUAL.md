# Refinamento visual por tópicos

Preservar a paleta atual, o formato compacto dos cards e as regras de negócio.

## Tópico 6 — reconexão (19/09/2026)

- A vitrine visível agora consulta o catálogo ao receber o evento online; em segundo plano, a atualização continua ocorrendo ao retornar à tela.
- Teste automatizado alterna offline/online, recebe nome atualizado e verifica manutenção do produto, volume e quantidade do carrinho salvo. Aprovado em Chromium e WebKit, nos perfis celular e computador; não substitui iPhone físico.
- Build, TypeScript e lint aprovados. Ainda pendentes: medição detalhada de carregamento inicial/cache e avaliação de imagens/rolagem. Esta entrega não encerra o tópico 6.

## Fechamento de implementação — 19/09/2026

O tópico 5 está encerrado como entrega técnica com ressalvas de homologação, substituindo o estado intermediário abaixo. Não significa acessibilidade integral certificada: Safari/iPhone físico (teclado e VoiceOver), TalkBack e auditoria de todos os estados permanecem no checklist externo. É possível avançar ao tópico 6 sem apagar essas pendências.

- Foco, Escape, campos, erros, proteção de envio, identificação de janelas e movimento reduzido revisados; brilho preservado.
- Coração de favoritos e estrelas usam tom escuro da paleta. Estrelas interativas possuem alvos de 44px e estado aria-pressed verificável.
- Alerta de título sobreposto: inspeção por captura antes/depois da rolagem confirmou título legível dentro do card, parcialmente encoberto apenas na borda da navegação fixa. Não houve redesenho do card.
- Axe na amostra de vitrine/pedidos não confirmou violações, mas não avalia conclusivamente os ícones de fonte; essa limitação não é apresentada como aprovação integral.

## Tópico 6 — performance e estabilidade

### Primeira otimização atribuída por perfil de CPU — 19/09/2026

- `AUDIT_PROFILE=1` adiciona amostragem de CPU à ferramenta, separando abertura e rolagem. A amostragem altera os tempos; não comparar diretamente com rodadas sem profiler.
- No bundle publicado, a função `O` da linha 838 é exportada como `brl` (confirmado no módulo). Na amostra móvel, representou 75/104 ms de CPU amostrada durante rolagem sem/com cache. Outros custos incluem runtime, React e criação de elementos; não foram atribuídos integralmente.
- Substituída criação implícita repetida de formatadores via `toLocaleString` por um `Intl.NumberFormat` compartilhado. Não altera cálculo, arredondamento configurado, moeda ou valores de pedidos.
- Microbenchmark Node local de 10.000 preços: 431 ms antes, 6 ms depois. É ganho isolado da função, NÃO ganho de 70x do aplicativo nem medição final de rolagem.
- Teste da função real do tema compara resultados anteriores para zero, centavos, desconto negativo, valores grandes e casos numéricos especiais. Integrado ao prebuild para CI.
- Validação: build, TypeScript, lint e orçamento de bundle aprovados; 42 testes Chromium e 4 WebKit de frete/cupom aprovados. Brilho e layout preservados.
- Falta medir novamente o fluxo completo com esta versão; tópico 6 permanece aberto.

### Medição reproduzível — 19/09/2026

Comando: `cd frontend` e `node scripts/measure-storefront.mjs`. Consulta somente a vitrine pública; não cria pedidos nem altera cadastro. Chromium headless na máquina de desenvolvimento, sem limitação artificial de rede/CPU. Duas passagens por largura (393/1440), cache de navegador vazio e recarga no mesmo contexto. Servidor frio não foi controlado nem comprovado; não confundir navegador novo com Render acordando.

- Primeira rodada: catálogo visível em 5389 ms (393px) e 1181 ms (1440px); recargas 159/200 ms. A primeira resposta HTML levou 3024 ms; não atribuímos isso automaticamente a suspensão do servidor.
- Segunda rodada: catálogo visível em 1098/1208 ms; recargas 167/257 ms. Não são LCP, média estatística, tempo de conclusão da atualização da API ou desempenho de iPhone físico.
- Transferência de recursos da mesma origem: 712624/895737 bytes na primeira visita e 3600 bytes na recarga. Não inclui todos os recursos externos nem equivale ao tamanho descomprimido dos bundles.
- Imagens solicitadas inicialmente: 9/21. Cards no DOM: 8/18 inicialmente, 18/28 após seis movimentos de rolagem na segunda rodada. A lista é virtualizada; não carrega o catálogo inteiro de uma vez.
- Segunda rodada: 1/2 tarefas longas iniciais, máximo 70/65 ms; nenhuma tarefa longa adicional durante a rolagem amostrada, nem overflow horizontal. Não é certificação de FPS ou ausência de travamentos em aparelhos reais.
- Oito verificações novas aprovadas (Chromium/WebKit, celular/computador): catálogo salvo com API indisponível e recuperação de cache inválido. Lint aprovado. Comprar offline não foi habilitado: a conclusão continua dependendo do servidor.
- Nenhuma mudança especulativa em imagens/virtualização foi aplicada. Ferramenta e testes adicionados; visual e regras preservados.

### Rede limitada e rolagem ampliada — 19/09/2026

- Reproduzir em PowerShell: `$env:AUDIT_STRESS='1'; node scripts/measure-storefront.mjs`. Chromium com download 1,6 Mbps, upload 750 kbps, latência configurada 150 ms e CPU 4x; 40 movimentos de 700px por visita. Limitação sintética, não equivale a modelo de telefone específico.
- Correção de metodologia: `catalogVisibleMs` mede o card renderizado, que ainda pode estar atrás do preloader. Novo `catalogUncoveredMs` aguarda também o preloader desaparecer. Os números anteriores de ~0,2s NÃO representam liberação da interface ao cliente.
- Rodada final: primeira visita com tela liberada em 5665 ms (393px) / 6392 ms (1440px); cache em 2313/2064 ms. Brilho preservado; nenhuma regra de negócio alterada.
- Tarefas longas: máximos iniciais 456/473 ms sem cache e 221/265 ms com cache. A rolagem acrescentou 5/2 tarefas longas nas primeiras visitas e 6/3 nas recargas. Não se pode concluir que a rolagem é perfeitamente fluida sob limitação de CPU.
- Cards no DOM após rolagem: 24/28 na primeira visita e 18/28 na recarga; sem overflow horizontal. Virtualização continua limitada nesta amostra. Não houve teste até o último produto nem medição de FPS.
- Lint e diff-check aprovados. Alterações desta etapa são ferramenta de medição/documentação, não uma otimização publicada do app.

Pendências para fechar o tópico: atribuir as tarefas longas e reduzir custo inicial onde comprovado, observar servidor comprovadamente frio e validar Safari/iPhone físico. Rede limitada e rolagem ampliada agora possuem baseline, não certificação de desempenho. A amostra não justifica nota 10/10 nem promessa de disponibilidade integral no Render gratuito.

1. Registrar baseline de tamanho dos bundles e carregamento, separando primeira visita de cache e servidor frio de aquecido.
2. Medir imagens, rolagem e renderização do catálogo; corrigir apenas gargalos demonstrados.
3. Conferir recuperação de rede, cache e atualização da vitrine sem perder carrinho.
4. Repetir testes antes de publicar, sem prometer ausência de suspensão do Render gratuito.

Baseline inicial local: 8 arquivos JavaScript, aproximadamente 1,80 MB no total e 1,40 MB no maior, dentro do orçamento existente. Não equivale a tempo real medido no celular.

## Histórico das entregas

1. Concluído: tipografia semântica unificada na vitrine, detalhes, descoberta, pedidos, checkout e conclusão. Títulos, corpo, legendas, rótulos e botões usam a escala central; somente a marca mantém a fonte editorial. A redução automática de letras foi removida e bloqueada pela verificação de qualidade. Preserva a composição compacta dos cards. TypeScript, build web e 54 testes funcionais aprovados em 393px e 1440px no Chromium. Não representa teste em iPhone físico.
2. Concluído: observações recolhíveis (texto preservado), cupom aplicado sem repetir campo/botão Aplicar e remoção que permite inserir outro código. No computador, detalhes ficam à esquerda e resumo, prazos e privacidade à direita; no celular, o fluxo permanece em uma coluna. O bloco de pagamento seguro foi reduzido no desktop. TypeScript, tipografia, build e testes de checkout aprovados nas duas larguras, incluindo geometria, remover/reaplicar cupom e enviar observações recolhidas.
3. Concluído: textos de entrega, prazo sob encomenda e conclusão revisados. Pronta entrega (até 3 dias úteis para postagem) foi distinguida de Sob encomenda (até 14 dias de disponibilidade, preparação e maturação), sempre somando o prazo da transportadora após a postagem. Pagamento pendente, Pix manual, pagamento confirmado e pedido apenas registrado agora usam mensagens diferentes e ações diretas. TypeScript, lint, build web e 18 testes do fluxo aprovados em 393px e 1440px no Chromium.
4. Concluído: formato compacto dos cards preservado; filtros exibem os nomes completos a partir de 360px e continuam dentro da tela, com rótulos adaptados abaixo disso; imagens usam centralização, cache e chave de reciclagem vinculada ao arquivo para evitar troca visual entre produtos; sombras foram suavizadas; o atendimento flutuante foi reduzido e a área das ações reserva espaço suficiente para não cobrir “Conhecer a fragrância”. TypeScript, lint, build web e testes em 320px, 393px e 1440px aprovados no Chromium.
5. Em andamento: transições, feedback de ações, teclado e acessibilidade; preservar o brilho inicial. Primeira entrega: foco limitado à janela superior, Escape sem fechar duas janelas, retorno do foco ao acionador, botão fechar com área mínima de 44px, preferência de movimento reduzido lida já na primeira renderização web, mensagens acessíveis do cupom e erro do pedido, indicação de processamento e bloqueio síncrono de reenvio. Brilho inicial e transições existentes preservados. Validado com TypeScript, lint, build e testes Chromium em 393px/1440px. Ainda pendentes: teclado virtual no Safari/iPhone físico, revisão completa de contraste e teste com leitor de tela; não equivale a certificação de acessibilidade.

Cada etapa deve terminar com testes de celular/computador e registro do que foi realmente validado. Nenhuma alteração de regra de pagamento, estoque ou frete está incluída neste plano visual.

## Revisão corretiva de 18/09/2026

### Acessibilidade — 19/09/2026

- Axe nas telas vitrine e pedidos, em 393px e 1440px: nenhuma violação confirmada nesta amostra, com verificações de contraste inconclusivas (ícones de fonte e um título parcialmente sobreposto na área visível do celular). Não equivale a auditoria de todos os fluxos nem conformidade integral.
- O nome da janela estava no contêiner genérico interno; movido para o Modal. A verificação ARIA inconclusiva desapareceu na repetição local, com respostas públicas GET reapresentadas e sem alterar CORS/CSP no servidor.
- TypeScript/build e quatro testes de foco/recuperação aprovados. Evidência local em output/accessibility/axe-20260919-local.json. Ainda faltam inspeção visual dos ícones e da sobreposição, demais estados, VoiceOver e teclado no aparelho físico.

- WebKit: primeira rodada teve 32/34 aprovações; dois casos perderam preenchimento antes da entrega e passaram isoladamente. Atualizações do formulário passaram a usar o estado atual, e o foco automático deixa de interromper interação já iniciada. Após ajustes, bateria completa WebKit passou 34/34 em perfil iPhone 15 e desktop. Não prova causa única nem substitui Safari/VoiceOver em aparelho real. Configuração reproduzível: frontend/playwright.webkit-check.config.ts (requer playwright install webkit).

- Estados de pedidos: falha parcial/total de consulta deixa de mostrar falsa ausência de compras; aviso acessível e tentativa manual mantêm códigos salvos. Consultas antigas são ignoradas após fechar/trocar códigos. Recuperação distingue 404 de indisponibilidade; erros de recuperação e cancelamento são anunciáveis. Teste de falha/repetição preservando códigos adicionado em ambas as larguras. Não altera pagamento, estoque nem cancelamento no servidor.

- Detalhes, descoberta e pedidos: rótulos e links dourados usam goldText; disponibilidade usa sageText/goldText; texto de status do pedido usa bone, preservando a borda colorida. Recuperação de pedidos tem área mínima de 44px e nome acessível para o código. Teste de recuperação em celular/computador adicionado. Restam validação física no iPhone/VoiceOver e auditoria abrangente de todos os estados, sem declarar conformidade integral.

- Continuação do tópico 5: textos dourados do checkout e valor de retirada gratuita usam as variantes escuras da paleta; cor de erro escurecida; campo de cupom nomeado para tecnologia assistiva; inputs web de toque com 16px para reduzir zoom automático ao focar no iOS. Testes automatizados não substituem teclado virtual/VoiceOver em iPhone físico. A revisão global de contraste continua pendente; esta entrega cobre o checkout.

- Substitui as conclusões anteriores dos tópicos 3 e 4: a promessa antiga de postagem em três dias foi retirada por não ter confirmação operacional; o prazo de 14 dias sob encomenda permanece.
- Filtros passam a duas linhas em telas estreitas, mantendo os nomes completos. Atendimento passa para Ajuda na navegação inferior e não exige comprimir as ações dos cards. Banner de descoberta cresce quando o texto quebra.
- Confirmação usa apenas um título de status. Pedido confirmado não exibe cobrança, QR Pix ou redirecionamento automático mesmo com status do provedor desatualizado; ofertas de pagamento exigem pedido pendente.
- 22 testes do fluxo aprovados e capturas inspecionadas em 320px, 393px e 1440px no Chromium. Isso não equivale a teste físico no Safari/iPhone.
