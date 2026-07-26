from fastapi import APIRouter
from pydantic import BaseModel

from database import get_db
from security import create_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginPayload(BaseModel):
    usuario: str
    senha: str


@router.post("/login")
async def login(payload: LoginPayload):
    db = get_db()
    admin = await db.admins.find_one({"usuario": payload.usuario})
    if not admin or not verify_password(payload.senha, admin["senhaHash"]):
        return {"ok": False}
    token = create_token(admin["usuario"])
    return {"ok": True, "token": token}
