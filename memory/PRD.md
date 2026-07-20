# Contratipos Ateliê

## Descrição
App mobile Expo/React Native para atelier de perfumes contratipos (dupes inspirados). Dois modos:
- **Vitrine pública** (padrão): catálogo com busca, filtro por família, cards com pirâmide olfativa, pedido de compra e sugestões.
- **Ateliê privado** (escondido, protegido por senha): painel do dono com Dashboard, Catálogo, Estoque, Pedidos, Opiniões e Mensagens (compras + sugestões recebidas).

## Tecnologias
- Frontend: Expo Router + React Native (SDK 54)
- Backend: FastAPI + MongoDB (motor async)
- Persistência do token do Ateliê: AsyncStorage

## Credenciais fixas (Ateliê)
Ver `/app/memory/test_credentials.md`. Usuário `douglasfurlani` / Senha `Dfc160201`.

## Acesso ao Ateliê
Long-press (~0.8s) no ícone de cadeado discreto no canto superior direito da Vitrine → abre bottom sheet com login.

## Endpoints principais
- `POST /api/auth/login` — retorna token fixo
- `GET /api/perfumes` (público), `POST/PUT/DELETE /api/perfumes/:id` (privado)
- `POST /api/perfumes/bulk-import` — importa 418 nomes do fornecedor Nova Essência (embutidos)
- `GET /api/vitrine` (público) — snapshot publicado
- `POST /api/vitrine/publish` (privado) — publica versão atual
- `POST /api/sugestoes` (público) — cliente envia sugestão
- `POST /api/compras` (público) — cliente envia pedido de compra a partir da vitrine
- CRUD de movimentos, pedidos, opiniões (todos privados, exceto GET de opiniões)

## Regra de negócio: estoque
Pedidos com status ≠ cancelado geram movimentos de saída automáticos. Edição/exclusão faz estorno automático (entrada).

## Vitrine publicada
- Apenas perfumes com `publicavel=true` entram
- Campo `disponivel = estoque > 0`
- Snapshot gravado em `db.vitrine` (chave "snapshot")

## Sem WhatsApp (por decisão do usuário — deixado para depois)
