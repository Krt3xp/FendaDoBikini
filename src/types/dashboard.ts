export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  createdAt: Date;
}

export interface CustomDecimal {
  toNumber(): number;
}

export interface GroupMember {
  id: string;
  userId: string;
  groupId: string;
  role: string;
  joinedAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface ExpenseSplit {
  id: string;
  expenseId: string;
  groupId: string;
  debtorId: string;
  amountOwed: CustomDecimal;
  debtor: {
    id: string;
    name: string;
    email: string;
  };
}

export interface Expense {
  id: string;
  groupId: string;
  payerId: string;
  categoryId: string | null;
  amount: CustomDecimal;
  currency: string;
  description: string | null;
  expenseDate: Date;
  receiptUrl: string | null;
  receiptName: string | null;
  receiptMimeType: string | null;
  createdAt: Date;
  updatedAt: Date;
  category: Category | null;
  payer: User;
  splits: ExpenseSplit[];
}

export interface ActivityLog {
  id: string;
  groupId: string;
  actorId: string | null;
  actionType: string;
  actionDescription: string;
  metadata: any;
  createdAt: Date;
  actor: User | null;
}

export interface FixedBill {
  id: string;
  groupId: string;
  name: string;
  dueDate: Date;
  isPaid: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FavorCredit {
  id: string;
  groupId: string;
  creditorId: string;
  debtorId: string;
  description: string;
  credits: number;
  status: string;
  createdAt: Date;
  settledAt: Date | null;
  creditor: {
    id: string;
    name: string;
  };
  debtor: {
    id: string;
    name: string;
  };
}

export interface PantryItem {
  id: string;
  groupId: string;
  name: string;
  quantity: string;
  lastPurchasedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastPurchasedBy: {
    id: string;
    name: string;
  } | null;
}

export interface PantryPurchase {
  id: string;
  groupId: string;
  itemId: string | null;
  purchaserId: string;
  itemName: string;
  quantity: string;
  purchasedAt: Date;
  createdAt: Date;
  purchaser: {
    id: string;
    name: string;
  };
  expenseId?: string | null;
  expense?: {
    id: string;
    amount: CustomDecimal;
    currency: string;
    receiptUrl: string | null;
    receiptName: string | null;
    receiptMimeType: string | null;
  } | null;
}

export interface Settlement {
  id: string;
  groupId: string;
  payerId: string;
  receiverId: string;
  amount: CustomDecimal;
  currency: string;
  settledAt: Date;
  createdAt: Date;
  payer: {
    id: string;
    name: string;
  };
  receiver: {
    id: string;
    name: string;
  };
}

export interface DashboardGroup {
  id: string;
  name: string;
  defaultCurrency: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: User;
  members: GroupMember[];
  expenses: Expense[];
  activityLogs: ActivityLog[];
  fixedBills: FixedBill[];
  favorCredits: FavorCredit[];
  pantryItems: PantryItem[];
  pantryPurchases: PantryPurchase[];
  settlements: Settlement[];
}

export interface DashboardData {
  users: User[];
  categories: Category[];
  groups: DashboardGroup[];
}
