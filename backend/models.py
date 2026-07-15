"""
Módulo de modelos ORM do SQLAlchemy para o projeto Fenda do Bikini.

Define todos os modelos de dados persistidos no PostgreSQL:
    - User: moradores/usuários do sistema
    - Group: grupos de divisão de despesas
    - GroupMember: associação N:N entre User e Group
    - Category: categorias de despesas (ex: Mercado, Aluguel)
    - Expense: despesas registradas em um grupo
    - ExpenseSplit: divisão de uma despesa entre devedores
    - Settlement: liquidações (pagamentos) entre moradores
    - ActivityLog: log de atividades para auditoria
    - FixedBill: contas fixas recorrentes
    - FavorCredit: créditos de favores entre moradores
    - PantryItem: itens da despensa compartilhada
    - PantryPurchase: registro de compras para a despensa
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import Boolean, Column, String, Text, DateTime, ForeignKey, Numeric, Integer, JSON, UniqueConstraint, Date
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID
from database import Base

def generate_uuid():
    """Gera um UUID v4 como string para uso como chave primária."""
    return str(uuid.uuid4())

class User(Base):
    """Representa um morador/usuário do sistema."""
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    name = Column(String(120), nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    group_memberships = relationship("GroupMember", back_populates="user", cascade="all, delete-orphan")

class Group(Base):
    """Representa um grupo de divisão de despesas (ex: república, apartamento)."""
    __tablename__ = "groups"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    name = Column(String(120), nullable=False)
    default_currency = Column(String(3), nullable=False)
    created_by_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    created_by = relationship("User", backref="createdGroups")
    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")

class GroupMember(Base):
    """Associação entre User e Group, com papel (OWNER, MEMBER)."""
    __tablename__ = "group_members"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(30), default="MEMBER", nullable=False)
    joined_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    user = relationship("User", back_populates="group_memberships")
    group = relationship("Group", back_populates="members")

    __table_args__ = (
        UniqueConstraint('user_id', 'group_id', name='uq_group_member_user_group'),
    )

class Category(Base):
    """Categoria de despesa (ex: Mercado, Aluguel, Lazer)."""
    __tablename__ = "categories"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    name = Column(String(80), unique=True, nullable=False)
    icon = Column(String(20), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

class Expense(Base):
    """Despesa registrada em um grupo, paga por um morador."""
    __tablename__ = "expenses"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    payer_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    category_id = Column(UUID(as_uuid=False), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False)
    description = Column(String(255), nullable=True)
    expense_date = Column(Date, nullable=False)
    receipt_url = Column(String(500), nullable=True)
    receipt_name = Column(String(255), nullable=True)
    receipt_mime_type = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    group = relationship("Group", backref="expenses")
    payer = relationship("User")
    category = relationship("Category", backref="expenses")
    splits = relationship("ExpenseSplit", back_populates="expense", cascade="all, delete-orphan")

class ExpenseSplit(Base):
    """Parcela de uma despesa devida por um morador específico."""
    __tablename__ = "expense_splits"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    expense_id = Column(UUID(as_uuid=False), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    debtor_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    amount_owed = Column(Numeric(12, 2), nullable=False)

    expense = relationship("Expense", back_populates="splits")
    debtor = relationship("User")

    __table_args__ = (
        UniqueConstraint('expense_id', 'debtor_id', name='uq_expense_split_expense_debtor'),
    )

class Settlement(Base):
    """Liquidação de dívida entre dois moradores."""
    __tablename__ = "settlements"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    payer_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    receiver_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False)
    settled_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    group = relationship("Group", backref="settlements")
    payer = relationship("User", foreign_keys=[payer_id])
    receiver = relationship("User", foreign_keys=[receiver_id])

class ActivityLog(Base):
    """Log de atividades para auditoria e histórico do grupo."""
    __tablename__ = "activity_logs"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action_type = Column(String(50), nullable=False)
    action_description = Column(Text, nullable=False)
    metadata_ = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    group = relationship("Group", backref="activity_logs")
    actor = relationship("User")

class FixedBill(Base):
    """Conta fixa recorrente do grupo (ex: internet, aluguel)."""
    __tablename__ = "fixed_bills"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(120), nullable=False)
    due_date = Column(Date, nullable=False)
    is_paid = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    group = relationship("Group", backref="fixed_bills")

class FavorCredit(Base):
    """Crédito de favor entre dois moradores (ex: lavou louça, limpou banheiro)."""
    __tablename__ = "favor_credits"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    creditor_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    debtor_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    description = Column(String(255), nullable=False)
    credits = Column(Integer, default=1, nullable=False)
    status = Column(String(30), default="OPEN", nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    settled_at = Column(DateTime(timezone=True), nullable=True)

    group = relationship("Group", backref="favor_credits")
    creditor = relationship("User", foreign_keys=[creditor_id])
    debtor = relationship("User", foreign_keys=[debtor_id])

class PantryItem(Base):
    """Item da despensa compartilhada do grupo."""
    __tablename__ = "pantry_items"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(120), nullable=False)
    quantity = Column(String(80), nullable=False)
    last_purchased_by_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    group = relationship("Group", backref="pantry_items")
    last_purchased_by = relationship("User")

    __table_args__ = (
        UniqueConstraint('group_id', 'name', name='uq_pantry_item_group_name'),
    )

class PantryPurchase(Base):
    """Registro de compra de um item de despensa, vinculado a uma despesa."""
    __tablename__ = "pantry_purchases"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    item_id = Column(UUID(as_uuid=False), ForeignKey("pantry_items.id", ondelete="SET NULL"), nullable=True)
    purchaser_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    item_name = Column(String(120), nullable=False)
    quantity = Column(String(80), nullable=False)
    purchased_at = Column(Date, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    expense_id = Column(UUID(as_uuid=False), ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True)

    group = relationship("Group", backref="pantry_purchases")
    item = relationship("PantryItem", backref="purchases")
    purchaser = relationship("User")
    expense = relationship("Expense")
