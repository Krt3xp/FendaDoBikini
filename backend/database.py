"""
Módulo de configuração do banco de dados PostgreSQL.

Configura o SQLAlchemy engine, session factory e Base declarativa.
Utiliza variáveis de ambiente para a URL de conexão e inclui
pool de conexões otimizado para produção.

Modelos:
    - Engine com pool_pre_ping, pool_size=5, max_overflow=10
    - SessionLocal: sessionmaker vinculado ao engine
    - Base: classe base declarativa para todos os modelos ORM
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker

# Lê o DATABASE_URL do ambiente, ou usa o default para o docker
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql://fendadobikini:fendadobikini@postgres:5432/fendadobikini"
)

# No FastAPI, é comum criar o engine e o sessionmaker
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    """
    Dependency injection para sessões do banco de dados.

    Cria uma nova sessão SQLAlchemy para cada requisição e garante
    que ela seja fechada ao final, mesmo em caso de erro.
    Uso: db: Session = Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
