"""
Módulo principal da API FastAPI do projeto Fenda do Bikini.

Gerencia endpoints para:
    - Dashboard consolidado (GET /api/dashboard)
    - CRUD de usuários, grupos, membros, categorias
    - Criação/edição/exclusão de despesas com upload de comprovante
    - Liquidações (settlements) entre moradores
    - Contas fixas, créditos de favores, despensa compartilhada
"""

# TODO: Configurar Alembic para migrações versionadas (substituir ALTER TABLE manual)
# TODO: Implementar paginação no endpoint do dashboard
# TODO: Adicionar rate limiting nos endpoints
# TODO: Adicionar testes automatizados com pytest

from fastapi import FastAPI, Depends, Form, UploadFile, File, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, func
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, date, timezone
from decimal import Decimal
import uuid
import os
import shutil

from database import engine, Base, get_db
from models import (
    User, Group, GroupMember, Category, Expense, ExpenseSplit, 
    Settlement, ActivityLog, FixedBill, FavorCredit, PantryItem, PantryPurchase
)

# Extensões de arquivo permitidas para upload de comprovantes
ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif"}
# Tamanho máximo de upload: 8MB
MAX_UPLOAD_SIZE_BYTES = 8 * 1024 * 1024

# Create tables
Base.metadata.create_all(bind=engine)

# Add column if not exists
from sqlalchemy import text
try:
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE pantry_purchases ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)"))
        conn.commit()
except Exception as e:
    print("Could not alter tables:", e)

from auth import (
    auth_middleware, get_current_user, hash_password, verify_password,
    create_session_token, MIN_PASSWORD_LENGTH
)

app = FastAPI()

# Proteção global: todas as rotas /api/* exigem sessão (exceto /api/auth/*)
app.middleware("http")(auth_middleware)

# CORS configuration — restringido apenas às origens confiáveis do frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global IntegrityError Handler
@app.exception_handler(IntegrityError)
def integrity_exception_handler(request: Request, exc: IntegrityError):
    """Captura erros de integridade do banco e retorna resposta amigável."""
    return JSONResponse(
        status_code=400,
        content={"detail": "Erro de integridade no banco de dados. Verifique se existem dependências ativas (ex: despesas registradas) que impedem esta ação."}
    )


def _validate_upload(file_content: bytes, filename: str) -> None:
    """
    Valida tamanho e extensão de um arquivo de upload.

    Args:
        file_content: conteúdo do arquivo em bytes
        filename: nome original do arquivo

    Raises:
        HTTPException(400): se o arquivo exceder 8MB ou a extensão não for permitida
    """
    if len(file_content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Arquivo excede 8MB")
    file_ext = os.path.splitext(filename)[1].lower()
    if file_ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Tipo de arquivo não permitido")


# ---- AUTH ----

def _serialize_session_user(user: User) -> dict:
    """Serializa o usuário autenticado para respostas de auth."""
    return {"id": str(user.id), "name": user.name, "email": user.email}


@app.post("/api/auth/login")
def login(email: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    """
    Autentica um morador por e-mail e senha.

    Returns:
        dict com 'token' (JWT de sessão, 7 dias) e 'user'

    Raises:
        HTTPException(401): credenciais inválidas
        HTTPException(409): morador existe mas ainda não definiu senha (primeiro acesso)
    """
    user = db.query(User).filter(func.lower(User.email) == email.strip().lower()).first()
    if not user:
        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos")
    if user.password_hash is None:
        raise HTTPException(status_code=409, detail="Primeiro acesso: defina sua senha antes de entrar")
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos")
    return {"token": create_session_token(user), "user": _serialize_session_user(user)}


@app.post("/api/auth/setup-password")
def setup_password(email: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    """
    Primeiro acesso: define a senha de um morador que ainda não tem uma.

    Só funciona enquanto password_hash for NULL — depois disso a troca de
    senha exige a senha atual (ver /api/auth/change-password).

    Raises:
        HTTPException(400): senha curta demais
        HTTPException(404): e-mail não cadastrado
        HTTPException(409): morador já tem senha definida
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"A senha precisa ter pelo menos {MIN_PASSWORD_LENGTH} caracteres")
    user = db.query(User).filter(func.lower(User.email) == email.strip().lower()).first()
    if not user:
        raise HTTPException(status_code=404, detail="E-mail não cadastrado. Peça a um morador para te cadastrar.")
    if user.password_hash is not None:
        raise HTTPException(status_code=409, detail="Este morador já tem senha definida")
    user.password_hash = hash_password(password)
    db.commit()
    return {"token": create_session_token(user), "user": _serialize_session_user(user)}


@app.post("/api/auth/change-password")
def change_password(
    currentPassword: str = Form(...),
    newPassword: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Troca a senha do morador autenticado (exige a senha atual)."""
    if len(newPassword) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"A senha precisa ter pelo menos {MIN_PASSWORD_LENGTH} caracteres")
    if current_user.password_hash is None or not verify_password(currentPassword, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Senha atual incorreta")
    current_user.password_hash = hash_password(newPassword)
    db.commit()
    return {"ok": True}


@app.get("/api/auth/me")
def get_me(current_user: User = Depends(get_current_user)):
    """Retorna o morador da sessão atual (também valida o token)."""
    return _serialize_session_user(current_user)


# ---- SCHEMAS FOR DASHBOARD ----
class DashboardResponse(BaseModel):
    """Schema de resposta do dashboard (não utilizado diretamente, apenas documentação)."""
    users: List[dict]
    categories: List[dict]
    groups: List[dict]

# TODO: Resolver problema N+1 queries — usar eager loading com joinedload()
@app.get("/api/dashboard", response_model=dict)
def get_dashboard_data(db: Session = Depends(get_db)):
    """
    Retorna todos os dados consolidados do dashboard.

    Inclui usuários, categorias e grupos com seus membros, despesas,
    liquidações, contas fixas, créditos de favores e despensa.

    Returns:
        dict com chaves 'users', 'categories' e 'groups'
    """
    users = db.query(User).order_by(desc(User.created_at)).all()
    categories = db.query(Category).order_by(asc(Category.name)).all()
    
    # Complex query for groups matching the Prisma structure
    groups = db.query(Group).order_by(desc(Group.created_at)).all()
    groups_data = []
    
    for g in groups:
        members = db.query(GroupMember).filter(GroupMember.group_id == g.id).order_by(asc(GroupMember.joined_at)).all()
        expenses = db.query(Expense).filter(Expense.group_id == g.id).order_by(desc(Expense.expense_date)).all()
        activity_logs = db.query(ActivityLog).filter(ActivityLog.group_id == g.id).order_by(desc(ActivityLog.created_at)).limit(5).all()
        fixed_bills = db.query(FixedBill).filter(FixedBill.group_id == g.id).order_by(asc(FixedBill.due_date)).all()
        favor_credits = db.query(FavorCredit).filter(FavorCredit.group_id == g.id).order_by(desc(FavorCredit.created_at)).all()
        pantry_items = db.query(PantryItem).filter(PantryItem.group_id == g.id).order_by(asc(PantryItem.name)).all()
        pantry_purchases = db.query(PantryPurchase).filter(PantryPurchase.group_id == g.id).order_by(desc(PantryPurchase.purchased_at)).limit(8).all()
        settlements = db.query(Settlement).filter(Settlement.group_id == g.id).order_by(desc(Settlement.settled_at)).all()
        
        groups_data.append({
            "id": str(g.id),
            "name": g.name,
            "defaultCurrency": g.default_currency,
            "createdById": str(g.created_by_id),
            "createdAt": g.created_at.isoformat(),
            "updatedAt": g.updated_at.isoformat(),
            "createdBy": {"id": str(g.created_by.id), "name": g.created_by.name, "email": g.created_by.email} if g.created_by else None,
            "members": [
                {
                    "id": str(m.id), "userId": str(m.user_id), "groupId": str(m.group_id), "role": m.role, "joinedAt": m.joined_at.isoformat(),
                    "user": {"id": str(m.user.id), "name": m.user.name, "email": m.user.email}
                } for m in members
            ],
            "expenses": [
                {
                    "id": str(e.id), "groupId": str(e.group_id), "payerId": str(e.payer_id), "categoryId": str(e.category_id) if e.category_id else None,
                    "amount": e.amount, "currency": e.currency, "description": e.description, "expenseDate": e.expense_date.isoformat(),
                    "receiptUrl": e.receipt_url, "receiptName": e.receipt_name, "receiptMimeType": e.receipt_mime_type,
                    "createdAt": e.created_at.isoformat(), "updatedAt": e.updated_at.isoformat(),
                    "category": {"id": str(e.category.id), "name": e.category.name, "icon": e.category.icon} if e.category else None,
                    "payer": {"id": str(e.payer.id), "name": e.payer.name, "email": e.payer.email} if e.payer else None,
                    "splits": [
                        {
                            "id": str(s.id), "expenseId": str(s.expense_id), "groupId": str(s.group_id), "debtorId": str(s.debtor_id),
                            "amountOwed": s.amount_owed,
                            "debtor": {"id": str(s.debtor.id), "name": s.debtor.name, "email": s.debtor.email}
                        } for s in e.splits
                    ]
                } for e in expenses
            ],
            "activityLogs": [
                {
                    "id": str(l.id), "groupId": str(l.group_id), "actorId": str(l.actor_id) if l.actor_id else None,
                    "actionType": l.action_type, "actionDescription": l.action_description, "metadata": l.metadata_,
                    "createdAt": l.created_at.isoformat(),
                    "actor": {"id": str(l.actor.id), "name": l.actor.name, "email": l.actor.email} if l.actor else None
                } for l in activity_logs
            ],
            "fixedBills": [
                {
                    "id": str(fb.id), "groupId": str(fb.group_id), "name": fb.name, "dueDate": fb.due_date.isoformat(),
                    "isPaid": fb.is_paid, "createdAt": fb.created_at.isoformat(), "updatedAt": fb.updated_at.isoformat()
                } for fb in fixed_bills
            ],
            "favorCredits": [
                {
                    "id": str(fc.id), "groupId": str(fc.group_id), "creditorId": str(fc.creditor_id), "debtorId": str(fc.debtor_id),
                    "description": fc.description, "credits": fc.credits, "status": fc.status, 
                    "createdAt": fc.created_at.isoformat(), "settledAt": fc.settled_at.isoformat() if fc.settled_at else None,
                    "creditor": {"id": str(fc.creditor.id), "name": fc.creditor.name},
                    "debtor": {"id": str(fc.debtor.id), "name": fc.debtor.name}
                } for fc in favor_credits
            ],
            "pantryItems": [
                {
                    "id": str(pi.id), "groupId": str(pi.group_id), "name": pi.name, "quantity": pi.quantity,
                    "lastPurchasedById": str(pi.last_purchased_by_id) if pi.last_purchased_by_id else None,
                    "createdAt": pi.created_at.isoformat(), "updatedAt": pi.updated_at.isoformat(),
                    "lastPurchasedBy": {"id": str(pi.last_purchased_by.id), "name": pi.last_purchased_by.name} if pi.last_purchased_by else None
                } for pi in pantry_items
            ],
            "pantryPurchases": [
                {
                    "id": str(pp.id), "groupId": str(pp.group_id), "itemId": str(pp.item_id) if pp.item_id else None,
                    "purchaserId": str(pp.purchaser_id), "itemName": pp.item_name, "quantity": pp.quantity,
                    "purchasedAt": pp.purchased_at.isoformat(), "createdAt": pp.created_at.isoformat(),
                    "purchaser": {"id": str(pp.purchaser.id), "name": pp.purchaser.name},
                    "expenseId": str(pp.expense_id) if pp.expense_id else None,
                    "expense": {
                        "id": str(pp.expense.id),
                        "amount": pp.expense.amount,
                        "currency": pp.expense.currency,
                        "receiptUrl": pp.expense.receipt_url,
                        "receiptName": pp.expense.receipt_name,
                        "receiptMimeType": pp.expense.receipt_mime_type,
                    } if pp.expense else None
                } for pp in pantry_purchases
            ],
            "settlements": [
                {
                    "id": str(st.id), "groupId": str(st.group_id), "payerId": str(st.payer_id), "receiverId": str(st.receiver_id),
                    "amount": st.amount, "currency": st.currency, "settledAt": st.settled_at.isoformat(), "createdAt": st.created_at.isoformat(),
                    "payer": {"id": str(st.payer.id), "name": st.payer.name},
                    "receiver": {"id": str(st.receiver.id), "name": st.receiver.name}
                } for st in settlements
            ]
        })

    return {
        "users": [{"id": str(u.id), "name": u.name, "email": u.email, "createdAt": u.created_at.isoformat(), "updatedAt": u.updated_at.isoformat()} for u in users],
        "categories": [{"id": str(c.id), "name": c.name, "icon": c.icon, "createdAt": c.created_at.isoformat()} for c in categories],
        "groups": groups_data
    }

# ---- ACTIONS ----

@app.post("/api/categories")
def create_category(name: str = Form(...), icon: Optional[str] = Form(None), db: Session = Depends(get_db)):
    """
    Cria ou atualiza uma categoria de despesa.

    Args:
        name: nome da categoria
        icon: emoji/ícone opcional

    Returns:
        dict com status de sucesso
    """
    cat = db.query(Category).filter(Category.name == name).first()
    if cat:
        cat.icon = icon
    else:
        cat = Category(name=name, icon=icon)
        db.add(cat)
    db.commit()
    return {"status": "success"}

@app.post("/api/users")
def create_user(name: str = Form(...), email: str = Form(...), db: Session = Depends(get_db)):
    """
    Cria um novo usuário/morador.

    Args:
        name: nome do morador
        email: e-mail (será normalizado para minúsculas)

    Returns:
        dict com status de sucesso
    """
    user = User(name=name, email=email.lower())
    db.add(user)
    db.commit()
    return {"status": "success"}

@app.put("/api/users")
def update_user(userId: str = Form(...), name: str = Form(...), email: str = Form(...), db: Session = Depends(get_db)):
    """
    Atualiza nome e e-mail de um usuário existente.

    Args:
        userId: UUID do usuário
        name: novo nome
        email: novo e-mail

    Returns:
        dict com status de sucesso
    """
    user = db.query(User).filter(User.id == userId).first()
    if user:
        user.name = name
        user.email = email.lower()
        db.commit()
    return {"status": "success"}

@app.delete("/api/users")
def delete_user(userId: str = Form(...), db: Session = Depends(get_db)):
    """
    Remove um usuário do sistema.

    Args:
        userId: UUID do usuário a ser removido

    Returns:
        dict com status de sucesso

    Raises:
        IntegrityError (tratado globalmente): se o usuário possui dependências ativas
    """
    user = db.query(User).filter(User.id == userId).first()
    if user:
        db.delete(user)
        db.commit()
    return {"status": "success"}

@app.post("/api/groups")
def create_group(name: str = Form(...), defaultCurrency: str = Form(...), ownerId: str = Form(...), db: Session = Depends(get_db)):
    """
    Cria um novo grupo e adiciona o criador como OWNER.

    Args:
        name: nome do grupo (ex: 'República Fenda do Bikini')
        defaultCurrency: moeda padrão (ex: 'BRL')
        ownerId: UUID do usuário criador

    Returns:
        dict com status de sucesso
    """
    group = Group(name=name, default_currency=defaultCurrency.upper(), created_by_id=ownerId)
    db.add(group)
    db.flush() # get id
    member = GroupMember(group_id=group.id, user_id=ownerId, role="OWNER")
    db.add(member)
    log = ActivityLog(group_id=group.id, actor_id=ownerId, action_type="GROUP_CREATED", 
                      action_description=f'Grupo "{name}" criado.', metadata_={"groupId": str(group.id), "currency": defaultCurrency})
    db.add(log)
    db.commit()
    return {"status": "success"}

@app.put("/api/groups")
def update_group(groupId: str = Form(...), name: str = Form(...), defaultCurrency: str = Form(...), db: Session = Depends(get_db)):
    """
    Atualiza nome e moeda padrão de um grupo.

    Args:
        groupId: UUID do grupo
        name: novo nome
        defaultCurrency: nova moeda padrão

    Returns:
        dict com status de sucesso
    """
    group = db.query(Group).filter(Group.id == groupId).first()
    if group:
        group.name = name
        group.default_currency = defaultCurrency.upper()
        db.commit()
    return {"status": "success"}

@app.delete("/api/groups")
def delete_group(groupId: str = Form(...), db: Session = Depends(get_db)):
    """
    Remove um grupo e todas as suas dependências (cascade).

    Args:
        groupId: UUID do grupo a ser removido

    Returns:
        dict com status de sucesso
    """
    group = db.query(Group).filter(Group.id == groupId).first()
    if group:
        db.delete(group)
        db.commit()
    return {"status": "success"}

@app.post("/api/group-members")
def add_group_member(groupId: str = Form(...), userId: str = Form(...), role: str = Form("MEMBER"), db: Session = Depends(get_db)):
    """
    Adiciona um membro a um grupo ou atualiza seu papel.

    Args:
        groupId: UUID do grupo
        userId: UUID do usuário
        role: papel do membro ('OWNER' ou 'MEMBER')

    Returns:
        dict com status de sucesso
    """
    member = db.query(GroupMember).filter(GroupMember.group_id == groupId, GroupMember.user_id == userId).first()
    if member:
        member.role = role
    else:
        member = GroupMember(group_id=groupId, user_id=userId, role=role)
        db.add(member)
    log = ActivityLog(group_id=groupId, actor_id=userId, action_type="MEMBER_ADDED", 
                      action_description="Membro adicionado ao grupo.", metadata_={"userId": userId, "role": role})
    db.add(log)
    db.commit()
    return {"status": "success"}

@app.post("/api/fixed-bills")
def create_fixed_bill(groupId: str = Form(...), name: str = Form(...), dueDate: str = Form(...), actorId: Optional[str] = Form(None), db: Session = Depends(get_db)):
    """
    Cria uma nova conta fixa no grupo.

    Args:
        groupId: UUID do grupo
        name: nome da conta (ex: 'Internet', 'Aluguel')
        dueDate: data de vencimento no formato 'YYYY-MM-DD'
        actorId: UUID do usuário que criou (opcional)

    Returns:
        dict com status de sucesso
    """
    bill = FixedBill(group_id=groupId, name=name, due_date=datetime.strptime(dueDate, "%Y-%m-%d").date())
    db.add(bill)
    db.flush()
    log = ActivityLog(group_id=groupId, actor_id=actorId, action_type="FIXED_BILL_CREATED", 
                      action_description=f'Conta fixa "{name}" cadastrada.', metadata_={"fixedBillId": str(bill.id), "dueDate": dueDate})
    db.add(log)
    db.commit()
    return {"status": "success"}

@app.put("/api/fixed-bills/toggle")
def toggle_fixed_bill_paid(fixedBillId: str = Form(...), groupId: str = Form(...), isPaid: str = Form(...), actorId: Optional[str] = Form(None), db: Session = Depends(get_db)):
    """
    Alterna o status de pagamento de uma conta fixa.

    Args:
        fixedBillId: UUID da conta fixa
        groupId: UUID do grupo
        isPaid: 'true' ou 'false' como string
        actorId: UUID do usuário que alterou (opcional)

    Returns:
        dict com status de sucesso
    """
    bill = db.query(FixedBill).filter(FixedBill.id == fixedBillId).first()
    is_paid_bool = isPaid.lower() == 'true'
    if bill:
        bill.is_paid = is_paid_bool
        log = ActivityLog(group_id=groupId, actor_id=actorId, 
                          action_type="FIXED_BILL_PAID" if is_paid_bool else "FIXED_BILL_REOPENED", 
                          action_description="Conta fixa marcada como paga." if is_paid_bool else "Conta fixa voltou para a pagar.", 
                          metadata_={"fixedBillId": fixedBillId, "isPaid": is_paid_bool})
        db.add(log)
        db.commit()
    return {"status": "success"}

@app.delete("/api/fixed-bills")
def delete_fixed_bill(fixedBillId: str = Form(...), groupId: str = Form(...), actorId: Optional[str] = Form(None), db: Session = Depends(get_db)):
    """
    Remove uma conta fixa do grupo.

    Args:
        fixedBillId: UUID da conta fixa
        groupId: UUID do grupo
        actorId: UUID do ator (opcional)

    Returns:
        dict com status de sucesso
    """
    bill = db.query(FixedBill).filter(FixedBill.id == fixedBillId).first()
    if bill:
        db.delete(bill)
        log = ActivityLog(group_id=groupId, actor_id=actorId, action_type="FIXED_BILL_DELETED", 
                          action_description="Conta fixa removida.", metadata_={"fixedBillId": fixedBillId})
        db.add(log)
        db.commit()
    return {"status": "success"}

@app.post("/api/favor-credits")
def create_favor_credit(groupId: str = Form(...), creditorId: str = Form(...), debtorId: str = Form(...), description: str = Form(...), credits: int = Form(...), db: Session = Depends(get_db)):
    """
    Registra um crédito de favor entre dois moradores.

    Args:
        groupId: UUID do grupo
        creditorId: UUID de quem fez o favor
        debtorId: UUID de quem deve o favor
        description: descrição do favor
        credits: quantidade de créditos

    Returns:
        dict com status de sucesso
    """
    credit = FavorCredit(group_id=groupId, creditor_id=creditorId, debtor_id=debtorId, description=description, credits=credits)
    db.add(credit)
    db.flush()
    log = ActivityLog(group_id=groupId, actor_id=creditorId, action_type="FAVOR_CREDIT_CREATED", 
                      action_description=f'Crédito de favor registrado: "{description}".', 
                      metadata_={"favorCreditId": str(credit.id), "creditorId": creditorId, "debtorId": debtorId, "credits": credits})
    db.add(log)
    db.commit()
    return {"status": "success"}

@app.put("/api/favor-credits/settle")
def settle_favor_credit(favorCreditId: str = Form(...), groupId: str = Form(...), actorId: Optional[str] = Form(None), db: Session = Depends(get_db)):
    """
    Marca um crédito de favor como liquidado.

    Args:
        favorCreditId: UUID do crédito de favor
        groupId: UUID do grupo
        actorId: UUID do ator (opcional)

    Returns:
        dict com status de sucesso
    """
    credit = db.query(FavorCredit).filter(FavorCredit.id == favorCreditId).first()
    if credit:
        credit.status = "SETTLED"
        credit.settled_at = datetime.now(timezone.utc)
        log = ActivityLog(group_id=groupId, actor_id=actorId, action_type="FAVOR_CREDIT_SETTLED", 
                          action_description="Crédito de favor batido.", metadata_={"favorCreditId": favorCreditId})
        db.add(log)
        db.commit()
    return {"status": "success"}

@app.post("/api/pantry-purchases")
async def create_pantry_purchase(
    request: Request,
    groupId: str = Form(...),
    itemName: str = Form(...),
    quantity: str = Form(...),
    purchaserId: str = Form(...),
    purchasedAt: str = Form(...),
    amount: str = Form(...),
    receipt: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    """
    Registra uma compra de despensa, criando automaticamente a despesa vinculada.

    Cria o item de despensa (ou atualiza se já existir), gera uma Expense com
    splits divididos igualmente entre todos os membros do grupo, e registra
    o PantryPurchase vinculado.

    Args:
        groupId: UUID do grupo
        itemName: nome do item comprado
        quantity: quantidade (string livre, ex: '2kg', '1L')
        purchaserId: UUID de quem comprou
        purchasedAt: data da compra 'YYYY-MM-DD'
        amount: valor da compra (aceita vírgula como separador decimal)
        receipt: arquivo de comprovante (opcional)

    Returns:
        dict com status de sucesso
    """
    # TODO: Migrar uploads para armazenamento em nuvem (S3/GCS)
    # 1. Process receipt if provided
    receipt_url = None
    receipt_name = None
    receipt_mime_type = None
    
    if receipt and getattr(receipt, "filename", None):
        # Validação de tamanho e extensão do arquivo
        file_content = await receipt.read()
        _validate_upload(file_content, receipt.filename)
        await receipt.seek(0)

        os.makedirs("/app/public/uploads/receipts", exist_ok=True)
        file_ext = os.path.splitext(receipt.filename)[1]
        safe_filename = f"{uuid.uuid4()}{file_ext}"
        filepath = os.path.join("/app/public/uploads/receipts", safe_filename)
        
        with open(filepath, "wb") as f:
            f.write(file_content)
            
        receipt_url = f"/receipts/{safe_filename}"
        receipt_name = receipt.filename
        receipt_mime_type = receipt.content_type

    # 2. Get or create category "Mercado"
    category = db.query(Category).filter(Category.name.ilike("Mercado")).first()
    if not category:
        category = Category(name="Mercado", icon="🛒")
        db.add(category)
        db.flush()

    # 3. Create the Expense record
    decimal_amount = Decimal(amount.replace(',', '.'))
    
    group = db.query(Group).filter(Group.id == groupId).first()
    currency = group.default_currency if group else "BRL"
    
    expense = Expense(
        group_id=groupId,
        payer_id=purchaserId,
        description=f"Mercado: {itemName} ({quantity})",
        amount=decimal_amount,
        currency=currency,
        expense_date=datetime.strptime(purchasedAt, "%Y-%m-%d").date(),
        category_id=category.id,
        receipt_url=receipt_url,
        receipt_name=receipt_name,
        receipt_mime_type=receipt_mime_type
    )
    db.add(expense)
    db.flush()

    # 4. Create the splits (divided equally among ALL members in the group)
    members = db.query(GroupMember).filter(GroupMember.group_id == groupId).all()
    participant_ids = [m.user_id for m in members]
    n = len(participant_ids)
    
    if n > 0:
        # Divisão em centavos para evitar erros de arredondamento
        amount_cents = int(decimal_amount * 100)
        base_cents = amount_cents // n
        remainder = amount_cents % n
        
        for i, pid in enumerate(participant_ids):
            cents_owed = base_cents + (1 if i < remainder else 0)
            owed = Decimal(cents_owed) / 100
            split = ExpenseSplit(
                expense_id=expense.id,
                group_id=groupId,
                debtor_id=pid,
                amount_owed=owed
            )
            db.add(split)

    # 5. Create or update PantryItem
    item = db.query(PantryItem).filter(PantryItem.group_id == groupId, PantryItem.name == itemName).first()
    if item:
        item.quantity = quantity
        item.last_purchased_by_id = purchaserId
    else:
        item = PantryItem(group_id=groupId, name=itemName, quantity=quantity, last_purchased_by_id=purchaserId)
        db.add(item)
    db.flush()

    # 6. Create PantryPurchase and link to Expense
    purchase = PantryPurchase(
        group_id=groupId,
        item_id=item.id,
        purchaser_id=purchaserId,
        item_name=itemName,
        quantity=quantity,
        purchased_at=datetime.strptime(purchasedAt, "%Y-%m-%d").date(),
        expense_id=expense.id
    )
    db.add(purchase)

    # 7. Add Activity Log
    log = ActivityLog(
        group_id=groupId,
        actor_id=purchaserId,
        action_type="PANTRY_PURCHASE_CREATED",
        action_description=f'{itemName} entrou na despensa (R$ {decimal_amount:.2f}).',
        metadata_={"pantryItemId": str(item.id), "itemName": itemName, "quantity": quantity, "purchasedAt": purchasedAt, "expenseId": str(expense.id)}
    )
    db.add(log)
    db.commit()

    return {"status": "success"}

@app.delete("/api/pantry-items")
def delete_pantry_item(pantryItemId: str = Form(...), groupId: str = Form(...), actorId: Optional[str] = Form(None), db: Session = Depends(get_db)):
    """
    Remove um item da despensa.

    Args:
        pantryItemId: UUID do item
        groupId: UUID do grupo
        actorId: UUID do ator (opcional)

    Returns:
        dict com status de sucesso
    """
    item = db.query(PantryItem).filter(PantryItem.id == pantryItemId).first()
    if item:
        db.delete(item)
        log = ActivityLog(group_id=groupId, actor_id=actorId, action_type="PANTRY_ITEM_DELETED", 
                          action_description="Item removido da despensa.", metadata_={"pantryItemId": pantryItemId})
        db.add(log)
        db.commit()
    return {"status": "success"}

@app.post("/api/settlements")
def create_settlement(groupId: str = Form(...), payerId: str = Form(...), receiverId: str = Form(...), amount: str = Form(...), currency: str = Form(...), db: Session = Depends(get_db)):
    """
    Registra uma liquidação (pagamento de dívida) entre dois moradores.

    Args:
        groupId: UUID do grupo
        payerId: UUID de quem pagou
        receiverId: UUID de quem recebeu
        amount: valor liquidado (aceita vírgula como separador decimal)
        currency: moeda (ex: 'BRL')

    Returns:
        dict com status de sucesso

    Raises:
        HTTPException(404): se payer ou receiver não forem encontrados
    """
    # Normalização de valor
    normalized_amount = amount.replace(',', '.')
    decimal_amount = Decimal(normalized_amount)
    
    settlement = Settlement(group_id=groupId, payer_id=payerId, receiver_id=receiverId, amount=decimal_amount, currency=currency.upper())
    db.add(settlement)
    db.flush()
    
    payer = db.query(User).filter(User.id == payerId).first()
    if not payer:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    receiver = db.query(User).filter(User.id == receiverId).first()
    if not receiver:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    
    log = ActivityLog(group_id=groupId, actor_id=payerId, action_type="SETTLEMENT_CREATED", 
                      action_description=f'{payer.name} liquidou {decimal_amount} {currency} para {receiver.name}.', 
                      metadata_={"settlementId": str(settlement.id), "payerId": payerId, "receiverId": receiverId, "amount": str(decimal_amount), "currency": currency})
    db.add(log)
    db.commit()
    return {"status": "success"}

@app.post("/api/expenses")
async def create_expense(request: Request, db: Session = Depends(get_db)):
    """
    Cria uma nova despesa com divisão entre participantes.

    Suporta dois modos de divisão:
    - 'equal': divide igualmente em centavos (evita erro de arredondamento)
    - 'custom': cada participante tem uma porcentagem personalizada

    Aceita upload opcional de comprovante (receipt).

    Args:
        request: Request contendo form-data com groupId, payerId, amount,
                 currency, expenseDate, categoryId, description, splitMode,
                 participantIds[], receipt (arquivo), splitPercentage:<id>

    Returns:
        dict com status de sucesso

    Raises:
        HTTPException(400): se campos obrigatórios forem inválidos
    """
    form = await request.form()
    
    group_id = form.get("groupId")
    payer_id = form.get("payerId")
    amount_str = form.get("amount")
    currency = form.get("currency")
    expense_date_str = form.get("expenseDate")
    category_id = form.get("categoryId")
    description = form.get("description")
    split_mode = form.get("splitMode", "equal")
    
    receipt = form.get("receipt")
    
    # Validação de campos obrigatórios
    if not amount_str or not amount_str.strip():
        raise HTTPException(status_code=400, detail="Valor da despesa é obrigatório")
    if not currency:
        raise HTTPException(status_code=400, detail="Moeda é obrigatória")
    if not expense_date_str:
        raise HTTPException(status_code=400, detail="Data da despesa é obrigatória")
    
    # Process participantIds
    participant_ids = form.getlist("participantIds")
    
    amount = Decimal(amount_str.replace(',', '.'))
    
    # TODO: Migrar uploads para armazenamento em nuvem (S3/GCS)
    receipt_url = None
    receipt_name = None
    receipt_mime_type = None
    
    if receipt and getattr(receipt, "filename", None):
        # Validação de tamanho e extensão do arquivo
        file_content = await receipt.read()
        _validate_upload(file_content, receipt.filename)
        await receipt.seek(0)

        os.makedirs("/app/public/uploads/receipts", exist_ok=True)
        file_ext = os.path.splitext(receipt.filename)[1]
        safe_filename = f"{uuid.uuid4()}{file_ext}"
        filepath = os.path.join("/app/public/uploads/receipts", safe_filename)
        
        with open(filepath, "wb") as f:
            f.write(file_content)
            
        receipt_url = f"/receipts/{safe_filename}"
        receipt_name = receipt.filename
        receipt_mime_type = receipt.content_type

    expense = Expense(
        group_id=group_id,
        payer_id=payer_id,
        category_id=category_id if category_id else None,
        amount=amount,
        currency=currency.upper(),
        description=description,
        expense_date=datetime.strptime(expense_date_str, "%Y-%m-%d").date(),
        receipt_url=receipt_url,
        receipt_name=receipt_name,
        receipt_mime_type=receipt_mime_type
    )
    db.add(expense)
    db.flush()
    
    if not participant_ids:
        members = db.query(GroupMember).filter(GroupMember.group_id == group_id).all()
        participant_ids = [m.user_id for m in members]
        
    n = len(participant_ids)
    if split_mode == "equal" and n > 0:
        # Divisão em centavos para evitar erros de arredondamento
        amount_cents = int(amount * 100)
        base_cents = amount_cents // n
        remainder = amount_cents % n
        
        for i, pid in enumerate(participant_ids):
            cents_owed = base_cents + (1 if i < remainder else 0)
            owed = Decimal(cents_owed) / 100
            split = ExpenseSplit(
                expense_id=expense.id,
                group_id=group_id,
                debtor_id=pid,
                amount_owed=owed
            )
            db.add(split)
    elif split_mode == "custom" and n > 0:
        # Divisão customizada por porcentagem, com ajuste de diferença de arredondamento
        total_owed = Decimal("0.00")
        splits_to_add = []
        for pid in participant_ids:
            pct_str = form.get(f"splitPercentage:{pid}")
            if pct_str:
                pct = Decimal(pct_str.replace(',', '.'))
                owed = (amount * pct / 100).quantize(Decimal("0.01"))
                splits_to_add.append((pid, owed))
                total_owed += owed
            else:
                splits_to_add.append((pid, Decimal("0.00")))
                
        # Ajusta diferença de arredondamento no primeiro split
        diff = amount - total_owed
        if diff != 0 and splits_to_add:
            splits_to_add[0] = (splits_to_add[0][0], splits_to_add[0][1] + diff)
            
        for pid, owed in splits_to_add:
            split = ExpenseSplit(
                expense_id=expense.id,
                group_id=group_id,
                debtor_id=pid,
                amount_owed=owed
            )
            db.add(split)
            
    payer = db.query(User).filter(User.id == payer_id).first()
    log = ActivityLog(
        group_id=group_id,
        actor_id=payer_id,
        action_type="EXPENSE_CREATED",
        action_description=f'{payer.name if payer else "Desconhecido"} registrou uma despesa de {amount} {currency}.',
        metadata_={"expenseId": str(expense.id), "amount": str(amount), "currency": currency}
    )
    db.add(log)
    db.commit()
    return {"status": "success"}

@app.put("/api/expenses")
async def update_expense(request: Request, db: Session = Depends(get_db)):
    """
    Atualiza uma despesa existente, recriando os splits.

    Remove todos os splits antigos e recria com base no novo valor e
    modo de divisão. Suporta upload de novo comprovante (substitui o anterior).

    Args:
        request: Request contendo form-data com expenseId, groupId, actorId,
                 description, amount, currency, expenseDate, categoryId,
                 payerId, splitMode, participantIds[], receipt, splitPercentage:<id>

    Returns:
        dict com status de sucesso

    Raises:
        HTTPException(404): se a despesa ou o ator não forem encontrados
    """
    form = await request.form()
    
    expense_id = form.get("expenseId")
    group_id = form.get("groupId")
    actor_id = form.get("actorId")
    
    description = form.get("description")
    amount_str = form.get("amount")
    currency = form.get("currency")
    expense_date_str = form.get("expenseDate")
    category_id = form.get("categoryId")
    payer_id = form.get("payerId")
    
    receipt = form.get("receipt")
    
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
        
    new_amount = Decimal(amount_str.replace(',', '.'))
    old_amount = expense.amount
    amount_changed = new_amount != old_amount
    
    if receipt and getattr(receipt, "filename", None):
        # Validação de tamanho e extensão do arquivo
        file_content = await receipt.read()
        _validate_upload(file_content, receipt.filename)
        await receipt.seek(0)

        os.makedirs("/app/public/uploads/receipts", exist_ok=True)
        # Remove comprovante antigo se existir
        if expense.receipt_url:
            old_filename = expense.receipt_url.split("/")[-1]
            old_filepath = os.path.join("/app/public/uploads/receipts", old_filename)
            if os.path.exists(old_filepath):
                try:
                    os.remove(old_filepath)
                except Exception as e:
                    print("Error deleting old file:", e)
                    
        file_ext = os.path.splitext(receipt.filename)[1]
        safe_filename = f"{uuid.uuid4()}{file_ext}"
        filepath = os.path.join("/app/public/uploads/receipts", safe_filename)
        
        with open(filepath, "wb") as f:
            f.write(file_content)
            
        expense.receipt_url = f"/receipts/{safe_filename}"
        expense.receipt_name = receipt.filename
        expense.receipt_mime_type = receipt.content_type

    expense.description = description
    expense.amount = new_amount
    expense.currency = currency.upper()
    expense.expense_date = datetime.strptime(expense_date_str, "%Y-%m-%d").date()
    expense.category_id = category_id if category_id else None
    expense.payer_id = payer_id
    
    # Delete old splits and recreate them
    db.query(ExpenseSplit).filter(ExpenseSplit.expense_id == expense_id).delete()
    
    split_mode = form.get("splitMode", "equal")
    participant_ids = form.getlist("participantIds")
    
    if not participant_ids:
        members = db.query(GroupMember).filter(GroupMember.group_id == group_id).all()
        participant_ids = [m.user_id for m in members]
        
    n = len(participant_ids)
    if split_mode == "equal" and n > 0:
        # Divisão em centavos para evitar erros de arredondamento
        amount_cents = int(new_amount * 100)
        base_cents = amount_cents // n
        remainder = amount_cents % n
        
        for i, pid in enumerate(participant_ids):
            cents_owed = base_cents + (1 if i < remainder else 0)
            owed = Decimal(cents_owed) / 100
            split = ExpenseSplit(
                expense_id=expense.id,
                group_id=group_id,
                debtor_id=pid,
                amount_owed=owed
            )
            db.add(split)
    elif split_mode == "custom" and n > 0:
        # Divisão customizada por porcentagem
        total_owed = Decimal("0.00")
        splits_to_add = []
        for pid in participant_ids:
            pct_str = form.get(f"splitPercentage:{pid}")
            if pct_str:
                pct = Decimal(pct_str.replace(',', '.'))
                owed = (new_amount * pct / 100).quantize(Decimal("0.01"))
                splits_to_add.append((pid, owed))
                total_owed += owed
            else:
                splits_to_add.append((pid, Decimal("0.00")))
                
        diff = new_amount - total_owed
        if diff != 0 and splits_to_add:
            splits_to_add[0] = (splits_to_add[0][0], splits_to_add[0][1] + diff)
            
        for pid, owed in splits_to_add:
            split = ExpenseSplit(
                expense_id=expense.id,
                group_id=group_id,
                debtor_id=pid,
                amount_owed=owed
            )
            db.add(split)
                    
    actor = db.query(User).filter(User.id == actor_id).first()
    if not actor:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    log = ActivityLog(
        group_id=group_id,
        actor_id=actor_id,
        action_type="EXPENSE_UPDATED",
        action_description=f'{actor.name} atualizou a despesa "{description or "Sem descrição"}".',
        metadata_={"expenseId": expense_id, "amount": str(new_amount), "currency": currency}
    )
    db.add(log)
    db.commit()
    return {"status": "success"}

@app.delete("/api/expenses")
async def delete_expense(request: Request, db: Session = Depends(get_db)):
    """
    Remove uma despesa e seu comprovante associado (se houver).

    Args:
        request: Request contendo form-data com expenseId, groupId, actorId

    Returns:
        dict com status de sucesso

    Raises:
        HTTPException(404): se a despesa ou o ator não forem encontrados
    """
    form = await request.form()
    
    expense_id = form.get("expenseId")
    group_id = form.get("groupId")
    actor_id = form.get("actorId")
    
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
        
    # Remove arquivo de comprovante do disco
    if expense.receipt_url:
        old_filename = expense.receipt_url.split("/")[-1]
        old_filepath = os.path.join("/app/public/uploads/receipts", old_filename)
        if os.path.exists(old_filepath):
            try:
                os.remove(old_filepath)
            except Exception as e:
                print("Error deleting receipt file:", e)
                
    db.delete(expense)
    
    actor = db.query(User).filter(User.id == actor_id).first()
    if not actor:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    log = ActivityLog(
        group_id=group_id,
        actor_id=actor_id,
        action_type="EXPENSE_DELETED",
        action_description=f'{actor.name} removeu uma despesa.',
        metadata_={"expenseId": expense_id}
    )
    db.add(log)
    db.commit()
    return {"status": "success"}
