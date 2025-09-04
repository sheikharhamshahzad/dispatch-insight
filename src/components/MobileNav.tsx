import { useEffect, useState } from "react";
import {
  Menu,
  X,
  BarChart3,
  Package,
  DollarSign,
  Package2,
  Layers,
} from "lucide-react";
import { useTabNavigation, type TabKey } from "@/contexts/TabNavigationContext";

type NavItem = {
  label: string;
  tab: TabKey;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", tab: "dashboard", icon: BarChart3 },
  { label: "Orders", tab: "orders", icon: Package },
  { label: "Ad Costs", tab: "ad-costs", icon: DollarSign },
  { label: "Packaging", tab: "packaging", icon: Package2 },
  { label: "Batch Inventory", tab: "batch-inventory", icon: Layers },
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const { setActiveTab, activeTab } = useTabNavigation();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const selectTab = (tab: TabKey) => {
    setActiveTab(tab);
    setOpen(false);
  };

  return (
    <>
      {open && (
        <button
          aria-label="Close navigation overlay"
          onClick={() => setOpen(false)}
          className="fixed inset-0 bg-black/40 backdrop-blur-[1px] md:hidden z-40"
        />
      )}

      <div
        className={[
          "fixed right-4 bottom-4 z-50 md:hidden",
          "origin-bottom-right transform transition-all duration-300 ease-out",
          open ? "scale-100 opacity-100" : "scale-0 opacity-0",
        ].join(" ")}
        aria-hidden={!open}
      >
        <div className="w-[min(92vw,380px)] max-w-sm rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-sm font-semibold">Menu</span>
            <button
              className="inline-flex items-center justify-center p-2 rounded-full hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-400"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="p-2">
            <ul className="grid grid-cols-2 gap-2">
              {NAV_ITEMS.map(({ label, tab, icon: Icon }) => (
                <li key={tab}>
                  <button
                    type="button"
                    onClick={() => selectTab(tab)}
                    className="w-full group flex items-center gap-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 p-3 transition-colors"
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-700 group-hover:bg-gray-200 transition-colors">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-medium">{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        className={[
          "fixed right-4 bottom-4 md:hidden z-50",
          "h-14 w-14 rounded-full shadow-lg",
          "bg-primary text-primary-foreground",
          "flex items-center justify-center",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/50",
          "transition-transform",
          open ? "scale-90" : "scale-100",
        ].join(" ")}
      >
        {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        <span className="sr-only">Toggle navigation</span>
      </button>
    </>
  );
}