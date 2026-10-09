export interface RentRollRow {
  tenant_id: number;
  tenant_name: string;
  monthly_obligation: number;
  is_primary: boolean;
  member_type: string;
  lease_id: number;
  start_date: string;
  end_date: string | null;
  space_name: string;
  unit_number: string;
  address: string;
  property_id: number;
  ledger_id: number | null;
  amount_due: number | null;
  amount_paid: number | null;
  paid_date: string | null;
  payment_status: "paid" | "partial" | "promised" | "late" | "pending" | "waived" | "not_generated" | null;
  promised_date: string | null;
  promised_amount: number | null;
  payment_method_label: string | null;
  payment_notes: string | null;
  adjustment_total: number;
}

export interface Promise {
  promise_id: number;
  ledger_id: number;
  promised_date: string;
  promised_amount: number;
  notes: string | null;
}

export interface Adjustment {
  adjustment_id: number;
  ledger_id: number;
  amount: number;
  reason: string;
  created_at: string;
}

export interface PaymentMethod {
  code: string;
  label: string;
}

export interface Transaction {
  transaction_id: number;
  amount: number;
  paid_date: string;
  payment_method_code: string | null;
  payment_method_label: string | null;
  notes: string | null;
}

export interface AdditionalIncomePayment {
  additional_income_payment_id: number;
  lease_id: number;
  tenant_id: number;
  income_type: string;
  amount: number;
  paid_date: string;
  payment_method_code: string | null;
  payment_method_label: string | null;
  notes: string | null;
  tenant_name: string;
  address: string;
  unit_number: string;
  space_name: string;
}

export interface AdditionalIncomeType {
  additional_income_type_id: number;
  name: string;
}
