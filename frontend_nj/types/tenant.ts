export interface Tenant {
  tenant_id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  id_type_id: number | null;
  id_number: string | null;
  preferred_contact_id: number | null;
  email_consent: boolean;
  id_type_name: string | null;
  preferred_contact_name: string | null;
  lease_id: number | null;
  monthly_obligation: number | null;
  lease_status: string | null;
  space_name: string | null;
  unit_number: string | null;
  address: string | null;
}

export interface ContactHistory {
  history_id: number;
  contact_type: "phone" | "email";
  value: string;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
}

export interface RefOption {
  id: number;
  name: string;
}
