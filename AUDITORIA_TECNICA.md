# Auditoria técnica — Contratipos Ateliê

## Resumo

O projeto tem uma base funcional coerente: Expo/React Native no aplicativo,
FastAPI no backend, MongoDB como persistência, JWT no painel administrativo e
uma camada de provedores para pagamentos. A identidade visual existente foi
preservada.

Esta revisão priorizou o caminho crítico de venda, integridade de estoque,
tipagem e estabilidade. O sistema ainda precisa de infraestrutura externa
(gateway de pagamento, banco de produção e notificações) antes de ser
considerado pronto para uma operação real.

## Problemas de prioridade alta corrigidos

- A publicação da vitrine quebrava em tempo de execução por referenciar uma
  variável inexistente.
- O checkout aceitava preço, nome e disponibilidade enviados pelo aplicativo.
  Agora o backend busca o produto, recalcula os preços e valida o estoque.
- O fluxo público aceitava dados incompletos. O novo carrinho exige cadastro,
  endereço e forma de pagamento antes da finalização.
- O login tinha perdido o feedback de credenciais inválidas e imprimia a
  resposta no console.
- O TypeScript não compilava devido a um estado de modal inexistente.
- Pedidos administrativos podiam levar o estoque a valores negativos.
- Valores padrão de preço eram injetados na vitrine e podiam divergir do
  catálogo administrado.

## Melhorias de prioridade média implementadas

- Carrinho com vários itens, alteração de quantidade, remoção, subtotal,
  observações e confirmação.
- Persistência local do cadastro do cliente para compras futuras.
- Seleção de Pix ou cartão mantendo o gateway desacoplado.
- Tipos reutilizáveis para produtos, pedidos, estoque, avaliações, mensagens e
  compras.
- Cliente HTTP com timeout, erros de domínio e detecção de sessão ausente.
- Validações Pydantic para produtos, pedidos, endereço, itens, quantidades,
  preços e status.
- Feedback tátil nos componentes de ação reutilizáveis.
- Painel atualizado para exibir compras com múltiplos itens e pagamento.
- Pedidos feitos na vitrine passam a entrar diretamente em `pedidos`; registros
  antigos de `compras` também aparecem na aba Pedidos, sem migração destrutiva.
- Avaliações e sugestões ficam concentradas em Opiniões; Mensagens não recebe
  mais pedidos ou avaliações.
- Vitrine redesenhada com foto, pirâmide olfativa sempre visível, disponibilidade,
  preços por tamanho e navegação inferior para vitrine e carrinho.
- Campo público “Clima & ocasião” substitui a inspiração e permite combinar
  estação, período do dia e contexto de uso.
- O painel permite informar a URL da foto e pré-visualizá-la antes de salvar.
  Perfumes antigos continuam compatíveis e exibem estados elegantes quando
  ainda não possuem foto, notas ou ocasiões cadastradas.
- Arquivos de exemplo para configuração segura dos ambientes.

## Pendências antes da produção

### Alta

- Escolher um PSP e implementar credenciais/webhooks para Pix e cartão. O
  provedor atual é apenas uma interface segura de extensão.
- Implementar autenticação do cliente, recuperação de conta e consentimento
  para tratamento dos dados pessoais (LGPD).
- Migrar os testes antigos, que dependem de um servidor remoto e de um token
  fixo, para testes isolados com banco de teste.
- Configurar `CORS_ORIGINS` com as origens reais e rotacionar qualquer
  credencial que já tenha sido compartilhada ou versionada.

### Média

- Separar o componente `Atelie.tsx` por domínio/tela e remover os `any`
  restantes dos formulários internos.
- Criar webhook idempotente de pagamento e uma máquina de estados completa:
  recebido, pagamento pendente, aprovado, separando, enviado, entregue e
  cancelado.
- Adicionar frete real, cupons, favoritos, paginação e upload direto de arquivos
  para um serviço de armazenamento (a entrega atual aceita URL de imagem).
- Adicionar rate limiting, logs estruturados, monitoramento e alertas.

### Baixa

- Adicionar fontes Fraunces/Manrope aos assets do aplicativo.
- Criar testes de componentes e testes E2E do checkout.
- Adicionar skeletons e imagens próprias para estados vazios.

## Validação desta entrega

- TypeScript em modo estrito: aprovado.
- ESLint: aprovado, sem avisos.
- Conferência visual da vitrine web local: aprovada.
- Compilação dos módulos Python: aprovada.
- Importação dos modelos e routers do backend: aprovada.
- Conexão com o MongoDB original: aprovada (419 perfumes encontrados).
- Login e endpoints públicos/privados usando a base original: aprovados.
- Testes Python legados: coleta aprovada; 35 testes de integração ignorados
  sem URL/token de um ambiente de teste, conforme esperado.
