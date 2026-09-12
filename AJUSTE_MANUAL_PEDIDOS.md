# Ajuste manual de pedidos — 12/09/2026

Implementado um fluxo administrativo separado, em Editar pedido > Ajuste manual do pedido.

- Todas as sete etapas são selecionáveis, inclusive regressões, cancelamento e reabertura.
- Pagamento pode ser mantido, registrado como pago manualmente ou aguardando pagamento, independentemente da etapa.
- Exige sessão administrativa, reautenticação e motivo de pelo menos cinco caracteres não vazios.
- Transação MongoDB abrange reconciliação dos movimentos, status e histórico interno com responsável e motivo.
- Permite baixa sem saldo; pode produzir saldo negativo real, sem inventar entradas. Ao regredir para etapa sem consumo, estorna a baixa. Sinalização persistente de revisão do estoque no pedido.
- Não chama InfinitePay: nenhuma cobrança, devolução ou alteração do checkout.
- Ajustes manuais em pagamentos InfinitePay ficam sinalizados até a conciliação. Se o provedor confirmar posteriormente a mesma cobrança, a confirmação verificada substitui automaticamente a marcação manual sem regredir a etapa operacional do pedido.
- Valor divergente, segunda transação e pagamento recebido após cancelamento não sobrescrevem silenciosamente o estado anterior: o pedido recebe aviso visível, valores para conferência e histórico interno; o evento deixa a fila de repetição e segue para revisão humana.
- A Saúde operacional conta tanto eventos financeiros em revisão quanto pedidos marcados para conferência.
- Histórico interno não é adicionado ao histórico público de status.
- Correções de dados, com mesmas quantidades e etapa, não exigem validação de estoque.
- Mantidas proteções de alteração de valor de cobrança online. Não implementada renegociação automática de checkout nem edição irrestrita de todos os campos.
- Nenhum pedido real modificado durante testes.

Verificações locais: 270 testes backend passaram, 42 opt-in ignorados; 50 testes Playwright passaram em celular e computador; TypeScript, lint/tipografia, build web e limite de bundle passaram. O CI também executa o ajuste manual em um MongoDB isolado real e comprova rollback integral após uma falha provocada dentro da transação.

Backup: duas cópias reais de 07/09/2026 validadas pelo painel, com 1945 e 1946 registros. Não houve restauração real.
