# L’Essence Furlani

Aplicativo Expo/React Native com vitrine pública, carrinho, checkout e painel
administrativo. O backend usa FastAPI e MongoDB.

A vitrine possui cartões com foto, notas de topo/coração/base, seleção de
tamanho, preço e indicação de “Clima & ocasião”. No painel, edite um perfume
para informar a URL da imagem, selecionar as ocasiões e preencher a pirâmide
olfativa.

## Início rápido no Windows

1. Mantenha o arquivo original `douglas.zip` na pasta `Downloads`.
2. Dê dois cliques em `INICIAR_APP.cmd`.
3. Aguarde a instalação inicial. O navegador abrirá em
   `http://localhost:8081`.
4. Para encerrar os serviços, execute `PARAR_APP.cmd`.

O inicializador recupera a configuração do MongoDB diretamente do ZIP original
e não imprime nem inclui credenciais no novo pacote.

## Estado da base original

Na última validação, o banco continha 419 perfumes e o acesso administrativo
funcionava. Os 418 itens importados tinham opções de 30/50/100ml, mas todos os
preços estavam zerados e não havia movimentos de entrada de estoque. Esses
dados precisam ser definidos pelo proprietário antes da publicação e venda.

Consulte `AUDITORIA_TECNICA.md` para detalhes técnicos e pendências de produção.

## Publicação permanente

O arquivo `render.yaml` prepara a vitrine como um site estático no Render. O
build usa `npm ci && npm run build:web`, publica a pasta `frontend/dist` e
mantém a API no serviço já existente.

Depois de conectar o repositório ao Render como Blueprint, cada atualização do
branch configurado gera uma nova versão automaticamente. Configure no backend
as variáveis descritas em `backend/.env.example`; nunca envie o arquivo `.env`
real para o repositório.

## Privacidade dos pedidos

O histórico no aparelho é identificado por códigos de acompanhamento longos e
aleatórios. O cliente pode adicionar o mesmo pedido em outro aparelho usando
esse código. Nome, telefone, e-mail e endereço não são retornados pela rota
pública de acompanhamento.
