import { createContext, useContext, useState } from "react";

export type TabKey = "dashboard" | "orders" | "ad-costs" | "packaging" | "inventory";

type Ctx = {
  activeTab: TabKey;
  setActiveTab: (key: TabKey) => void;
};

const TabNavigationContext = createContext<Ctx | undefined>(undefined);

export function TabNavigationProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  return (
    <TabNavigationContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </TabNavigationContext.Provider>
  );
}

export function useTabNavigation() {
  const ctx = useContext(TabNavigationContext);
  if (!ctx) throw new Error("useTabNavigation must be used within TabNavigationProvider");
  return ctx;
}