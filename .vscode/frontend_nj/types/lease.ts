export interface LeaseMember {
  member_id: number;
  lease_id: number;
  tenant_id: number;
  monthly_obligation: number;
  is_primary: boolean;
  member_type: string;
  sublease_start: string | null;
  sublease_end: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
}

export interface Lease {
  lease_id: number;
  space_id: number;
  start_date: string;
  end_date: string | null;
  total_rent: number;
  security_deposit: number | null;
  lmr_deposit: number | null;
  notes: string | null;
  lease_type_code: number;
  status_code: number;
  lease_type_label: string;
  status_label: string;
  space_name: string;
  unit_number: string;
  address: string;
  member_count: number;
  members: LeaseMember[];
}

export interface LeaseStatus {
  code: number;
  label: string;
}
