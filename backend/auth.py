"""
Módulo de autenticação do projeto Fenda do Bikini.

Implementa:
    - Hash e verificação de senhas com bcrypt
    - Emissão e validação de tokens de sessão (JWT HS256)
    - Dependency `get_current_user` para uso nos endpoints
    - Middleware de proteção global das rotas /api/*

Fluxo de primeiro acesso: moradores cadastrados sem senha definem a
própria senha via POST /api/auth/setup-password (permitido apenas
enquanto password_hash for NULL). Depois disso, apenas login normal.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import User

# Chave usada para assinar os tokens de sessão. OBRIGATÓRIO definir em
# produção (docker-compose lê AUTH_SECRET do .env).
AUTH_SECRET = os.getenv("AUTH_SECRET", "")
if not AUTH_SECRET:
    AUTH_SECRET = "dev-insecure-secret-change-me"
    print("AVISO: AUTH_SECRET não definido — usando chave de desenvolvimento insegura.")

TOKEN_TTL = timedelta(days=7)
JWT_ALGORITHM = "HS256"

# Prefixos de rota que não exigem autenticação
PUBLIC_PATH_PREFIXES = ("/api/auth/", "/docs", "/openapi.json", "/redoc")

MIN_PASSWORD_LENGTH = 8


def hash_password(password: str) -> str:
    """Gera o hash bcrypt de uma senha em texto puro."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Verifica uma senha contra o hash armazenado."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_session_token(user: User) -> str:
    """Emite um JWT de sessão (7 dias) para o usuário autenticado."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "iat": now,
        "exp": now + TOKEN_TTL,
    }
    return jwt.encode(payload, AUTH_SECRET, algorithm=JWT_ALGORITHM)


def decode_session_token(token: str) -> Optional[dict]:
    """Decodifica e valida um token de sessão. Retorna o payload ou None."""
    try:
        return jwt.decode(token, AUTH_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None


def _extract_bearer_token(request: Request) -> Optional[str]:
    """Extrai o token Bearer do header Authorization, se presente."""
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer "):
        return authorization[len("Bearer "):]
    return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """
    Dependency: resolve o usuário autenticado a partir do token Bearer.

    Raises:
        HTTPException(401): token ausente, inválido, expirado ou usuário inexistente
    """
    token = _extract_bearer_token(request)
    payload = decode_session_token(token) if token else None
    if not payload:
        raise HTTPException(status_code=401, detail="Não autenticado")
    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    return user


def _is_bootstrap_user_creation(request: Request) -> bool:
    """
    Permite POST /api/users sem autenticação apenas enquanto o banco não
    tem nenhum usuário (bootstrap da instalação). Sem isso, uma instância
    nova ficaria trancada para sempre: criar morador exige login e logar
    exige morador.
    """
    if request.method != "POST" or request.url.path.rstrip("/") != "/api/users":
        return False
    db = SessionLocal()
    try:
        return db.query(User).count() == 0
    finally:
        db.close()


async def auth_middleware(request: Request, call_next):
    """
    Middleware global: exige token de sessão válido em todas as rotas
    /api/*, exceto autenticação (/api/auth/*), documentação e o caso de
    bootstrap (primeiro usuário de uma instalação vazia).
    """
    path = request.url.path
    needs_auth = path.startswith("/api/") and not path.startswith(PUBLIC_PATH_PREFIXES)

    if needs_auth and request.method != "OPTIONS":
        token = _extract_bearer_token(request)
        payload = decode_session_token(token) if token else None
        if not payload and not _is_bootstrap_user_creation(request):
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"detail": "Não autenticado"})

    return await call_next(request)
