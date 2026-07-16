# 🏠 Split Lab — Fenda do Biquíni

> Sistema de controle de despesas compartilhadas para moradores de república/apartamento.

## 📋 Visão Geral

Split Lab é uma aplicação web full-stack para gestão financeira coletiva. Permite que moradores de uma república registrem gastos, dividam contas, acompanhem saldos e liquidem dívidas de forma transparente.

### Funcionalidades

- **Dashboard Consolidado** — Visão geral de saldos líquidos, alertas de contas vencidas e ranking de pontualidade
- **Commits de Gastos** — Registro de despesas com divisão igual ou personalizada, comprovantes anexados
- **Contas Fixas** — Controle de boletos recorrentes (aluguel, internet, luz) com alertas de vencimento
- **Despensa** — Registro de compras de mercado com divisão automática igualitária
- **Saldos e Liquidação** — Conciliação bilateral automática com caminhos passo a passo para zerar dívidas
- **Troca de Favores** — Sistema de créditos entre moradores
- **Histórico de Atividades** — Log completo de todas as operações

## 🛠️ Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 16 (React 19, Server Components) |
| Backend | FastAPI (Python 3.11) |
| Banco de Dados | PostgreSQL 16 |
| ORM | SQLAlchemy 2.0 |
| Containerização | Docker & Docker Compose |
| Estilização | Tailwind CSS v4 |

## 🏗️ Arquitetura

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │────▶│  Backend    │────▶│ PostgreSQL  │
│  Next.js    │     │  FastAPI    │     │             │
│  :3000      │     │  :8000      │     │  :5432      │
└─────────────┘     └─────────────┘     └─────────────┘
```

O frontend Next.js se comunica com o backend FastAPI via Server Actions (proxy HTTP). O backend gerencia toda a lógica de negócios e persistência via SQLAlchemy.

## 🚀 Como Rodar

### Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) (v20+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+)

### Execução

```bash
# Clonar o repositório
git clone <url-do-repo>
cd FendaDoBikini

# Subir todos os serviços
docker compose up --build

# Acessar a aplicação
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000/docs (Swagger)
```

### Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env` e configure conforme necessário:

```bash
cp .env.example .env
```

| Variável | Padrão | Descrição |
|---|---|---|
| `POSTGRES_USER` | `fendadobikini` | Usuário do PostgreSQL |
| `POSTGRES_PASSWORD` | `fendadobikini` | Senha do PostgreSQL |
| `POSTGRES_DB` | `fendadobikini` | Nome do banco de dados |
| `BACKEND_URL` | `http://backend:8000` | URL interna do backend |
| `AUTH_SECRET` | — | Segredo que assina os tokens de sessão (obrigatório em produção; `openssl rand -hex 32`) |

## 🔐 Autenticação

Todas as rotas (frontend e API) exigem login por morador:

- **Login**: e-mail + senha em `/login`. A sessão é um JWT (7 dias) guardado em cookie `httpOnly`.
- **Primeiro acesso**: morador cadastrado sem senha define a própria senha na tela de login ("Primeiro acesso? Definir minha senha"). Só funciona enquanto a senha não existe.
- **Bootstrap**: numa instalação vazia (zero moradores), o primeiro `POST /api/users` é permitido sem sessão — o primeiro morador criado já nasce **admin**. Depois disso o sistema tranca.
- **Papéis**: moradores `admin` gerenciam moradores (criar/editar/eliminar), definem/redefinem senhas de qualquer morador e controlam as configurações de acesso — tudo em **Parâmetros → Moradores**. Um admin não consegue remover o próprio papel.
- **Toggle de primeiro acesso**: admins podem desativar o auto-cadastro de senha ("Acesso e segurança" na tela de Moradores). Desativado, a opção some da tela de login e `POST /api/auth/setup-password` responde 403 — só admins definem senhas.
- **API**: endpoints `/api/*` exigem header `Authorization: Bearer <token>`; o token vem de `POST /api/auth/login`. Troca de senha em `POST /api/auth/change-password`; admin: `POST /api/users/set-password`, `PUT /api/settings/first-access`; config pública: `GET /api/auth/config`.

## 📁 Estrutura do Projeto

```
FendaDoBikini/
├── backend/                 # API FastAPI (Python)
│   ├── main.py              # Todos os endpoints da API
│   ├── models.py            # Modelos SQLAlchemy (12 tabelas)
│   ├── database.py          # Configuração do engine e sessão
│   ├── requirements.txt     # Dependências Python
│   └── Dockerfile           # Container do backend
├── src/                     # Frontend Next.js
│   ├── app/
│   │   ├── page.tsx         # Página principal (Server Component)
│   │   ├── actions.ts       # Server Actions (proxy para backend)
│   │   ├── expense-form.tsx # Formulário de gastos
│   │   ├── expense-history.tsx # Histórico de gastos
│   │   ├── confirm-submit-button.tsx # Botão de confirmação
│   │   ├── layout.tsx       # Layout raiz
│   │   ├── globals.css      # Estilos globais
│   │   └── receipts/[fileName]/route.ts # API de comprovantes
│   ├── lib/
│   │   ├── utils.ts         # Utilitários compartilhados
│   │   └── receipt.ts       # Utilitários de comprovantes
│   └── types/
│       └── dashboard.ts     # Interfaces TypeScript
├── docker-compose.yml       # Orquestração dos serviços
├── Dockerfile               # Container do frontend
├── package.json
├── tsconfig.json
└── README.md
```

## 🗃️ Modelos de Dados

| Modelo | Descrição |
|---|---|
| `User` | Moradores do grupo |
| `Group` | Grupos de moradores (república) |
| `GroupMember` | Vínculo morador↔grupo com papel |
| `Category` | Categorias de gastos (ex: Aluguel, Mercado) |
| `Expense` | Gastos registrados com valor e comprovante |
| `ExpenseSplit` | Divisão de cada gasto por participante |
| `Settlement` | Liquidações de saldo entre moradores |
| `FixedBill` | Contas fixas recorrentes |
| `FavorCredit` | Créditos de favores entre moradores |
| `PantryItem` | Itens da despensa |
| `PantryPurchase` | Histórico de compras de mercado |
| `ActivityLog` | Log de atividades do sistema |

## 🔮 Melhorias Futuras

- [x] **Autenticação** — Login por morador com sessões seguras (JWT + cookie httpOnly, primeiro acesso auto-serviço)
- [ ] **Alembic Migrations** — Migrações versionadas do banco de dados
- [ ] **Paginação** — Carregamento sob demanda no dashboard
- [ ] **Notificações** — Toasts de sucesso/erro e push notifications
- [ ] **PWA** — Progressive Web App com notificações de contas vencendo
- [ ] **Relatórios** — Exportação PDF com resumo mensal de gastos
- [ ] **Tema Claro** — Toggle dark/light mode
- [ ] **Testes** — Pytest (backend) + Playwright (frontend)
- [ ] **Componentização** — Refatorar page.tsx em módulos menores
- [ ] **Rate Limiting** — Proteção contra spam de requisições

## 📄 Licença

Projeto privado — uso interno.
