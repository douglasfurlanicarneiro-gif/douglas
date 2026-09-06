# Auditoria técnica e operacional — meta 10/10

Último ponto de retomada: **06/09/2026**. O relatório integral de 13/08/2026 permanece abaixo como histórico; suas notas e contagens não representam uma nova homologação.

## Retomada de 06/09/2026 — tópico 6: retorno da restauração

- Falha do registro de auditoria após a restauração retorna sucesso com `auditoriaRegistrada: false` e aviso explícito para não repetir a operação. O erro é registrado no servidor sem ser apresentado como falha da transação.
- Painel exibe o aviso recebido; erro rejeitado na atualização da tela após sucesso também não se torna erro de restauração. Campos adicionais são opcionais para manter compatibilidade.
- 193 testes backend aprovados, 40 ignorados. Testes novos distinguem sucesso integral, falha de auditoria e falha da restauração e conferem limpeza dos temporários. Teste de interface verifica aviso e ausência do botão de repetir após sucesso, em celular e computador.
- Sem restauração ou cobrança real. Continuam pendentes ensaio MongoDB isolado (incluindo resultado de commit incerto/interrupção de rede), consistência da exportação concorrente e operação de cópias externas. A auditoria completa não está encerrada.

## Retomada de 05/09/2026 — tópico 5: backup, etapa isolada

- Corrigida a limpeza do ZIP temporário quando a autenticação AES-GCM rejeita o arquivo por adulteração ou chave incorreta. Antes, esse caminho podia deixar conteúdo descriptografado no disco temporário.
- Limite descompactado conferido antes de ler o manifesto; manifesto possui limite próprio e deve ser objeto JSON. Leitura de registros limitada antes de materializar uma linha excessiva.
- Ensaio com dados exclusivamente fictícios: exportação criptografada, validação e restauração das 19 coleções, preservando ObjectIds, datas, centavos, listas e Unicode; limpeza dos temporários confirmada. Banco simulado, sem acesso à produção.
- Backend: **190 testes aprovados, 40 ignorados**. Nove novos casos, incluindo chave errada, adulteração, manifesto inválido, limites e ciclo completo.
- **Ainda não homologado em MongoDB real:** não há `mongod` nem Docker disponíveis nesta máquina. Falta ensaio em réplica isolada para validar transação, rollback por falha e índices, além de conferir estratégia consistente de exportação durante escritas concorrentes. Não restaurar produção como teste.
- Operação pendente: cópia real criptografada guardada fora do Render, guarda separada da chave, definição de RPO/RTO e exercício periódico documentado. O backup guarda URLs de imagens; não inclui todos os arquivos externos.
- Revisão adicional: diferenciar falha de auditoria após commit de falha da própria restauração, evitando orientar repetição indevida. Este bloco não altera o fluxo transacional nem afirma recuperação completa de desastre.

## Retomada de 05/09/2026 — tópico 4: proteção do valor online

- Inspeção autenticada, sem salvar alterações em pedidos reais: endereço completo e modalidade prioritária presentes no pedido entregue da amostra; retirada e aceite de prazo presentes em pedido pendente. Amostra não equivale à homologação de todos os pedidos.
- Bloqueada a alteração do total de pedidos vinculados à InfinitePay, no formulário e na API (HTTP 409 antes de qualquer gravação). Editar o total local não altera o checkout externo. Observações e endereço continuam editáveis; pedidos manuais preservam negociação de valor.
- Divergência entre o valor registrado na cobrança e o total do pedido gera aviso. Nenhum valor histórico foi corrigido automaticamente e nenhuma cobrança foi realizada como teste.
- Validação local: 181 testes de backend aprovados, 40 ignorados; 44 verificações Playwright aprovadas e três testes Node de URLs. TypeScript, lint/tipografia, build e orçamento aprovados.
- Render autenticado: proteção publicada em `ac1d0b7` nos dois serviços, ambos Live; readiness do banco e esquema OK. CI `33991496083` concluído com sucesso. Antes desse bloco o backend estava em `7bdd031`, sem diferenças de backend até `798fd14`.
- Continuam pendentes: conferir cobrança/retomada com o provedor sem gerar pagamento indevido; exercício de backup/restauração isolado; demais itens operacionais e de acessibilidade do histórico.

## Retomada de 05/09/2026 — tópico 3: correção dos alertas de URL

- Corrigida a cadeia de três alertas moderados: `decode-uri-component` atualizado de `0.2.2` para a versão oficial `0.5.0`, indicada em [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr). O Expo Router não foi rebaixado e nenhum alerta foi ignorado.
- `query-string@7.1.3` espera uma função CommonJS; a versão corrigida do decoder exporta uma função ESM. O script versionado `frontend/scripts/patch-query-string.cjs` adapta somente essa importação e preserva o tratamento legado de `+`, inclusive em fragmentos. O código do decoder oficial permanece intacto.
- A adaptação é reaplicada por `postinstall`, é idempotente e recusa versões/conteúdo inesperados. O build verifica sua presença e executa testes de URL. Instalações que desativem scripts precisam executar a adaptação explicitamente antes de gerar o aplicativo.
- **Instalação limpa `npm ci` aprovada; npm audit: zero vulnerabilidades conhecidas** no frontend no momento desta consulta. Isso não é garantia de ausência de falhas no aplicativo ou serviços externos.
- **45 verificações locais aprovadas**: 42 na suíte Playwright (32 E2E com APIs simuladas + 10 verificações de funções/ativos) e três testes de decodificação em Node. Cobertura adicional de Unicode, espaços, sinais de mais codificados, parâmetros repetidos, identificadores de retorno do pagamento, fragmentos e UTF-8 malformado; a carga adversarial roda somente em processo local isolado com timeout de cinco segundos.
- TypeScript, lint/tipografia, Expo Doctor **20/20**, build web e orçamento aprovados. JavaScript: 1.778.883 bytes no total; maior arquivo: 1.399.592 bytes.
- O CI agora rejeita também vulnerabilidades moderadas. A instalação do Playwright passou a baixar somente o Chromium headless utilizado pelos testes, com limite explícito de oito minutos para essa etapa.
- A execução anterior [33937332100](https://github.com/douglasfurlanicarneiro-gif/douglas/actions/runs/33937332100) terminou **cancelada** durante a instalação do navegador. Backend aprovado; testes E2E remotos não executados. A publicação anterior do catálogo foi confirmada no Render e verificada ao vivo, mas não devemos registrar aquela execução do frontend como aprovada.

### Ponto de retomada após este bloco

Homologar pagamentos/retomada, frete e endereços no painel real com acesso autorizado; depois, exercício de backup/restauração em ambiente isolado. Permanecem os demais itens do histórico (acessibilidade em aparelhos reais, monitoramento e operação). Não realizar cobranças, postagens ou restauração de produção como teste sem autorização específica.

Manutenção futura: retirar a ponte quando o roteador adotar dependências compatíveis corrigidas. Qualquer atualização de `query-string` ou do decoder exige revisão da ponte e nova execução dos testes. A auditoria integral ainda não está encerrada.

## Retomada de 04/09/2026 — tópico 1: dependências

Atualização compatível implementada e validada:

- Expo `57.0.20`, Expo Router `57.0.19` e React Native `0.86.3`; as 13 dependências apontadas pelo Expo foram alinhadas ao SDK 57.
- As duas versões transitivas de `@xmldom/xmldom` foram atualizadas para `0.8.15` e `0.9.12`, corrigindo o alerta [GHSA-6gmq-8vp8-gcm6](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6).
- O instalador do Expo registrou o plugin de `expo-secure-store`, já utilizado pelo aplicativo nativo.
- Instalação limpa com `npm ci`, Expo Doctor **20/20**, lint/tipografia, TypeScript, build web e orçamento do bundle aprovados.
- **28 testes E2E aprovados**, com APIs simuladas, nos projetos celular e computador. Esses testes não comprovam transações financeiras ou postagens reais.
- JavaScript total: **1.708.002 bytes**; maior arquivo: **1.328.978 bytes**, dentro dos limites existentes. O hash do script inline continua autorizado pela CSP do Render.
- Auditoria npm completa: **3 alertas moderados**, nenhum alto ou crítico. O bloqueio de vulnerabilidades altas/críticas no CI permanece ativo.

### Pendência registrada em 04/09 — resolvida no tópico 3 acima

Os três alertas restantes vêm de uma única cadeia: `expo-router → query-string@7.1.3 → decode-uri-component@0.2.2`, afetada por [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr). Uma entrada de URL malformada pode causar consumo excessivo de CPU.

O Expo Router atual utiliza a interface CommonJS de `query-string`. A correção publicada de `decode-uri-component` é `0.5.0`, em ESM, e não é uma substituição direta do `require()` usado pela versão instalada. O `npm audit fix --force` propõe voltar para Expo Router `5.1.11`, incompatível com esta base. Nenhum desses atalhos foi aplicado e os alertas não foram ocultados.

Próxima ação para essa cadeia: avaliar uma atualização compatível do roteador/dependência ou preparar uma correção de compatibilidade explícita, acompanhada de testes de parâmetros de URL, retorno do pagamento e entradas malformadas. A atualização do SDK está concluída; a eliminação total dos alertas ainda está pendente.

## Retomada de 04/09/2026 — tópico 2: catálogo e fotos

Bloco implementado, com validação local concluída:

- **413 perfumes publicados conferidos**, sem nomes duplicados e sem URLs inacessíveis na consulta. Nenhum preço, custo, estoque, nome ou número de perfume foi alterado neste bloco.
- **413 referências de imagem em AVIF com transparência**, servidas pelo próprio site: 410 arquivos únicos, 6.847.085 bytes no total. Reutilizamos imagens já preparadas e cópias byte a byte de imagens transparentes existentes; não houve geração de frascos artificiais. Oito referências sem recorte adequado foram conferidas visualmente e substituídas por fotos da mesma fragrância.
- O mapa de imagens agora exige correspondência de **ID do perfume + URL original**. A numeração deixou de determinar silenciosamente a foto. Uma nova URL escolhida no painel tem prioridade, seja JPG, WebP ou AVIF.
- A mesma resolução de imagem é aplicada ao catálogo administrativo e à vitrine, incluindo a edição do produto. Os nomes dos arquivos contêm hash do conteúdo para evitar reutilizar uma foto antiga do cache; política de cache imutável declarada no Render.
- O banco **não recebeu migração em massa**. As URLs originais continuam na API bruta; a aplicação resolve as imagens pelo mapa compartilhado. Ao salvar um produto no editor, a URL exibida pode ser persistida pelo fluxo normal. Produtos novos ou fotos modificadas depois deste levantamento precisam de nova conferência; não são convertidos automaticamente.
- A conferência pública não abrange produtos não publicados/arquivados. Não foi feita inspeção autenticada do painel real nesta etapa; a consistência painel/vitrine foi testada com API simulada.
- O nº 423, Symphony, tem uma lista de notas divulgadas, não uma pirâmide completa: [Louis Vuitton](https://br.louisvuitton.com/por-br/produtos/symphony-nvprod3230006v/LP0249) e [Fragrantica](https://www.fragrantica.com/perfume/Louis-Vuitton/Symphony-68357.html). Uma lista única agora aparece como **Notas olfativas**, sem inventar coração/fundo nem exibir linhas vazias. Pirâmides completas foram preservadas. O editor recebeu orientação de preenchimento.

### Evidências e reprodução

- Lint/tipografia, TypeScript, build web, integridade dos hashes e orçamento de bundle aprovados.
- **40 testes automatizados aprovados**: 30 execuções E2E com APIs simuladas e 10 verificações de funções/ativos, distribuídas pelos projetos celular e computador. Incluem a foto local decodificada nas duas áreas, lista de notas, mudança de URL, preservação de dados, checkout, frete, estoque e operação administrativa.
- JavaScript total: **1.778.761 bytes**; maior arquivo: **1.399.399 bytes**. Ambos dentro dos limites existentes.
- Segunda leitura do catálogo público e dos ativos preparados: **413/413 AVIF transparentes, zero erros e zero imagens a revisar**.
- Mapa versionado: `frontend/src/data/catalogImages.json`. Testes: `frontend/e2e/catalog-assets.spec.ts` e `frontend/e2e/admin-operation.spec.ts`.
- Conferência repetível, sem autenticação ou alterações no banco: `python scripts/audit-catalog-images.py --output output/catalog-images-NOVA-DATA`. Requer Python com Pillow (suporte AVIF) e requests. Usar diretório novo; o script recusa sobrescrever uma origem modificada durante a mesma auditoria.
- `scripts/prepare-catalog-assets.py` prepara cópias verificadas e gera o mapa, somente com `--write`. Novas origens sem transparência exigem revisão. O relatório/proveniência deste lote está em `output/catalog-images-20260904/` no ambiente local.

Observação: as contagens anteriores de 192 AVIF, 127 JPG, 94 WebP e 401 URLs externas descreviam a **API bruta**, não necessariamente o que já era renderizado pela vitrine, que possuía substituições locais.

### Próximo bloco da auditoria

Avaliar a correção compatível dos três alertas moderados descritos no tópico 1, sem rebaixar o Expo nem ocultar avisos. Depois, homologar com acesso autorizado os produtos não publicados, pagamentos/retomada e frete real; continuar os itens operacionais abaixo. A auditoria integral não está concluída e as notas históricas não equivalem a uma certificação 10/10.

Depois seguem as homologações externas, backup/restauração, segurança administrativa, acessibilidade, performance, monitoramento e evolução do painel descritos no histórico. Cada bloco deve terminar com validação e um ponto de retomada registrado.

## Histórico — revisão integral de 13/08/2026

Este é o ponto oficial de retomada da L’Essence Furlani. A nota não representa apenas aparência: considera comportamento validado, integridade dos dados, segurança, operação real e riscos externos.

## Estado atual

Nota técnica estimada: **9,4/10**.

Não há falha funcional reproduzível nos fluxos automatizados ou nas verificações ao vivo executadas nesta revisão. Isso não significa “risco zero”: pagamentos, transportadoras, rede, aparelhos e o Render gratuito são sistemas externos e podem falhar. Os riscos restantes estão explicitados abaixo.

| Área | Nota | Situação atual |
|---|---:|---|
| UX, identidade e responsividade | 9,5 | Celular e computador cobertos por E2E; falta homologação manual em mais aparelhos reais |
| Pagamentos | 9,5 | InfinitePay, retomada, idempotência, webhook e conciliação implementados |
| Frete e checkout | 9,5 | Melhor Envio em produção; Padrão e Prioritária cotadas e recalculadas pelo servidor |
| Estoque | 9,6 | Reserva e baixa atômicas; saldos negativos legados corrigidos e novo alerta automático criado |
| Backend e APIs | 9,6 | Rotas sensíveis autenticadas, contratos validados e 170 testes aprovados |
| Segurança | 9,3 | Segredos externos, step-up, rate limit e cabeçalhos ativos; resta pentest independente |
| Banco e integridade | 9,4 | Índices e migrações verificados; falta exercício periódico de restauração em produção |
| Performance e Render gratuito | 8,8 | Cache e recuperação automática ativos; plano gratuito ainda pode adormecer |
| Qualidade do frontend | 9,2 | Lint, TypeScript, tipografia, Expo Doctor e build aprovados; componentes grandes permanecem |
| Acessibilidade | 8,8 | Semântica e foco melhorados; faltam Axe, VoiceOver, TalkBack e zoom manual completo |
| Operação e recuperação | 9,1 | Diagnóstico interno existe; falta alerta externo e rotina mensal de desastre |
| Recursos de ERP | 8,5 | Custos, insumos, produção, fornecedores e histórico existem; fiscal e lotes ainda são evolução |

## Evidências desta revisão

- **170 testes de backend aprovados**, 40 cenários condicionais ignorados por dependerem de serviços/recursos opcionais.
- **28 testes E2E aprovados** em celular e computador.
- Lint, verificação de tipografia e TypeScript aprovados.
- Expo Doctor: **20/20**.
- Build web de produção aprovado.
- Dependências Python: nenhuma vulnerabilidade conhecida.
- API e banco: `/health/ready` em estado `ready`, esquema confirmado e latência observada.
- Segurança web: CSP, HSTS, proteção contra iframe, MIME sniffing, política de permissões e CORS restrito confirmados ao vivo.
- Documentação interativa da API desativada em produção.
- Tentativa de CORS a partir de origem não autorizada recusada.
- Catálogo público: **413 itens publicados**, sem nomes, famílias, ocasiões, notas, preços ou imagens ausentes.
- **413 imagens acessadas individualmente**, sem resposta quebrada após as correções.
- 414 perfumes ativos no painel: 413 publicados e 1 não publicado.
- 19 perfumes arquivados preservados fora do catálogo ativo.
- Frete real cotado em produção com as duas modalidades, sem criar postagem ou pedido.
- Total físico reconciliado em **13.365 ml**, reservado 0 ml e disponível 13.365 ml no momento da conferência.

## Correções concluídas nesta etapa

1. O relatório de rentabilidade deixou de incluir os 19 perfumes arquivados.
2. Insumos com mínimo zero deixaram de aparecer incorretamente como “REPOSIÇÃO”.
3. O diagnóstico operacional passou a detectar e alertar saldos físicos negativos.
4. Os saldos legados de Bleu de Chanel nº 089 e Aventus nº 117 foram corrigidos de -30 ml para 0 ml por conferência auditável.
5. Quatro URLs de imagem quebradas foram corrigidas:
   - nº 356, Polo Sport;
   - nº 357, Polo Sport essência especial;
   - nº 370, Lost Cherry;
   - nº 374, Mandarino di Amalfi.
6. Jubilation XXV nº 014 e Kalemat nº 020 receberam clima e ocasiões que estavam vazios.
7. A vitrine ganhou fallback visual para futuras imagens externas indisponíveis.
8. A publicação automática foi forçada e o snapshot terminou sem sincronização pendente.

## Fluxos validados

- abertura com servidor lento e recuperação automática;
- atualização por puxar para atualizar e reconciliação do carrinho salvo;
- busca, Pronta entrega, Sob encomenda, Favoritos e Filtros;
- cards, tamanhos, preços, notas e fallback de imagem;
- carrinho, dados do cliente, CEP, retirada e entrega;
- Entrega Padrão e Entrega Prioritária;
- aviso e aceite do prazo de até 14 dias para sob encomenda;
- resumo de produtos, frete e total calculado;
- criação idempotente de pedido e retomada de pagamento InfinitePay;
- acompanhamento e cancelamento permitido antes do atendimento;
- painel, catálogo, estoque, movimentos e conferência física;
- Kanban de pedidos, edição de valor negociado e transição de status;
- estorno/contestação com motivo auditável;
- custos, margem, fornecedores, insumos e simulação de produção;
- avaliações moderadas, sugestões e privacidade;
- backup criptografado, validação e restauração cobertos por testes;
- proteção de operações destrutivas por reautenticação curta.

## Riscos e pendências reais para chegar ao 10/10

### P0 — operação

1. **Backup real:** exportar um `.lfe`, guardar fora do Render e executar restauração controlada mensalmente. O painel ainda não possuía registro de backup exportado na conferência.
2. **Monitoramento externo:** avisar por e-mail/WhatsApp quando vitrine, API, pagamento ou fila apresentarem falha. Hoje o diagnóstico precisa ser aberto no painel.

### P1 — integrações externas

3. Homologar, com autorização financeira específica, cartão recusado, estorno real, contestação e chargeback.
4. Implementar compra de postagem, etiqueta da transportadora, rastreamento e cancelamento de postagem no Melhor Envio.
5. Implementar notificações consentidas de pagamento, preparação, envio e entrega.

### P1 — qualidade

6. Executar Axe, navegação completa por teclado, VoiceOver no iPhone, TalkBack no Android e zoom de 200%.
7. Acompanhar a correção oficial do `image-size` usado transitivamente pelo Expo/Metro. O `npm audit fix --force` não deve ser executado: ele propõe downgrade incompatível. O risco atual está no processamento de ativos durante o build, não em upload público de imagens.
8. Adicionar orçamento automático de tamanho do JavaScript, imagens e payload ao CI.

### P2 — performance e manutenção

9. Carregar detalhes olfativos sob demanda e virtualizar/paginar o catálogo para reduzir o bundle inicial de aproximadamente 1,3 MB não comprimido.
10. Modularizar `Atelie.tsx`, `Vitrine.tsx`, `CheckoutSheet.tsx` e `backend/routers/admin.py`.
11. O Render gratuito continuará sujeito a despertar. A abertura já mascara e recupera esse período, mas não elimina a limitação da hospedagem.

### P2 — evolução para ERP

12. Lotes, fórmula, maturação, validade e rastreabilidade por pedido.
13. Pedido de compra, recebimento parcial e histórico de preços de fornecedor.
14. Fluxo de caixa, contas, DRE, margem líquida, taxas e emissão fiscal.
15. Usuários e permissões separados para administração, produção, estoque, atendimento e financeiro.

## Critério para declarar 10/10

O sistema só deve ser declarado 10/10 quando os P0 estiverem operacionais, as homologações externas P1 tiverem evidência e a acessibilidade tiver validação automatizada e manual. Até lá, a base está estável e utilizável, mas a nota deve permanecer honesta.
