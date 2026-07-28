"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const TRADES = ["hvac", "landscaping", "plumbing", "electrical", "roofing", "general", "other"];

interface Vendor {
  vendor_id: number;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  trade: string | null;
  notes: string | null;
  total_paid: number;
  invoice_count: number;
}

function fmt(n: number) {
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPhone(raw: string | null) {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}

function Input({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

function Select({ label, value, onChange, options, nullable }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; nullable?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        {nullable && <option value="">— None —</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Vendor row ───────────────────────────────────────────────────────────────

function VendorRow({ vendor, onChanged }: { vendor: Vendor; onChanged: () => void }) {
  const [open, setOpen]       = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);

  const [company, setCompany]       = useState(vendor.company_name);
  const [contact, setContact]       = useState(vendor.contact_name ?? "");
  const [phone, setPhone]           = useState(fmtPhone(vendor.phone));
  const [email, setEmail]           = useState(vendor.email ?? "");
  const [trade, setTrade]           = useState(vendor.trade ?? "");
  const [notes, setNotes]           = useState(vendor.notes ?? "");

  async function save() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/vendors/${vendor.vendor_id}`, {
      company_name: company,
      contact_name: contact || null,
      phone: phone || null,
      email: email || null,
      trade: trade || null,
      notes: notes || null,
    });
    setSaving(false);
    setEditing(false);
    onChanged();
  }

  const tradeBadgeColor: Record<string, string> = {
    hvac: "bg-blue-100 text-blue-700",
    plumbing: "bg-cyan-100 text-cyan-700",
    electrical: "bg-yellow-100 text-yellow-700",
    landscaping: "bg-green-100 text-green-700",
    roofing: "bg-orange-100 text-orange-700",
    general: "bg-gray-100 text-gray-600",
    other: "bg-gray-100 text-gray-500",
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left">
        <div className="flex items-center gap-3">
          <div>
            <span className="font-semibold text-gray-900">{vendor.company_name}</span>
            {vendor.contact_name && (
              <span className="ml-2 text-sm text-gray-400">{vendor.contact_name}</span>
            )}
          </div>
          {vendor.trade && (
            <span className={`text-xs px-2 py-0.5 rounded font-medium capitalize ${tradeBadgeColor[vendor.trade] ?? tradeBadgeColor.other}`}>
              {vendor.trade}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {vendor.invoice_count > 0 && (
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-900">{fmt(vendor.total_paid)}</p>
              <p className="text-xs text-gray-400">{vendor.invoice_count} invoice{vendor.invoice_count !== 1 ? "s" : ""}</p>
            </div>
          )}
          <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {/* Quick info */}
          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            {vendor.phone && <span>📞 {fmtPhone(vendor.phone)}</span>}
            {vendor.email && <span>✉️ {vendor.email}</span>}
            {vendor.notes && <span className="text-gray-400 italic">{vendor.notes}</span>}
          </div>

          <button onClick={() => setEditing((e) => !e)} className="text-xs text-blue-600 hover:underline">
            {editing ? "Cancel" : "Edit"}
          </button>

          {editing && (
            <div className="p-4 bg-gray-50 rounded-xl space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Company Name" value={company} onChange={setCompany} />
                <Input label="Contact Name" value={contact} onChange={setContact} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Phone" value={phone} onChange={setPhone} placeholder="(416) 555-0100" />
                <Input label="Email" value={email} onChange={setEmail} type="email" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Trade" value={trade} onChange={setTrade} nullable
                  options={TRADES.map((t) => ({ value: t, label: t }))} />
                <Input label="Notes" value={notes} onChange={setNotes} />
              </div>
              <button onClick={save} disabled={saving}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add vendor form ──────────────────────────────────────────────────────────

function AddVendorForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen]         = useState(false);
  const [company, setCompany]   = useState("");
  const [contact, setContact]   = useState("");
  const [phone, setPhone]       = useState("");
  const [email, setEmail]       = useState("");
  const [trade, setTrade]       = useState("");
  const [notes, setNotes]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!company.trim()) { setError("Company name is required."); return; }
    setSaving(true);
    setError("");
    try {
      await api("POST", "/api/v1/rental/vendors", {
        company_name: company,
        contact_name: contact || null,
        phone: phone || null,
        email: email || null,
        trade: trade || null,
        notes: notes || null,
      });
      setOpen(false);
      setCompany(""); setContact(""); setPhone(""); setEmail(""); setTrade(""); setNotes("");
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add vendor");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Add Vendor
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-3">
      <p className="text-sm font-semibold text-gray-700">New Vendor</p>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Company Name" value={company} onChange={setCompany} placeholder="Acme Plumbing" />
        <Input label="Contact Name" value={contact} onChange={setContact} placeholder="Jane Smith" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Phone" value={phone} onChange={setPhone} placeholder="(416) 555-0100" />
        <Input label="Email" value={email} onChange={setEmail} type="email" placeholder="jane@acme.com" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select label="Trade" value={trade} onChange={setTrade} nullable
          options={TRADES.map((t) => ({ value: t, label: t }))} />
        <Input label="Notes" value={notes} onChange={setNotes} />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Adding…" : "Add Vendor"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VendorsPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [tradeFilter, setTradeFilter] = useState("");

  async function load() {
    const v = await api<Vendor[]>("GET", "/api/v1/rental/vendors");
    setVendors(v);
    setLoading(false);
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    load();
  }, [router]);

  const filtered = useMemo(() => {
    let list = vendors;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((v) =>
        v.company_name.toLowerCase().includes(q) ||
        (v.contact_name ?? "").toLowerCase().includes(q) ||
        (v.trade ?? "").toLowerCase().includes(q)
      );
    }
    if (tradeFilter) list = list.filter((v) => v.trade === tradeFilter);
    return list;
  }, [vendors, search, tradeFilter]);

  const totalPaid = useMemo(() => vendors.reduce((s, v) => s + Number(v.total_paid), 0), [vendors]);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
        {vendors.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-gray-400">Total paid to all vendors</p>
            <p className="text-lg font-bold text-gray-900">{fmt(totalPaid)}</p>
          </div>
        )}
      </div>

      <AddVendorForm onAdded={load} />

      {/* Search + trade filter */}
      <div className="flex gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by company, contact or trade…"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={tradeFilter} onChange={(e) => setTradeFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All trades</option>
          {TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400">
          {search || tradeFilter ? "No vendors match the current filter." : "No vendors yet. Add one above."}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((v) => (
            <VendorRow key={v.vendor_id} vendor={v} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
