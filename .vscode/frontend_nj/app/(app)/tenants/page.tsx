"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Tenant, ContactHistory, RefOption } from "@/types/tenant";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPhone(raw: string | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

function Input({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

function Select({ label, value, onChange, options, nullable }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { id: number; name: string }[]; nullable?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        {nullable && <option value="">— None —</option>}
        {options.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
      </select>
    </div>
  );
}

// ─── Contact history panel (lazy loaded) ─────────────────────────────────────

function ContactHistoryPanel({ tenantId }: { tenantId: number }) {
  const [history, setHistory] = useState<ContactHistory[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api<ContactHistory[]>("GET", `/api/v1/rental/tenants/${tenantId}/contact-history`)
      .then(setHistory)
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) return <p className="text-xs text-gray-400 animate-pulse">Loading history…</p>;
  if (!history?.length) return <p className="text-xs text-gray-400">No contact changes recorded yet.</p>;

  return (
    <div className="space-y-1.5">
      {history.map((h) => (
        <div key={h.history_id} className="flex items-center gap-3 text-xs text-gray-600">
          <span className="font-medium uppercase w-10">{h.contact_type}</span>
          <span>{h.contact_type === "phone" ? fmtPhone(h.value) : h.value}</span>
          <span className="text-gray-400">{h.effective_from} → {h.effective_to ?? "Current"}</span>
          {h.notes && h.notes !== "Auto-archived on update" && (
            <span className="text-gray-400 italic">{h.notes}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Tenant row ───────────────────────────────────────────────────────────────

function TenantRow({ tenant, idTypes, contactMethods, onChanged }: {
  tenant: Tenant;
  idTypes: RefOption[];
  contactMethods: RefOption[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [firstName, setFirstName]         = useState(tenant.first_name);
  const [lastName, setLastName]           = useState(tenant.last_name);
  const [email, setEmail]                 = useState(tenant.email ?? "");
  const [phone, setPhone]                 = useState(fmtPhone(tenant.phone));
  const [notes, setNotes]                 = useState(tenant.notes ?? "");
  const [idTypeId, setIdTypeId]           = useState(String(tenant.id_type_id ?? ""));
  const [idNumber, setIdNumber]           = useState(tenant.id_number ?? "");
  const [prefContactId, setPrefContactId] = useState(String(tenant.preferred_contact_id ?? ""));
  const [emailConsent, setEmailConsent]   = useState(tenant.email_consent);

  const name = `${tenant.first_name} ${tenant.last_name}`;
  const location = tenant.address
    ? `${tenant.address} — Unit ${tenant.unit_number} — ${tenant.space_name}`
    : "No active lease";
  const isActive = tenant.lease_status === "active";

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api("PATCH", `/api/v1/rental/tenants/${tenant.tenant_id}`, {
        first_name: firstName,
        last_name: lastName,
        email: email || null,
        phone: phone || null,
        notes: notes || null,
        id_type_id: idTypeId ? Number(idTypeId) : null,
        id_number: idNumber || null,
        preferred_contact_id: prefContactId ? Number(prefContactId) : null,
        email_consent: emailConsent,
      });
      setEditing(false);
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTenant() {
    try {
      await api("DELETE", `/api/v1/rental/tenants/${tenant.tenant_id}`);
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setConfirmDelete(false);
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Summary row */}
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left">
        <div className="flex items-center gap-3">
          <div>
            <span className="font-semibold text-gray-900">{name}</span>
            <span className="ml-3 text-xs text-gray-400">{location}</span>
            {tenant.monthly_obligation && (
              <span className="ml-2 text-xs text-gray-400">
                ${Number(tenant.monthly_obligation).toLocaleString()}/mo
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
            isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}>
            {isActive ? "Active" : "No Lease"}
          </span>
          <span className="text-gray-400">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Detail panel */}
      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">

          {/* Quick info strip */}
          <div className="flex gap-6 text-sm text-gray-600">
            {tenant.email && <span>✉️ {tenant.email}</span>}
            {tenant.phone && <span>📞 {fmtPhone(tenant.phone)}</span>}
            {tenant.id_type_name && <span>🪪 {tenant.id_type_name}{tenant.id_number ? ` · ${tenant.id_number}` : ""}</span>}
            {tenant.preferred_contact_name && <span>💬 Prefers {tenant.preferred_contact_name}</span>}
            {tenant.email_consent && <span className="text-green-600">✓ Email consent</span>}
          </div>

          {/* Edit toggle */}
          <div className="flex items-center gap-3">
            <button onClick={() => setEditing((e) => !e)}
              className="text-xs text-blue-600 hover:underline">
              {editing ? "Cancel" : "Edit"}
            </button>
            <button onClick={() => setShowHistory((s) => !s)}
              className="text-xs text-gray-500 hover:underline">
              {showHistory ? "Hide History" : "Contact History"}
            </button>
          </div>

          {/* Edit form */}
          {editing && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-xl">
              <div className="grid grid-cols-2 gap-3">
                <Input label="First Name" value={firstName} onChange={setFirstName} />
                <Input label="Last Name" value={lastName} onChange={setLastName} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Input label="Email" value={email} onChange={setEmail} type="email" />
                <Input label="Phone" value={phone} onChange={setPhone} placeholder="(416) 555-0100" />
                <Input label="ID Number" value={idNumber} onChange={setIdNumber} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="ID Type" value={idTypeId} onChange={setIdTypeId} options={idTypes} nullable />
                <Select label="Preferred Contact" value={prefContactId} onChange={setPrefContactId}
                  options={contactMethods} nullable />
              </div>
              <Input label="Notes" value={notes} onChange={setNotes} />
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={emailConsent}
                  onChange={(e) => setEmailConsent(e.target.checked)}
                  className="rounded border-gray-300" />
                Email consent
              </label>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex items-center gap-3">
                <button onClick={save} disabled={saving}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
                {!confirmDelete ? (
                  <button onClick={() => setConfirmDelete(true)}
                    className="text-xs text-red-600 hover:underline">
                    Remove Tenant
                  </button>
                ) : (
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-red-600">Remove {name}?</span>
                    <button onClick={deleteTenant} className="text-red-700 font-semibold hover:underline">Yes</button>
                    <button onClick={() => setConfirmDelete(false)} className="text-gray-500 hover:underline">Cancel</button>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Contact history — lazy loaded when toggled */}
          {showHistory && (
            <div className="p-4 bg-gray-50 rounded-xl space-y-2">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Contact History</p>
              <p className="text-xs text-gray-400">Phone and email changes are logged automatically when you save.</p>
              <ContactHistoryPanel tenantId={tenant.tenant_id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add tenant form ──────────────────────────────────────────────────────────

function AddTenantForm({ idTypes, contactMethods, onAdded }: {
  idTypes: RefOption[];
  contactMethods: RefOption[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [email, setEmail]         = useState("");
  const [phone, setPhone]         = useState("");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName || !lastName) { setError("First and last name are required."); return; }
    setSaving(true);
    setError("");
    try {
      await api("POST", "/api/v1/rental/tenants", {
        first_name: firstName, last_name: lastName,
        email: email || null, phone: phone || null, notes: notes || null,
      });
      setOpen(false);
      setFirstName(""); setLastName(""); setEmail(""); setPhone(""); setNotes("");
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add tenant");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Add Tenant
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-4">
      <p className="text-sm font-semibold text-gray-700">New Tenant</p>
      <div className="grid grid-cols-2 gap-3">
        <Input label="First Name" value={firstName} onChange={setFirstName} />
        <Input label="Last Name" value={lastName} onChange={setLastName} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Email" value={email} onChange={setEmail} type="email" />
        <Input label="Phone" value={phone} onChange={setPhone} placeholder="(416) 555-0100" />
      </div>
      <Input label="Notes" value={notes} onChange={setNotes} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Adding…" : "Add Tenant"}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="text-sm text-gray-400 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TenantsPage() {
  const router = useRouter();
  const [tenants, setTenants]           = useState<Tenant[]>([]);
  const [idTypes, setIdTypes]           = useState<RefOption[]>([]);
  const [contactMethods, setContactMethods] = useState<RefOption[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState("");
  const [propFilter, setPropFilter]     = useState("All");
  const [tab, setTab]                   = useState<"active" | "past">("active");

  async function load() {
    const [t, id, cm] = await Promise.all([
      api<Tenant[]>("GET", "/api/v1/rental/tenants"),
      api<{ type_id: number; name: string }[]>("GET", "/api/v1/rental/ref/id-types"),
      api<{ method_id: number; name: string }[]>("GET", "/api/v1/rental/ref/contact-methods"),
    ]);
    setTenants(t);
    setIdTypes(id.map((x) => ({ id: x.type_id, name: x.name })));
    setContactMethods(cm.map((x) => ({ id: x.method_id, name: x.name })));
    setLoading(false);
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    load();
  }, [router]);

  const properties = useMemo(() =>
    ["All", ...Array.from(new Set(tenants.map((t) => t.address).filter(Boolean) as string[]))],
    [tenants]
  );

  const filtered = useMemo(() => {
    let list = tenants;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        t.first_name.toLowerCase().includes(q) || t.last_name.toLowerCase().includes(q)
      );
    }
    if (propFilter !== "All") list = list.filter((t) => t.address === propFilter);
    return list;
  }, [tenants, search, propFilter]);

  const dedupe = (list: Tenant[]) =>
    list.filter((t, i, arr) => arr.findIndex((x) => x.tenant_id === t.tenant_id) === i);

  const active = dedupe(filtered.filter((t) => t.lease_status === "active"));
  const past   = dedupe(filtered.filter((t) => t.lease_status !== "active"));
  const shown  = tab === "active" ? active : past;

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>

      <AddTenantForm idTypes={idTypes} contactMethods={contactMethods} onAdded={load} />

      {/* Search + filter */}
      <div className="flex gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={propFilter}
          onChange={(e) => setPropFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {properties.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["active", "past"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t === "active" ? `Active (${active.length})` : `Past / No Lease (${past.length})`}
          </button>
        ))}
      </div>

      {/* Tenant list */}
      {shown.length === 0 ? (
        <p className="text-sm text-gray-400">
          {search || propFilter !== "All" ? "No tenants match the current filter." : `No ${tab} tenants.`}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((t) => (
            <TenantRow key={t.tenant_id} tenant={t}
              idTypes={idTypes} contactMethods={contactMethods} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
