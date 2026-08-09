"""Trilha de auditoria operacional, sem duplicar dados pessoais."""

from datetime import datetime, timezone
from typing import Any


async def registrar_auditoria(
    db,
    *,
    acao: str,
    recurso: str,
    recurso_id: str,
    titulo: str,
    detalhes: str,
    metadados: dict[str, Any] | None = None,
) -> None:
    agora = datetime.now(timezone.utc).isoformat()
    await db.operacoes_sistema.insert_one({
        "tipo": f"auditoria:{acao}",
        "acao": acao,
        "recurso": recurso,
        "recursoId": recurso_id,
        "ator": "administrador",
        "titulo": titulo,
        "detalhes": detalhes,
        "perfumesAfetados": 0,
        "quantidadeMl": 0,
        "metadados": metadados or {},
        "data": agora,
    })
