"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type {
  MaintenanceTask, MaintenanceRecord,
  MaintenanceRequest, MaintenanceCategory, Vendor,
} from "@/types/maintenance";
import type { Property } from "@/types/property";

const today = new Date().toISOString().slice(0, 10);

const PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high:   "bg-orange-100 text-orange-700",
  normal: "bg-blue-100 text-blue-700",
  other:  "bg-gray-100 text-gray-500",
};

const STATUS_STYLE: Record<string, string> = {
  open:        "bg-yellow-100 text-yellow-700",
  in_progress: "bg-blue-100 text-blue-700",
  closed:      "bg-green-100 text-green-700",
};

// ─── Shared primitives ────────────────────────────────────────────────────────

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

// ─── Task completion history (lazy) ──────────────────────────────────────────

function TaskHistory({ taskId }: { taskId: number }) {
  const [records, setRecords] = useState<MaintenanceRecord[] | null>(null);

  useEffect(() => {
    api<MaintenanceRecord[]>("GET", `/api/v1/rental/maintenance/tasks/${taskId}/records`)
      .then(setRecords);
  }, [taskId]);

  if (!records) return <p className="text-xs text-gray-400 animate-pulse">Loading…</p>;
  if (!records.length) return <p className="text-xs text-gray-400">No completion records yet.</p>;

  return (
    <div className="space-y-1.5">
      {records.map((r) => (
        <div key={r.record_id} className="flex items-center gap-3 text-xs text-gray-600">
          <span className="text-green-600">✅</span>
          <span className="font-medium">{r.completed_date}</span>
          {r.vendor_name && <span className="text-gray-400">{r.vendor_name}</span>}
          {r.completed_by && <span className="text-gray-400">by {r.completed_by}</span>}
          {r.notes && <span className="text-gray-400 italic">{r.notes}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Recurring task row ───────────────────────────────────────────────────────

function TaskRow({ task, categories, vendors, onChanged }: {
  task: MaintenanceTask;
  categories: MaintenanceCategory[];
  vendors: Vendor[];
  onChanged: () => void;
}) {
  const [open, setOpen]           = useState(false);
  const [editing, setEditing]     = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]       = useState(false);

  // Edit fields
  const [name, setName]         = useState(task.task_name);
  const [catId, setCatId]       = useState(String(task.category_id ?? ""));
  const [desc, setDesc]         = useState(task.description ?? "");
  const [freqDays, setFreqDays] = useState(String(task.frequency_days ?? 90));
  const [nextDue, setNextDue]   = useState(task.next_due_date?.slice(0, 10) ?? today);

  // Complete fields
  const [compDate, setCompDate]   = useState(today);
  const [compVendor, setCompVendor] = useState("");
  const [compBy, setCompBy]       = useState("");
  const [compNotes, setCompNotes] = useState("");

  const isOverdue = task.days_until_due < 0;
  const isDueSoon = task.days_until_due >= 0 && task.days_until_due <= 7;

  async function save() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/maintenance/tasks/${task.task_id}`, {
      task_name: name,
      category_id: catId ? Number(catId) : null,
      description: desc || null,
      frequency_days: Number(freqDays) || null,
      next_due_date: nextDue,
    });
    setSaving(false);
    setEditing(false);
    onChanged();
  }

  async function complete(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await api("POST", `/api/v1/rental/maintenance/tasks/${task.task_id}/complete`, {
      completed_date: compDate,
      vendor_id: compVendor ? Number(compVendor) : null,
      completed_by: compBy || null,
      notes: compNotes || null,
    });
    setSaving(false);
    setCompleting(false);
    onChanged();
  }

  async function deleteTask() {
    await api("DELETE", `/api/v1/rental/maintenance/tasks/${task.task_id}`);
    onChanged();
  }

  const dueBadge = isOverdue
    ? <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-100 text-red-700">Overdue {Math.abs(task.days_until_due)}d</span>
    : isDueSoon
    ? <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-100 text-yellow-700">Due in {task.days_until_due}d</span>
    : <span className="text-xs px-2 py-0.5 rounded font-medium bg-gray-100 text-gray-500">Due {task.next_due_date?.slice(0, 10)}</span>;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left">
        <div className="flex items-center gap-3">
          <div>
            <span className="font-medium text-sm text-gray-900">{task.task_name}</span>
            {task.category_name && <span className="ml-2 text-xs text-gray-400">{task.category_name}</span>}
            {task.property_address && (
              <span className="ml-2 text-xs text-gray-400">
                — {task.property_address}{task.unit_number ? ` Unit ${task.unit_number}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dueBadge}
          <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">
          {task.description && <p className="text-sm text-gray-500">{task.description}</p>}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            {task.frequency_days && <span>Repeats every {task.frequency_days} days</span>}
            {task.last_completed_date && <span>Last done {task.last_completed_date}</span>}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setCompleting((c) => !c)}
              className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">
              {completing ? "Cancel" : "✅ Mark Complete"}
            </button>
            <button onClick={() => setEditing((e) => !e)} className="text-xs text-blue-600 hover:underline">
              {editing ? "Cancel Edit" : "Edit"}
            </button>
            <button onClick={() => { setShowHistory((s) => !s); }} className="text-xs text-gray-500 hover:underline">
              {showHistory ? "Hide History" : "History"}
            </button>
            {!confirming
              ? <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:underline">Delete</button>
              : <span className="flex items-center gap-1 text-xs">
                  <span className="text-red-600">Delete this task?</span>
                  <button onClick={deleteTask} className="text-red-700 font-semibold hover:underline">Yes</button>
                  <button onClick={() => setConfirming(false)} className="text-gray-400 hover:underline">No</button>
                </span>
            }
          </div>

          {/* Complete form */}
          {completing && (
            <form onSubmit={complete} className="p-3 bg-green-50 rounded-xl space-y-3">
              <p className="text-xs font-medium text-gray-600">Mark as Completed</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Completed Date" value={compDate} onChange={setCompDate} type="date" />
                <Input label="Completed By" value={compBy} onChange={setCompBy} placeholder="Name or team" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Vendor (optional)" value={compVendor} onChange={setCompVendor} nullable
                  options={vendors.map((v) => ({ value: String(v.vendor_id), label: v.company_name }))} />
                <Input label="Notes" value={compNotes} onChange={setCompNotes} />
              </div>
              <button type="submit" disabled={saving}
                className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </form>
          )}

          {/* Edit form */}
          {editing && (
            <div className="p-3 bg-gray-50 rounded-xl space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Task Name" value={name} onChange={setName} />
                <Select label="Category" value={catId} onChange={setCatId} nullable
                  options={categories.map((c) => ({ value: String(c.category_id), label: c.name }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Repeat Every (days)" value={freqDays} onChange={setFreqDays} type="number" />
                <Input label="Next Due Date" value={nextDue} onChange={setNextDue} type="date" />
              </div>
              <Input label="Description" value={desc} onChange={setDesc} />
              <button onClick={save} disabled={saving}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}

          {/* History */}
          {showHistory && (
            <div className="p-3 bg-gray-50 rounded-xl space-y-2">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Completion History</p>
              <TaskHistory taskId={task.task_id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add task form ────────────────────────────────────────────────────────────

interface UnitOption { unit_id: number; label: string; property_id: number; }

function AddTaskForm({ categories, properties, onAdded }: {
  categories: MaintenanceCategory[];
  properties: Property[];
  onAdded: () => void;
}) {
  const [open, setOpen]       = useState(false);
  const [name, setName]       = useState("");
  const [catId, setCatId]     = useState("");
  const [desc, setDesc]       = useState("");
  const [freqDays, setFreqDays] = useState("90");
  const [nextDue, setNextDue] = useState(today);
  const [scope, setScope]     = useState<"property" | "unit">("property");
  const [propId, setPropId]   = useState("");
  const [unitId, setUnitId]   = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (properties.length && !propId) setPropId(String(properties[0].property_id));
  }, [properties, propId]);

  const unitOptions = useMemo<UnitOption[]>(() => {
    const prop = properties.find((p) => String(p.property_id) === propId);
    return (prop as any)?.units?.map((u: any) => ({
      unit_id: u.unit_id,
      property_id: prop!.property_id,
      label: `Unit ${u.unit_number}`,
    })) ?? [];
  }, [properties, propId]);

  useEffect(() => {
    if (unitOptions.length) setUnitId(String(unitOptions[0].unit_id));
  }, [unitOptions]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Task name is required."); return; }
    setSaving(true);
    setError("");
    try {
      await api("POST", "/api/v1/rental/maintenance/tasks", {
        task_name: name,
        category_id: catId ? Number(catId) : null,
        description: desc || null,
        frequency_days: Number(freqDays) || null,
        next_due_date: nextDue,
        property_id: scope === "property" ? Number(propId) : null,
        unit_id: scope === "unit" ? Number(unitId) : null,
      });
      setOpen(false);
      setName(""); setDesc("");
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add task");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Add Recurring Task
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-3">
      <p className="text-sm font-semibold text-gray-700">New Recurring Task</p>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Task Name" value={name} onChange={setName} />
        <Select label="Category" value={catId} onChange={setCatId} nullable
          options={categories.map((c) => ({ value: String(c.category_id), label: c.name }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Repeat Every (days)" value={freqDays} onChange={setFreqDays} type="number" />
        <Input label="Next Due Date" value={nextDue} onChange={setNextDue} type="date" />
      </div>
      <Input label="Description" value={desc} onChange={setDesc} />
      <div className="flex items-center gap-4">
        <span className="text-xs font-medium text-gray-500">Scope:</span>
        {(["property", "unit"] as const).map((s) => (
          <label key={s} className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input type="radio" checked={scope === s} onChange={() => setScope(s)} className="accent-blue-600" />
            {s === "property" ? "Property-level" : "Unit-level"}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select label="Property" value={propId} onChange={setPropId}
          options={properties.map((p) => ({ value: String(p.property_id), label: p.address }))} />
        {scope === "unit" && (
          <Select label="Unit" value={unitId} onChange={setUnitId}
            options={unitOptions.map((u) => ({ value: String(u.unit_id), label: u.label }))} />
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Adding…" : "Add Task"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

// ─── Tenant request row ───────────────────────────────────────────────────────

function RequestRow({ req, vendors, onChanged }: {
  req: MaintenanceRequest;
  vendors: Vendor[];
  onChanged: () => void;
}) {
  const [open, setOpen]     = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [status, setStatus]           = useState(req.status);
  const [priority, setPriority]       = useState(req.priority);
  const [vendorId, setVendorId]       = useState(String(req.assigned_vendor ? vendors.find(v => v.company_name === req.assigned_vendor)?.vendor_id ?? "" : ""));
  const [estDate, setEstDate]         = useState(req.estimated_completion_date?.slice(0, 10) ?? "");
  const [actualDate, setActualDate]   = useState(req.actual_completion_date?.slice(0, 10) ?? "");
  const [notes, setNotes]             = useState(req.notes ?? "");

  async function save() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/maintenance/requests/${req.request_id}`, {
      status,
      priority,
      vendor_id: vendorId ? Number(vendorId) : null,
      estimated_completion_date: estDate || null,
      actual_completion_date: actualDate || null,
      notes: notes || null,
    });
    setSaving(false);
    setEditing(false);
    onChanged();
  }

  const prStyle = PRIORITY_STYLE[req.priority] ?? PRIORITY_STYLE.other;
  const stStyle = STATUS_STYLE[req.status] ?? "bg-gray-100 text-gray-500";

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900 line-clamp-1">{req.description}</span>
          </div>
          <div className="text-xs text-gray-400">
            {req.property_address} — Unit {req.unit_number} · {req.reported_by} · {req.reported_date?.slice(0, 10)}
            {req.assigned_vendor && <span className="ml-2">· {req.assigned_vendor}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${prStyle}`}>{req.priority}</span>
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${stStyle}`}>{req.status.replace("_", " ")}</span>
          <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-3">
          {req.notes && <p className="text-sm text-gray-500">{req.notes}</p>}
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing((e) => !e)} className="text-xs text-blue-600 hover:underline">
              {editing ? "Cancel" : "Edit"}
            </button>
          </div>
          {editing && (
            <div className="p-3 bg-gray-50 rounded-xl space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Select label="Status" value={status} onChange={setStatus}
                  options={["open", "in_progress", "closed"].map((s) => ({ value: s, label: s.replace("_", " ") }))} />
                <Select label="Priority" value={priority} onChange={setPriority}
                  options={["urgent", "high", "normal", "other"].map((s) => ({ value: s, label: s }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Assign Vendor" value={vendorId} onChange={setVendorId} nullable
                  options={vendors.map((v) => ({ value: String(v.vendor_id), label: v.company_name }))} />
                <Input label="Est. Completion" value={estDate} onChange={setEstDate} type="date" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Actual Completion" value={actualDate} onChange={setActualDate} type="date" />
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

// ─── Add request form ─────────────────────────────────────────────────────────

function AddRequestForm({ properties, vendors, onAdded }: {
  properties: Property[];
  vendors: Vendor[];
  onAdded: () => void;
}) {
  const [open, setOpen]         = useState(false);
  const [propId, setPropId]     = useState("");
  const [unitId, setUnitId]     = useState("");
  const [desc, setDesc]         = useState("");
  const [priority, setPriority] = useState("normal");
  const [vendorId, setVendorId] = useState("");
  const [notes, setNotes]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  useEffect(() => {
    if (properties.length && !propId) setPropId(String(properties[0].property_id));
  }, [properties, propId]);

  const unitOptions = useMemo(() => {
    const prop = properties.find((p) => String(p.property_id) === propId);
    return (prop as any)?.units?.map((u: any) => ({
      value: String(u.unit_id), label: `Unit ${u.unit_number}`,
    })) ?? [];
  }, [properties, propId]);

  useEffect(() => {
    if (unitOptions.length) setUnitId(unitOptions[0].value);
  }, [unitOptions]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!desc.trim() || !unitId) { setError("Description and unit are required."); return; }
    setSaving(true);
    setError("");
    try {
      await api("POST", "/api/v1/rental/maintenance/requests", {
        unit_id: Number(unitId),
        description: desc,
        priority,
        vendor_id: vendorId ? Number(vendorId) : null,
        notes: notes || null,
      });
      setOpen(false);
      setDesc(""); setNotes("");
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add request");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Add Request
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-3">
      <p className="text-sm font-semibold text-gray-700">New Tenant Request</p>
      <div className="grid grid-cols-2 gap-3">
        <Select label="Property" value={propId} onChange={setPropId}
          options={properties.map((p) => ({ value: String(p.property_id), label: p.address }))} />
        <Select label="Unit" value={unitId} onChange={setUnitId} options={unitOptions} />
      </div>
      <Input label="Description" value={desc} onChange={setDesc} placeholder="Describe the issue…" />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Priority" value={priority} onChange={setPriority}
          options={["urgent", "high", "normal", "other"].map((s) => ({ value: s, label: s }))} />
        <Select label="Assign Vendor (optional)" value={vendorId} onChange={setVendorId} nullable
          options={vendors.map((v) => ({ value: String(v.vendor_id), label: v.company_name }))} />
      </div>
      <Input label="Notes" value={notes} onChange={setNotes} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Adding…" : "Add Request"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function MaintenancePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tasks, setTasks]         = useState<MaintenanceTask[]>([]);
  const [requests, setRequests]   = useState<MaintenanceRequest[]>([]);
  const [categories, setCategories] = useState<MaintenanceCategory[]>([]);
  const [vendors, setVendors]     = useState<Vendor[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<"tasks" | "requests">("tasks");
  const [reqFilter, setReqFilter] = useState("all");

  async function load() {
    const [t, r, c, v, p] = await Promise.all([
      api<MaintenanceTask[]>("GET", "/api/v1/rental/maintenance/tasks"),
      api<MaintenanceRequest[]>("GET", "/api/v1/rental/maintenance/requests"),
      api<MaintenanceCategory[]>("GET", "/api/v1/rental/ref/maintenance-categories"),
      api<Vendor[]>("GET", "/api/v1/rental/vendors"),
      api<Property[]>("GET", "/api/v1/rental/properties/with-units-and-spaces"),
    ]);
    setTasks(t);
    setRequests(r);
    setCategories(c);
    setVendors(v);
    setProperties(p);
    setLoading(false);
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    const tabParam = searchParams.get("tab");
    if (tabParam === "requests") setTab("requests");
    else if (tabParam === "tasks") setTab("tasks");
    load();
  }, [router]);

  const overdueCount  = tasks.filter((t) => t.days_until_due < 0).length;
  const openReqCount  = requests.filter((r) => r.status === "open").length;

  const filteredRequests = useMemo(() => {
    if (reqFilter === "all") return requests;
    return requests.filter((r) => r.status === reqFilter);
  }, [requests, reqFilter]);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Maintenance</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button onClick={() => setTab("tasks")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "tasks" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}>
          Recurring Tasks
          {overdueCount > 0 && (
            <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">{overdueCount}</span>
          )}
        </button>
        <button onClick={() => setTab("requests")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "requests" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}>
          Tenant Requests
          {openReqCount > 0 && (
            <span className="ml-2 px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full">{openReqCount}</span>
          )}
        </button>
      </div>

      {/* Recurring tasks tab */}
      {tab === "tasks" && (
        <div className="space-y-4">
          <AddTaskForm categories={categories} properties={properties} onAdded={load} />
          {tasks.length === 0 ? (
            <p className="text-sm text-gray-400">No recurring tasks yet.</p>
          ) : (
            <div className="space-y-2">
              {tasks.map((t) => (
                <TaskRow key={t.task_id} task={t} categories={categories} vendors={vendors} onChanged={load} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tenant requests tab */}
      {tab === "requests" && (
        <div className="space-y-4">
          <AddRequestForm properties={properties} vendors={vendors} onAdded={load} />

          {/* Status filter */}
          <div className="flex gap-2">
            {["all", "open", "in_progress", "closed"].map((f) => (
              <button key={f} onClick={() => setReqFilter(f)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                  reqFilter === f ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}>
                {f === "all" ? "All" : f.replace("_", " ")}
                {f === "open" && openReqCount > 0 && ` (${openReqCount})`}
              </button>
            ))}
          </div>

          {filteredRequests.length === 0 ? (
            <p className="text-sm text-gray-400">No requests found.</p>
          ) : (
            <div className="space-y-2">
              {filteredRequests.map((r) => (
                <RequestRow key={r.request_id} req={r} vendors={vendors} onChanged={load} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>}>
      <MaintenancePageInner />
    </Suspense>
  );
}
