# L'Essence Furlani — Fase 1 de Gestão

Esta versão implementa os cinco primeiros blocos da auditoria técnica: segurança/dados, custos e lucro, matérias-primas/produção, BI e fornecedores.

## 1. Segurança e consistência de dados

- O estoque exato deixou de ser exposto pela vitrine pública. A vitrine recebe apenas disponibilidade, status e tamanhos disponíveis.
- `GET /api/estoque` agora exige autenticação do painel.
- Login administrativo possui limitação de tentativas por IP + usuário (5 tentativas em 15 minutos, bloqueio de 15 minutos).
- A senha administrativa definida em `ATELIE_ADMIN_PASSWORD` passa a ser sincronizada com o MongoDB no bootstrap. Assim, trocar a variável no Render efetivamente rotaciona a senha no próximo restart/deploy.
- Relatórios históricos de QA no pacote foram sanitizados e relatórios gerados passaram a ser ignorados pelo Git.
- `/health/ready` verifica também a conexão com o MongoDB; `/health` continua leve para keep-alive.
- O dashboard deixou de contar pedidos pendentes como faturamento confirmado.

### Ação obrigatória após publicar

Troque `ATELIE_ADMIN_PASSWORD` no Render por uma senha nova e forte e faça um restart/redeploy do serviço. Como relatórios antigos já podem ter existido no histórico do Git, considere também remover versões históricas sensíveis do repositório.

## 2. Custos e rentabilidade

Nova área **Sistema > Custos & Rentabilidade**.

Configuração global:
- custo da base por ml;
- válvula;
- tampa;
- etiqueta;
- embalagem;
- outros custos por frasco;
- taxa de pagamento (%);
- custo do frasco por tamanho (30/50/100 ml);
- concentração padrão.

Por perfume:
- custo da essência por ml;
- concentração real da fórmula.

O sistema calcula custo de essência, base, frasco, componentes, taxa de pagamento, custo total, lucro e margem por tamanho. Novos pedidos salvam um snapshot do custo estimado no momento da venda para que alterações futuras de preço/custo não reescrevam a história.

## 3. Matérias-primas e produção

Nova área **Sistema > Matérias-primas & Produção**.

Tipos de insumo:
- essência;
- base;
- frasco;
- válvula;
- tampa;
- etiqueta;
- embalagem;
- outros.

O saldo é um ledger de entradas e saídas. A produção pode ser simulada antes de confirmar. Ao registrar uma produção:
1. valida insumos obrigatórios e saldo;
2. baixa a matéria-prima;
3. registra o lote de produção;
4. dá entrada no estoque comercial do perfume acabado.

Essência e base são operadas em ml; frascos/componentes por unidade. Isso evita misturar unidades incompatíveis no cálculo. Ao cadastrar/editar insumos, os custos operacionais relevantes também sincronizam o motor de rentabilidade (essência, base, frasco, válvula, tampa, etiqueta e embalagem).

## 4. Dashboard BI

O dashboard agora aceita filtros de 7 dias, 30 dias, mês atual e todo o histórico e separa:
- receita confirmada;
- lucro estimado de produtos;
- margem estimada;
- ticket médio;
- contas a receber;
- pedidos pagos, pendentes e cancelados;
- volume vendido em ml;
- tamanho mais vendido;
- série diária de receita/lucro;
- ranking por volume;
- ranking por lucro estimado.

Pedidos pendentes não entram em receita. Frete cobrado do cliente não é tratado como lucro de produto.

## 5. Fornecedores e cotações

Nova área **Sistema > Fornecedores** com cadastro persistente no MongoDB.

Cada fornecedor pode ter:
- site;
- contato/WhatsApp/e-mail;
- documento;
- pedido mínimo;
- prazo médio;
- observações;
- status ativo/arquivado.

As cotações preservam fornecedor, produto, código, quantidade/unidade, preço, frete, link, observação e custo unitário. Uma cotação em ml pode ser vinculada a um perfume e aplicada diretamente como custo da essência por ml; se a essência já estiver cadastrada como insumo, o custo dela também é sincronizado. Ao selecionar um perfume na cotação, o painel compara a última cotação de cada fornecedor e destaca o menor custo em ml.

## Novas coleções MongoDB

Não há migração destrutiva. As coleções são criadas automaticamente quando usadas:
- `configuracoes` (`_id: custos`);
- `fornecedores`;
- `cotacoes_fornecedores`;
- `insumos`;
- `movimentos_insumos`;
- `producoes`;
- `auth_login_attempts`.

O backup administrativo foi atualizado para incluir as novas coleções.

## Validações realizadas neste pacote

- compilação sintática de todo o backend com `compileall`;
- 2 testes unitários do motor de custos aprovados;
- verificação de parsing TypeScript nos arquivos alterados sem erros de sintaxe;
- varredura do pacote de trabalho para o segredo histórico identificado: ocorrência removida/sanitizada.

O pacote recebido não contém `node_modules` e o ambiente desta revisão não contém todas as dependências Python do projeto (por exemplo, Motor). Por isso não foi possível executar localmente o build Expo completo nem subir a API integrada ao MongoDB. Faça o deploy em staging/Render e rode um smoke test antes de substituir uma versão de produção.

## Primeiro uso recomendado

1. Publique esta versão.
2. Rotacione `ATELIE_ADMIN_PASSWORD` e reinicie a API.
3. Em **Custos & Rentabilidade**, configure os custos globais.
4. Nos perfumes, informe custo da essência por ml e concentração.
5. Em **Matérias-primas**, cadastre pelo menos essência, base e frascos dos tamanhos usados.
6. Simule uma produção pequena e só então registre a produção real.
7. Cadastre fornecedores e passe a registrar as novas cotações.
8. Confira o Dashboard após uma venda paga para validar receita, lucro e volume.
