# Ajuste manual de pedidos — 12/09/2026

Implementado um fluxo administrativo separado, em Editar pedido > Ajuste manual do pedido.

- Todas as sete etapas são selecionáveis, inclusive regressões, cancelamento e reabertura.
- Pagamento pode ser mantido, registrado como pago manualmente ou aguardando pagamento, independentemente da etapa.
- Exige sessão administrativa, reautenticação e motivo de pelo menos cinco caracteres não vazios.
- Transação MongoDB abrange reconciliação dos movimentos, status e histórico interno com responsável e motivo.
- Permite baixa sem saldo; pode produzir saldo negativo real, sem inventar entradas. Ao regredir para etapa sem consumo, estorna a baixa. Sinalização persistente de revisão do estoque no pedido.
- Não chama InfinitePay: nenhuma cobrança, devolução ou alteração do checkout. O provedor continua podendo confirmar pagamentos; uma confirmação posterior à confirmação manual pode exigir conciliação de duplicidade.
- Histórico interno não é adicionado ao histórico público de status.
- Correções de dados, com mesmas quantidades e etapa, não exigem validação de estoque.
- Mantidas proteções de alteração de valor de cobrança online. Não implementada renegociação automática de checkout nem edição irrestrita de todos os campos.
- Nenhum pedido real modificado durante testes.

Verificações locais: 263 testes backend passaram, 41 opt-in ignorados; 24 testes administrativos Playwright passaram (celular e computador); TypeScript, lint/tipografia e build web passaram. Testes unitários da transação usam mocks; não representam ensaio novo de ajuste manual em MongoDB real.

Backup: duas cópias reais de 07/09/2026 validadas pelo painel, com 1945 e 1946 registros. Não houve restauração real.
