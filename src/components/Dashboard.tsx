import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, TrendingDown, Package, RefreshCw, ShoppingCart, AlertCircle } from "lucide-react";

interface DashboardStats {
  totalDispatched: number;
  totalReturned: number;
  returnsReceived: number;
  totalRevenue: number;
  totalCourierFees: number;
  totalAdSpend: number;
  totalCOGS: number;
  netProfit: number;
}

interface InventoryItem {
  id: string;
  name: string;
  current_stock: number;
  cogs: number;
}

export function Dashboard() {
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [stats, setStats] = useState<DashboardStats>({
    totalDispatched: 0,
    totalReturned: 0,
    returnsReceived: 0,
    totalRevenue: 0,
    totalCourierFees: 0,
    totalAdSpend: 0,
    totalCOGS: 0,
    netProfit: 0,
  });
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  useEffect(() => {
    fetchDashboardData();
  }, [selectedMonth]);

  const fetchDashboardData = async () => {
    const startDate = `${selectedMonth}-01`;
    const endDate = `${selectedMonth}-31`;

    // Fetch orders data
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .gte('dispatch_date', startDate)
      .lte('dispatch_date', endDate);

    // Fetch ad costs data
    const { data: adCosts } = await supabase
      .from('ad_costs')
      .select('amount')
      .gte('date', startDate)
      .lte('date', endDate);

    // Fetch inventory data
    const { data: inventoryData } = await supabase
      .from('products')
      .select('*');

    if (orders && adCosts && inventoryData) {
      const totalDispatched = orders.length;
      const totalReturned = orders.filter(order => order.order_status === 'returned').length;
      const returnsReceived = orders.filter(order => order.return_received).length;
      const totalRevenue = orders
        .filter(order => order.order_status === 'delivered')
        .reduce((sum, order) => sum + (order.amount || 0), 0);
      const totalCourierFees = orders.reduce((sum, order) => sum + (order.courier_fee || 0), 0);
      const totalAdSpend = adCosts.reduce((sum, cost) => sum + cost.amount, 0);
      
      // Calculate COGS for delivered orders
      const deliveredOrders = orders.filter(order => order.order_status === 'delivered');
      const totalCOGS = deliveredOrders.reduce((sum, order) => {
        const product = inventoryData.find(p => p.name === order.product_name);
        return sum + (product?.cogs || 0);
      }, 0);

      const netProfit = totalRevenue - totalCourierFees - totalAdSpend - totalCOGS;

      setStats({
        totalDispatched,
        totalReturned,
        returnsReceived,
        totalRevenue,
        totalCourierFees,
        totalAdSpend,
        totalCOGS,
        netProfit,
      });

      setInventory(inventoryData);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Dashboard Overview</h2>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select month" />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const date = new Date();
              date.setMonth(date.getMonth() - i);
              const value = date.toISOString().slice(0, 7);
              const label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
              return (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Financial Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">PKR {stats.totalRevenue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">From delivered orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            {stats.netProfit >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              PKR {stats.netProfit.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Revenue - Costs - COGS</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">PKR {(stats.totalCourierFees + stats.totalAdSpend).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Courier + Ad spend</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">COGS</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">PKR {stats.totalCOGS.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Cost of goods sold</p>
          </CardContent>
        </Card>
      </div>

      {/* Operations Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Parcels Dispatched</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalDispatched}</div>
            <p className="text-xs text-muted-foreground">Total orders sent out</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Returns</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalReturned}</div>
            <p className="text-xs text-muted-foreground">{stats.returnsReceived} received back</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Return Rate</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.totalDispatched > 0 ? ((stats.totalReturned / stats.totalDispatched) * 100).toFixed(1) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">Of total dispatched</p>
          </CardContent>
        </Card>
      </div>

      {/* Inventory Status */}
      <Card>
        <CardHeader>
          <CardTitle>Live Inventory Status</CardTitle>
          <CardDescription>Current stock levels for all products</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {inventory.map((item) => (
              <div key={item.id} className="p-4 border rounded-lg">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold">{item.name}</h4>
                    <p className="text-sm text-muted-foreground">COGS: PKR {item.cogs}</p>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${item.current_stock < 10 ? 'text-red-600' : 'text-green-600'}`}>
                      {item.current_stock}
                    </div>
                    <p className="text-xs text-muted-foreground">in stock</p>
                  </div>
                </div>
                {item.current_stock < 10 && (
                  <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Low stock alert
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}