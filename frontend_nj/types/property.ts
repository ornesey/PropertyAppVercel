export interface Property {
  property_id: number;
  address: string;
  city: string;
  province_code: string | null;
  country: string | null;
  zip: string | null;
  property_type: string | null;
  notes: string | null;
  rentable_since: string | null;
  unit_count: number;
  space_count: number;
}

export interface Space {
  space_id: number;
  space_name: string;
  notes: string | null;
  lease_id: number | null;
  total_rent: number | null;
  lease_status: string | null;
  tenants: string | null;
}

export interface Unit {
  unit_id: number;
  unit_number: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sq_ft: number | null;
  notes: string | null;
  available_since: string | null;
  space_count: number;
  spaces: Space[];
}

export interface PropertyDetail extends Property {
  units: Unit[];
}
