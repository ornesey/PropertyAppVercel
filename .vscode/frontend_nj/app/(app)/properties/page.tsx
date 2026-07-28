"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Property, PropertyDetail, Unit, Space } from "@/types/property";

const PROPERTY_TYPES = ["single_family", "duplex", "apartment", "condo", "other"];

// ─── Small reusable bits ──────────────────────────────────────────────────────

function Badge({ children, color }: { children: React.ReactNode; color: "green" | "gray" }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
      color === "green" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
    }`}>
      {children}
    </span>
  );
}

function Spinner() {
  return <span className="text-sm text-gray-400 animate-pulse">Loading…</span>;
}

function Input({ label, value, onChange, required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}{required && " *"}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ─── Space row ────────────────────────────────────────────────────────────────

function SpaceRow({ space, onDeleted, onSaved }: {
  space: Space;
  onDeleted: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(space.space_name);
  const [notes, setNotes] = useState(space.notes ?? "");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/spaces/${space.space_id}`, {
      space_name: name, notes: notes || null,
    });
    setSaving(false);
    setEditing(false);
    onSaved();
  }

  async function deleteSpace() {
    await api("DELETE", `/api/v1/rental/spaces/${space.space_id}`);
    onDeleted();
  }

  const isVacant = !space.tenants;

  return (
    <div className="border border-gray-100 rounded-xl p-4 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge color={isVacant ? "gray" : "green"}>{isVacant ? "Vacant" : "Occupied"}</Badge>
          <span className="font-medium text-sm text-gray-800">{space.space_name}</span>
          {space.tenants && <span className="text-xs text-gray-500">— {space.tenants}</span>}
          {space.total_rent && <span className="text-xs text-gray-500">${Number(space.total_rent).toLocaleString()}/mo</span>}
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className="text-xs text-blue-600 hover:underline"
        >
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>

      {editing && (
        <div className="space-y-3 pt-2 border-t border-gray-100">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Space Name" value={name} onChange={setName} />
            <Input label="Notes" value={notes} onChange={setNotes} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {!confirming ? (
              <button onClick={() => setConfirming(true)} className="px-3 py-1.5 text-xs text-red-600 hover:underline">
                Delete Space
              </button>
            ) : (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-red-600">Sure? This cannot be undone.</span>
                <button onClick={deleteSpace} className="text-red-700 font-semibold hover:underline">Yes, delete</button>
                <button onClick={() => setConfirming(false)} className="text-gray-500 hover:underline">Cancel</button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Unit section ─────────────────────────────────────────────────────────────

function UnitSection({ unit, onChanged }: { unit: Unit; onChanged: () => void }) {
  const [editingUnit, setEditingUnit] = useState(false);
  const [unitNumber, setUnitNumber] = useState(unit.unit_number);
  const [bedrooms, setBedrooms] = useState(String(unit.bedrooms ?? 1));
  const [bathrooms, setBathrooms] = useState(String(unit.bathrooms ?? 1));
  const [sqft, setSqft] = useState(String(unit.sq_ft ?? ""));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingSpace, setAddingSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveUnit() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/units/${unit.unit_id}`, {
      unit_number: unitNumber,
      bedrooms: Number(bedrooms),
      bathrooms: Number(bathrooms),
      sq_ft: sqft ? Number(sqft) : null,
    });
    setSaving(false);
    setEditingUnit(false);
    onChanged();
  }

  async function deleteUnit() {
    await api("DELETE", `/api/v1/rental/units/${unit.unit_id}`);
    onChanged();
  }

  async function addSpace() {
    if (!newSpaceName.trim()) return;
    await api("POST", `/api/v1/rental/units/${unit.unit_id}/spaces`, {
      space_name: newSpaceName.trim(),
    });
    setNewSpaceName("");
    setAddingSpace(false);
    onChanged();
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Unit header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="text-sm font-semibold text-gray-700">
          Unit {unit.unit_number}
          <span className="ml-2 font-normal text-gray-400 text-xs">
            {unit.bedrooms}bd / {unit.bathrooms}ba
            {unit.sq_ft ? ` · ${unit.sq_ft} sqft` : ""}
            {" · "}{unit.space_count} space{unit.space_count !== 1 ? "s" : ""}
          </span>
        </div>
        <button onClick={() => setEditingUnit(!editingUnit)} className="text-xs text-blue-600 hover:underline">
          {editingUnit ? "Cancel" : "Edit Unit"}
        </button>
      </div>

      {/* Edit unit form */}
      {editingUnit && (
        <div className="px-4 py-3 bg-white border-b border-gray-100 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <Input label="Unit #" value={unitNumber} onChange={setUnitNumber} />
            <Input label="Bedrooms" value={bedrooms} onChange={setBedrooms} />
            <Input label="Bathrooms" value={bathrooms} onChange={setBathrooms} />
            <Input label="Sq Ft" value={sqft} onChange={setSqft} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={saveUnit} disabled={saving}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : "Save Unit"}
            </button>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-600 hover:underline">
                Delete Unit
              </button>
            ) : (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-red-600">Delete unit and all its spaces?</span>
                <button onClick={deleteUnit} className="text-red-700 font-semibold hover:underline">Yes</button>
                <button onClick={() => setConfirmDelete(false)} className="text-gray-500 hover:underline">Cancel</button>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Spaces */}
      <div className="px-4 py-3 space-y-2">
        {unit.spaces.map((s) => (
          <SpaceRow key={s.space_id} space={s} onDeleted={onChanged} onSaved={onChanged} />
        ))}

        {/* Add space */}
        {addingSpace ? (
          <div className="flex items-center gap-2 pt-1">
            <input
              value={newSpaceName}
              onChange={(e) => setNewSpaceName(e.target.value)}
              placeholder="Space name (e.g. Room 1, Whole Unit)"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={addSpace} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
              Add
            </button>
            <button onClick={() => setAddingSpace(false)} className="text-xs text-gray-400 hover:underline">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setAddingSpace(true)}
            className="text-xs text-blue-600 hover:underline pt-1">
            + Add Space
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Property row (lazy loads detail on click) ────────────────────────────────

function PropertyRow({ property, provinces, onChanged }: {
  property: Property;
  provinces: { code: string; name: string; country: string }[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editingProp, setEditingProp] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingUnit, setAddingUnit] = useState(false);
  const [saving, setSaving] = useState(false);

  // Property edit fields
  const [address, setAddress] = useState(property.address);
  const [city, setCity] = useState(property.city);
  const [country, setCountry] = useState(property.country ?? "CA");
  const [provinceCode, setProvinceCode] = useState(property.province_code ?? "");
  const [zip, setZip] = useState(property.zip ?? "");
  const [propType, setPropType] = useState(property.property_type ?? "single_family");
  const [notes, setNotes] = useState(property.notes ?? "");

  // Add unit fields
  const [newUnitNum, setNewUnitNum] = useState("1");
  const [newBed, setNewBed] = useState("1");
  const [newBath, setNewBath] = useState("1");

  const caProvinces = provinces.filter((p) => p.country === "CA");
  const usStates    = provinces.filter((p) => p.country === "US");
  const regionList  = country === "CA" ? caProvinces : country === "US" ? usStates : [];

  async function loadDetail() {
    setLoadingDetail(true);
    const data = await api<PropertyDetail>(
      "GET",
      `/api/v1/rental/properties/${property.property_id}/with-units-and-spaces`
    ).catch(() => null);

    // Fallback: fetch from the flat list and find this property
    if (!data) {
      const all = await api<PropertyDetail[]>("GET", "/api/v1/rental/properties/with-units-and-spaces").catch(() => []);
      const found = all.find((p) => p.property_id === property.property_id) ?? null;
      setDetail(found);
    } else {
      setDetail(data);
    }
    setLoadingDetail(false);
  }

  function toggle() {
    if (!open && !detail) loadDetail();
    setOpen((o) => !o);
  }

  function reload() {
    setDetail(null);
    loadDetail();
    onChanged();
  }

  async function saveProp() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/properties/${property.property_id}`, {
      address, city, province_code: provinceCode, country,
      zip: zip || null, property_type: propType, notes: notes || null,
    });
    setSaving(false);
    setEditingProp(false);
    reload();
  }

  async function deleteProp() {
    await api("DELETE", `/api/v1/rental/properties/${property.property_id}`);
    onChanged();
  }

  async function addUnit() {
    await api("POST", `/api/v1/rental/properties/${property.property_id}/units`, {
      unit_number: newUnitNum,
      bedrooms: Number(newBed),
      bathrooms: Number(newBath),
    });
    setAddingUnit(false);
    setNewUnitNum("1");
    reload();
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Summary row — always visible, click to expand */}
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div>
          <span className="font-semibold text-gray-900">{property.address}</span>
          <span className="ml-2 text-sm text-gray-400">{property.city}</span>
          <span className="ml-3 text-xs text-gray-400">
            {property.unit_count} unit{property.unit_count !== 1 ? "s" : ""} · {property.space_count} space{property.space_count !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="text-gray-400 text-lg">{open ? "▲" : "▼"}</span>
      </button>

      {/* Detail panel — only rendered when open */}
      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-5">
          {loadingDetail && <Spinner />}

          {/* Property edit */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Property Details</span>
            <button onClick={() => setEditingProp(!editingProp)} className="text-xs text-blue-600 hover:underline">
              {editingProp ? "Cancel" : "Edit"}
            </button>
          </div>

          {editingProp && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-xl">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Address" value={address} onChange={setAddress} required />
                <Input label="City" value={city} onChange={setCity} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Select label="Country" value={country} onChange={(v) => { setCountry(v); setProvinceCode(""); }}
                  options={["CA", "US", "Other"]} />
                {regionList.length > 0 ? (
                  <Select
                    label={country === "CA" ? "Province" : "State"}
                    value={provinceCode}
                    onChange={setProvinceCode}
                    options={regionList.map((p) => p.code)}
                  />
                ) : (
                  <Input label="Province / State" value={provinceCode} onChange={setProvinceCode} />
                )}
                <Input label="Postal Code" value={zip} onChange={setZip} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Type" value={propType} onChange={setPropType} options={PROPERTY_TYPES} />
                <Input label="Notes" value={notes} onChange={setNotes} />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={saveProp} disabled={saving}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
                {!confirmDelete ? (
                  <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-600 hover:underline">
                    Delete Property
                  </button>
                ) : (
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-red-600">Delete property and all its units/spaces?</span>
                    <button onClick={deleteProp} className="text-red-700 font-semibold hover:underline">Yes, delete</button>
                    <button onClick={() => setConfirmDelete(false)} className="text-gray-500 hover:underline">Cancel</button>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Units */}
          {detail && (
            <div className="space-y-3">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Units & Spaces</span>
              {detail.units.length === 0 && (
                <p className="text-sm text-gray-400">No units yet.</p>
              )}
              {detail.units.map((u) => (
                <UnitSection key={u.unit_id} unit={u} onChanged={reload} />
              ))}

              {/* Add unit */}
              {addingUnit ? (
                <div className="border border-dashed border-gray-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-medium text-gray-500">Add Unit</p>
                  <div className="grid grid-cols-3 gap-3">
                    <Input label="Unit #" value={newUnitNum} onChange={setNewUnitNum} />
                    <Input label="Bedrooms" value={newBed} onChange={setNewBed} />
                    <Input label="Bathrooms" value={newBath} onChange={setNewBath} />
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={addUnit}
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                      Add Unit
                    </button>
                    <button onClick={() => setAddingUnit(false)} className="text-xs text-gray-400 hover:underline">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAddingUnit(true)}
                  className="text-xs text-blue-600 hover:underline">
                  + Add Unit
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add property form ────────────────────────────────────────────────────────

function AddPropertyForm({ provinces, onAdded }: {
  provinces: { code: string; name: string; country: string }[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("CA");
  const [provinceCode, setProvinceCode] = useState("");
  const [zip, setZip] = useState("");
  const [propType, setPropType] = useState("single_family");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const caProvinces = provinces.filter((p) => p.country === "CA");
  const usStates    = provinces.filter((p) => p.country === "US");
  const regionList  = country === "CA" ? caProvinces : country === "US" ? usStates : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!address || !city) { setError("Address and city are required."); return; }
    setSaving(true);
    setError("");
    await api("POST", "/api/v1/rental/properties", {
      address, city, province_code: provinceCode || null,
      country, zip: zip || null, property_type: propType,
    });
    setSaving(false);
    setOpen(false);
    setAddress(""); setCity(""); setZip(""); setProvinceCode("");
    onAdded();
  }

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
    >
      + Add Property
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-4">
      <p className="text-sm font-semibold text-gray-700">New Property</p>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Address" value={address} onChange={setAddress} required />
        <Input label="City" value={city} onChange={setCity} required />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Select label="Country" value={country} onChange={(v) => { setCountry(v); setProvinceCode(""); }}
          options={["CA", "US", "Other"]} />
        {regionList.length > 0 ? (
          <Select
            label={country === "CA" ? "Province" : "State"}
            value={provinceCode}
            onChange={setProvinceCode}
            options={regionList.map((p) => p.code)}
          />
        ) : (
          <Input label="Province / State" value={provinceCode} onChange={setProvinceCode} />
        )}
        <Input label="Postal Code" value={zip} onChange={setZip} />
      </div>
      <Select label="Type" value={propType} onChange={setPropType} options={PROPERTY_TYPES} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Adding…" : "Add Property"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [provinces, setProvinces] = useState<{ code: string; name: string; country: string }[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [props, provs] = await Promise.all([
      api<Property[]>("GET", "/api/v1/rental/properties"),
      api<{ code: string; name: string; country: string }[]>("GET", "/api/v1/rental/ref/provinces"),
    ]);
    setProperties(props);
    setProvinces(provs);
    setLoading(false);
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    load();
  }, [router]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Properties</h1>

      <AddPropertyForm provinces={provinces} onAdded={load} />

      {properties.length === 0 ? (
        <p className="text-sm text-gray-400">No properties yet. Add one above.</p>
      ) : (
        <div className="space-y-3">
          {properties.map((p) => (
            <PropertyRow key={p.property_id} property={p} provinces={provinces} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
