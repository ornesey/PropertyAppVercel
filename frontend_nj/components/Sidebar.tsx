"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "@/lib/api";

const NAV = [
  { href: "/dashboard",    icon: "🏠", label: "Dashboard" },
  { href: "/properties",   icon: "🏢", label: "Properties" },
  { href: "/tenants",      icon: "👥", label: "Tenants" },
  { href: "/leases",       icon: "📋", label: "Leases" },
  { href: "/notices",      icon: "📄", label: "Notices" },
  { href: "/payments",     icon: "💳", label: "Payments" },
  { href: "/maintenance",  icon: "🔧", label: "Maintenance" },
  { href: "/expenses",     icon: "💰", label: "Expenses" },
  { href: "/vendors",      icon: "🏪", label: "Vendors" },
];

const BOTTOM_NAV = [
  { href: "/team",     icon: "👨‍👩‍👧", label: "Team" },
  { href: "/settings", icon: "🏷️", label: "Settings" },
  { href: "/profile",  icon: "⚙️", label: "Profile" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function handleSignOut() {
    clearToken();
    router.push("/login");
  }

  return (
    <aside className="w-60 shrink-0 flex flex-col bg-white border-r border-gray-100 h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <span className="text-base font-semibold text-gray-900">🏠 Property Mgmt</span>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV.map(({ href, icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom — profile + sign out */}
      <div className="px-3 py-4 border-t border-gray-100 space-y-0.5">
        {BOTTOM_NAV.map(({ href, icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </Link>
          );
        })}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          <span className="text-base leading-none">🚪</span>
          Sign Out
        </button>
      </div>
    </aside>
  );
}
