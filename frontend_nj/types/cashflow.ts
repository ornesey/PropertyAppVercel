export interface CashFlowExpenseItem {
  expense_type_id: number | null;
  category: string;
  amount: number;
  source: "actual" | "manual" | "calculated";
}

export interface CashFlowProperty {
  property_id: number;
  address: string;
  income_collected: number;
  income_expected: number;
  mortgage_payment: number;
  expenses: CashFlowExpenseItem[];
  total_operating_expenses: number;
  total_expenses: number;
  net_cash_flow: number;
  mortgage_interest_tax_ref: number;
}

export interface CashFlowCommonExpense {
  category: string;
  amount: number;
  source: "actual" | "manual" | "calculated";
}

export interface CashFlowPortfolio {
  income_collected: number;
  income_expected: number;
  mortgage_payments: number;
  operating_expenses: number;
  common_expenses: number;
  net_cash_flow: number;
}

export interface CashFlowResponse {
  period: { year: number; month: number | null };
  properties: CashFlowProperty[];
  common_expenses: CashFlowCommonExpense[];
  common_total: number;
  portfolio: CashFlowPortfolio;
}

export interface Mortgage {
  mortgage_id: number;
  property_id: number;
  property_address: string;
  lender: string | null;
  monthly_payment: number;
  term_start: string;
  term_end: string | null;
  interest_rate: number | null;
  notes: string | null;
}
