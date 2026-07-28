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
  payment_status: string | null;
  promised_date: string | null;
  promised_amount: number | null;
  payment_method_label: string | null;
  payment_notes: string | null;
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
