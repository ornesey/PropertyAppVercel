export interface MaintenanceTask {
  task_id: number;
  task_name: string;
  category_id: number | null;
  category_name: string | null;
  description: string | null;
  frequency_days: number | null;
  last_completed_date: string | null;
  next_due_date: string;
  status: string;
  property_address: string | null;
  unit_number: string | null;
  days_until_due: number;
}

export interface MaintenanceRecord {
  record_id: number;
  completed_date: string;
  completed_by: string | null;
  notes: string | null;
  vendor_name: string | null;
}

export interface MaintenanceRequest {
  request_id: number;
  reported_date: string;
  description: string;
  priority: string;
  status: string;
  estimated_completion_date: string | null;
  actual_completion_date: string | null;
  notes: string | null;
  property_address: string;
  unit_number: string;
  reported_by: string;
  assigned_vendor: string | null;
}

export interface MaintenanceCategory {
  category_id: number;
  name: string;
}

export interface Vendor {
  vendor_id: number;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  trade: string | null;
  notes: string | null;
}
