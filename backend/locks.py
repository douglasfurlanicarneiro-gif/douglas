"""Travas de processo para operações que precisam ser indivisíveis."""
import asyncio


# O deploy atual usa um único processo da API. A trava impede que dois
# checkouts simultâneos leiam o mesmo saldo antes de registrar as saídas.
stock_lock = asyncio.Lock()
