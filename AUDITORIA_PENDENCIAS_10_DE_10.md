# Auditoria de pendências — meta 10/10

Data de consolidação: 13/08/2026

Este documento registra o estado atual da auditoria da L’Essence Furlani e deve ser usado como ponto de retomada. A auditoria antiga, com nota geral 7,4/10, não representa mais o sistema porque grande parte das pendências críticas já foi corrigida.

## Avaliação atual

Nota geral estimada: **8,9/10**.

| Área | Nota atual | Principal pendência |
|---|---:|---|
| UX e identidade visual | 9,2 | Revisão final em diferentes telas e aparelhos |
| Pagamentos | 9,2 | Configurar segredo dedicado no Render e exercícios financeiros excepcionais |
| Frete e checkout | 8,8 | Migrar do Sandbox para produção, comprar postagem, gerar etiqueta e rastrear |
| Estoque | 9,2 | Auditoria integral de custos e concorrência em produção |
| Backend/API | 9,0 | Reduzir módulos grandes e ampliar testes externos |
| Segurança | 8,8 | Dependências transitivas e teste de invasão |
| Banco e integridade | 9,0 | Teste periódico de restauração e reconciliação |
| Performance/Render | 8,2 | Catálogo pesado e limitação do plano gratuito |
| Qualidade do frontend | 8,6 | Componentes ainda muito grandes e pouco isolados |
| Acessibilidade | 8,4 | Testes automáticos WCAG e validação manual |
| Operação e recuperação | 9,0 | Alertas externos e simulação periódica de desastre |
| Recursos de ERP | 7,8 | Produção, lotes, compras, fiscal e notificações |

## O que já está sólido

- 167 testes do backend aprovados.
- 24 testes E2E aprovados em celular e computador.
- Lint, TypeScript e build web aprovados.
- Expo Doctor com 20/20 verificações aprovadas.
- Nenhuma vulnerabilidade conhecida nas dependências Python.
- API, banco e vitrine respondendo normalmente.
- Catálogo administrativo protegido contra acesso anônimo.
- Reserva e baixa atômica de estoque.
- Prevenção de pedidos duplicados.
- Checkout InfinitePay e retomada de pagamento pendente.
- Conciliação de pagamentos, estorno e contestação.
- Histórico e rastreabilidade das operações.
- Backups protegidos e rotinas de recuperação.
- Privacidade, aceite de prazo e tratamento de dados.
- Limites de requisição nas APIs sensíveis.
- Sincronização automática da vitrine.
- Avaliações moderadas.
- Etiquetas internas de produção em PDF.
- Imagens AVIF e tratamento dos fundos.
- Responsividade e tipografia mais consistentes.

## Pendências críticas

### 1. Corrigir a suíte E2E — concluído em 13/08/2026

Resultado atual: **24 testes aprovados e nenhuma reprovação**.

As seis falhas antigas tinham a mesma causa: os perfumes simulados pelos testes não continham o campo obrigatório `imagemUrl`, introduzido pela otimização de imagens. O processamento falhava e a vitrine entrava corretamente no ciclo de nova tentativa.

Concluído:

- contrato dos dados simulados atualizado com `imagemUrl`;
- seis cenários antigos corrigidos em celular e computador;
- cobertura acrescentada para catálogo lento;
- cobertura acrescentada para resposta 503 seguida de recuperação automática;
- brilho e apresentação inicial preservados;
- lint, TypeScript e build web aprovados.

### 2. Homologar pagamentos de ponta a ponta — homologação técnica concluída em 13/08/2026

Confirmado com segurança, sem gerar nova cobrança:

- pedido real aprovado pela InfinitePay, com três parcelas e NSU registrado;
- confirmação automática persistida no pedido;
- retomada de pagamento pendente;
- webhook autenticado, persistido, idempotente e processado em segundo plano;
- rejeição de webhook com token inválido antes de acessar o banco;
- validação do valor recebido, transação duplicada e aprovação atrasada;
- retentativas automáticas, conciliação e fila de revisão manual;
- contrato do webhook alinhado à documentação oficial;
- painel passa a alertar quando `INFINITEPAY_WEBHOOK_SECRET` exclusivo não estiver configurado;
- limites de tamanho e faixa adicionados ao conteúdo recebido pelo webhook.

Pendências externas que não devem ser simuladas com dinheiro real sem autorização específica:

- o painel publicado confirmou que o segredo dedicado ainda não está ativo no Render;
- executar, quando houver ambiente apropriado, cartão recusado, estorno real, contestação e chargeback;
- testar indisponibilidade real do provedor sem afetar clientes.

### 3. Auditar o frete em produção — núcleo do checkout validado em 13/08/2026

Confirmado:

- integração do Melhor Envio conectada;
- cotação real e segura para CEP de teste, sem comprar postagem;
- modalidades padrão e prioritária com preço e prazo próprios;
- embalagem, percentual e diferença mínima aplicados corretamente;
- nova cotação obrigatória no servidor durante o fechamento;
- produto, CEP e serviço selecionado validados no backend;
- endereço completo, transportadora, modalidade, preço e prazo congelados no pedido;
- valor enviado pelo cliente não é considerado fonte confiável;
- painel passa a exibir explicitamente `Produção` ou `Sandbox`.

Ainda pendente:

- o painel publicado confirmou `Conectado · Sandbox`; é necessário cadastrar as credenciais produtivas e refazer a autorização OAuth;
- implementar compra do frete, etiqueta da transportadora e rastreamento;
- homologar cancelamento de postagem e tratamento de falhas da transportadora.

### 4. Resolver dependências do frontend

Existem dez alertas altos em `image-size`, dependência transitiva do Expo/Metro. Não aplicar o `npm audit fix --force`, pois ele propõe uma alteração incompatível do Expo.

- Acompanhar correção oficial do Expo/Metro.
- Testar atualização em branch separada.
- Fazer o CI sinalizar novas vulnerabilidades altas.

### 5. Completar a integridade do catálogo

A vitrine pública possui 416 perfumes. Lacuna identificada:

- nº 423, Symphony Louis Vuitton — Compartilhável:
  - notas de coração vazias;
  - notas de fundo vazias.

Fazer conferência autenticada de todos os itens:

- custo por ml da Nova Essência;
- código do fornecedor;
- embalagem de origem e quantidade;
- nome, gênero e inspiração;
- duplicidades;
- foto correta;
- AVIF transparente sem fundo branco;
- margem positiva nos três tamanhos.

## Melhorias importantes

### 6. Notificações automáticas

Enviar, com consentimento e registro, notificações de:

- pagamento confirmado;
- pedido em preparação;
- pedido pronto;
- pedido enviado com rastreio;
- pedido entregue ou disponível para retirada;
- pagamento pendente por tempo prolongado.

### 7. Performance

- Paginação ou carregamento progressivo.
- Cache com `ETag`.
- Resposta resumida para os cards.
- Detalhes sob demanda.
- Imagens responsivas.
- Core Web Vitals.
- Limites de tamanho para JavaScript, imagens e API.

O Render gratuito continuará sujeito ao despertar do servidor.

### 8. Modularização

Arquivos grandes que ainda precisam ser separados:

- `frontend/src/components/Atelie.tsx`: aproximadamente 1.964 linhas.
- `frontend/src/components/Vitrine.tsx`: aproximadamente 1.943 linhas.
- `frontend/src/components/CheckoutSheet.tsx`: aproximadamente 1.356 linhas.
- `backend/routers/admin.py`: aproximadamente 1.017 linhas.

Separar regras de negócio, carregamento de dados, componentes visuais, formulários, checkout, catálogo, estoque e configurações.

### 9. Acessibilidade

- Axe automatizado.
- Navegação somente por teclado.
- VoiceOver no iPhone.
- TalkBack no Android.
- Contraste e zoom de 200%.
- Tamanhos mínimos de toque.
- Fontes aumentadas pelo aparelho.

### 10. Observabilidade e recuperação

- Alertas externos para API, vitrine e pagamentos.
- Painel de erros agrupados.
- Correlação entre pedido, pagamento e webhook.
- Alertas de estoque negativo ou divergente.
- Teste mensal de restauração do backup.
- Manual de indisponibilidade da InfinitePay e Melhor Envio.

## Evolução para ERP profissional

1. Produção por lote, fórmula, consumo de insumos, maturação, validade e responsável.
2. Pedidos de compra, previsão, recebimento parcial e histórico de preços.
3. Rastreabilidade dos lotes usados em cada pedido.
4. Fluxo de caixa, contas, DRE, taxas, margem líquida e emissão fiscal.
5. Usuários e permissões para administração, produção, estoque, atendimento e financeiro.

## Ordem oficial de retomada

1. ~~Corrigir os seis testes E2E e a validação da inicialização.~~ Concluído em 13/08/2026.
2. ~~Homologar tecnicamente InfinitePay e o cálculo de frete em produção.~~ Concluído em 13/08/2026; restam verificações externas explicitadas acima.
3. Completar Symphony e auditar custos, dados e fotos dos 416 perfumes.
4. Tratar dependências do frontend.
5. Implementar rastreamento e etiqueta de transporte.
6. Implementar notificações automáticas.
7. Melhorar carregamento e payload do catálogo.
8. Modularizar os arquivos grandes.
9. Executar auditoria completa de acessibilidade.
10. Evoluir produção, compras, lotes, financeiro e fiscal.

## Próximo ponto de retomada

Antes do tópico 3, fechar a configuração externa: **cadastrar `INFINITEPAY_WEBHOOK_SECRET` exclusivo e migrar o Melhor Envio de Sandbox para Produção no Render**, refazendo a autorização OAuth. Depois disso, completar Symphony e auditar custos, dados e fotos dos 416 perfumes.
