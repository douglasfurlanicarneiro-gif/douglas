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
