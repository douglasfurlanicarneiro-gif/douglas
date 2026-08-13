# Auditoria técnica e operacional — meta 10/10

Data da última revisão integral: **13/08/2026**

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
