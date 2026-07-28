export interface Expense {
  expense_id: number;
  expense_date: string;
  expense_type: string | null;
  amount: number;
  receipt_number: string | null;
  drive_url: string | null;
  notes: string | null;
  expense_type_id: number | null;
  vendor_id: number | null;
  invoice_id: number | null;
  type_name: string | null;
  property_address: string | null;
  vendor_name: string | null;
}

export interface ExpenseSummary {
  total: number;
  by_type: { expense_type: string; total: number }[];
  by_property: { property: string; total: number }[];
}

export interface ExpenseType {
  type_id: number;
  name: string;
}

export interface FixedCost {
  fixed_cost_id: number;
  name: string;
  amount: number;
  frequency: string;
  start_date: string;
  notes: string | null;
  active: boolean;
  property_id: number | null;
  property_address: string | null;
  expense_type_id: number | null;
  expense_type_name: string | null;
  vendor_id: number | null;
  vendor_name: string | null;
}
