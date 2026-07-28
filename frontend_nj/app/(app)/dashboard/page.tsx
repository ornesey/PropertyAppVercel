"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface DashboardData {
  spaces_total: number;
  spaces_occupied: number;
  occupancy_rate: number;
  rent_collected_this_month: number;
  rent_expected_this_month: number;
  active_tenant_count: number;
  outstanding_payment_count: number;
  late_payment_count: number;
  promised_payment_count: number;
  promised_payment_outstanding: number;
  overdue_maintenance_tasks: number;
  open_maintenance_requests: number;
  open_lease_tasks: number;
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col gap-1">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function AlertCard({
  label, value, color, href,
}: {
  label: string; value: number; color: string; href: string;
}) {
  const router = useRouter();
  const styles: Record<string, string> = {
    red:    "bg-red-50    border-red-100    text-red-700",
    yellow: "bg-yellow-50 border-yellow-100 text-yellow-700",
    orange: "bg-orange-50 border-orange-100 text-orange-700",
    blue:   "bg-blue-50   border-blue-100   text-blue-700",
    gray:   "bg-gray-50   border-gray-100   text-gray-400",
  };
  return (
    <button
      onClick={() => router.push(href)}
      className={`rounded-xl border p-4 flex flex-col gap-1 text-left w-full cursor-pointer transition-all hover:shadow-md active:scale-95 active:shadow-inner ${styles[color]}`}
    >
      <p className="text-xs font-medium">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </button>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    api<DashboardData>("GET", "/api/v1/rental/dashboard")
      .then(setData)
      .catch((err) => setError(err.message));
  }, [router]);

  if (error) return <p className="text-red-600 text-sm">{error}</p>;

  if (!data) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
  );

  const issues = data.outstanding_payment_count + data.overdue_maintenance_tasks +
    data.open_maintenance_requests + data.open_lease_tasks;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Row 1 — key metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Occupancy"
          value={`${data.occupancy_rate}%`}
          sub={`${data.spaces_occupied} of ${data.spaces_total} spaces`}
        />
        <MetricCard
          label="Rent Collected"
          value={`$${data.rent_collected_this_month.toLocaleString()}`}
          sub={`of $${data.rent_expected_this_month.toLocaleString()} expected this month`}
        />
        <MetricCard
          label="Active Tenants"
          value={String(data.active_tenant_count)}
        />
      </div>

      {/* Row 2 — action items */}
      <div>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Action Items</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <AlertCard
            label="Outstanding Payments"
            value={data.outstanding_payment_count}
            color={data.outstanding_payment_count > 0 ? "red" : "gray"}
            href="/payments?filter=outstanding"
          />
          <AlertCard
            label="Overdue Maintenance"
            value={data.overdue_maintenance_tasks}
            color={data.overdue_maintenance_tasks > 0 ? "orange" : "gray"}
            href="/maintenance?tab=tasks"
          />
          <AlertCard
            label="Open Requests"
            value={data.open_maintenance_requests}
            color={data.open_maintenance_requests > 0 ? "orange" : "gray"}
            href="/maintenance?tab=requests"
          />
          <AlertCard
            label="Lease Tasks"
            value={data.open_lease_tasks}
            color={data.open_lease_tasks > 0 ? "blue" : "gray"}
            href="/leases?tab=tasks"
          />
        </div>
      </div>

      {/* Summary banner */}
      {issues === 0 ? (
        <div className="rounded-xl bg-green-50 border border-green-100 px-5 py-4 text-green-700 text-sm">
          ✅ Everything looks good — no urgent items.
        </div>
      ) : (
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-5 py-4 text-amber-800 text-sm">
          ⚠️ {issues} item{issues !== 1 ? "s" : ""} need attention.
        </div>
      )}
    </div>
  );
}
