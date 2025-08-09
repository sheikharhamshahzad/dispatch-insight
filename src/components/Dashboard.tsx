import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, TrendingDown, Package, RefreshCw, ShoppingCart, AlertCircle, Truck, Package2, Pencil, Save } from "lucide-react";
import { parseProductDescriptions } from "@/components/Orders"; // Import the helper function
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DashboardStats {
  totalDispatched: number;
  totalDelivered: number;
  totalReturned: number;
  returnsReceived: number;
  totalRevenue: number;
  totalCourierFees: number;
  totalAdSpend: number;
  totalCOGS: number;
  totalPackagingCost: number;
  totalSalesTax: number;
  netProfit: number;
  avgCourierFee: number;
}

interface InventoryItem {
  id: string;
  name: string;
  current_stock: number;
  cogs: number;
}

export function Dashboard() {
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [salesTax, setSalesTax] = useState(0);
  const [salesTaxInput, setSalesTaxInput] = useState("0");
  const [isSalesTaxEditing, setIsSalesTaxEditing] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalDispatched: 0,
    totalDelivered: 0,
    totalReturned: 0,
    returnsReceived: 0,
    totalRevenue: 0,
    totalCourierFees: 0,
    totalAdSpend: 0,
    totalCOGS: 0,
    totalPackagingCost: 0,
    totalSalesTax: 0,
    netProfit: 0,
    avgCourierFee: 0,
  });
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isLoadingSalesTax, setIsLoadingSalesTax] = useState(true);

  // Fetch saved sales tax from Supabase when component mounts
  useEffect(() => {
    async function fetchSalesTax() {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('value')
          .eq('key', 'sales_tax')
          .single();
        
        if (error) {
          console.error('Error fetching sales tax setting:', error);
          return;
        }
        
        if (data) {
          const taxValue = parseFloat(data.value);
          if (!isNaN(taxValue)) {
            setSalesTax(taxValue);
            setSalesTaxInput(taxValue.toString());
            setIsSalesTaxEditing(false);
          }
        }
      } catch (error) {
        console.error('Error in fetchSalesTax:', error);
      } finally {
        setIsLoadingSalesTax(false);
      }
    }
    
    fetchSalesTax();
  }, []);

  useEffect(() => {
    if (!isLoadingSalesTax) {
      fetchDashboardData();
    }
  }, [selectedMonth, salesTax, isLoadingSalesTax]);

  const handleSaveClick = async () => {
    const taxValue = parseFloat(salesTaxInput);
    if (!isNaN(taxValue) && taxValue >= 0) {
      try {
        // Update the sales tax in Supabase
        const { error } = await supabase
          .from('settings')
          .update({ value: taxValue.toString(), updated_at: new Date().toISOString() })
          .eq('key', 'sales_tax');
        
        if (error) {
          console.error('Error updating sales tax:', error);
          return;
        }
        
        // Update local state
        setSalesTax(taxValue);
        setIsSalesTaxEditing(false);
      } catch (error) {
        console.error('Error in handleSaveClick:', error);
      }
    }
  };

  const handleEditClick = () => {
    setIsSalesTaxEditing(true);
    setSalesTaxInput(salesTax.toString());
  };

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

    // Fetch packaging costs data
    const { data: packagingCosts } = await supabase
      .from('packaging_costs')
      .select('amount')
      .gte('date', startDate)
      .lte('date', endDate);

    // Fetch inventory data
    const { data: inventoryData } = await supabase
      .from('products')
      .select('*');

    if (orders && adCosts && packagingCosts && inventoryData) {
      // Create a map of product names to COGS values
      const cogsMap: Record<string, number> = {};
      inventoryData.forEach(product => {
        cogsMap[product.name.toLowerCase()] = product.cogs;
      });

      // Process orders and calculate statistics
      const totalDispatched = orders.length;
      const totalDelivered = orders.filter(order => order.order_status === 'delivered').length;
      const totalReturned = orders.filter(order => order.order_status === 'returned').length;
      const returnsReceived = orders.filter(order => order.return_received).length;
      const totalRevenue = orders
        .filter(order => order.order_status === 'delivered')
        .reduce((sum, order) => sum + (order.amount || 0), 0);
      
      // Calculate courier fees (for all orders)
      const totalCourierFees = orders.reduce((sum, order) => sum + (order.courier_fee || 0), 0);
      const avgCourierFee = orders.length > 0 ? totalCourierFees / orders.length : 0;
      
      const totalAdSpend = adCosts.reduce((sum, cost) => sum + cost.amount, 0);
      
      // Calculate packaging costs
      const totalPackagingCost = packagingCosts.reduce((sum, cost) => sum + cost.amount, 0);
      
      // Calculate sales tax
      const totalSalesTax = (salesTax / 100) * totalRevenue;
      
      // Calculate COGS only for orders that aren't marked as returned/received
      const activeOrders = orders.filter(order => order.return_received !== true);
      let totalCOGS = 0;
      
      activeOrders.forEach(order => {
        if (!order.product_name) return;
        
        const parsedProducts = parseProductDescriptions(order.product_name);
        
        parsedProducts.forEach(({ product, quantity }) => {
          const productNameLower = product.toLowerCase();
          // Try to find an exact match first
          let productCOGS = cogsMap[productNameLower];
          
          // If no exact match, try to find a partial match
          if (productCOGS === undefined) {
            const matchingProduct = Object.keys(cogsMap).find(key => 
              productNameLower.includes(key) || key.includes(productNameLower)
            );
            if (matchingProduct) {
              productCOGS = cogsMap[matchingProduct];
            }
          }
          
          if (productCOGS !== undefined) {
            totalCOGS += productCOGS * quantity;
          }
        });
      });

      // Update net profit calculation to include sales tax
      const netProfit = totalRevenue - totalCourierFees - totalAdSpend - totalCOGS - totalPackagingCost - totalSalesTax;

      setStats({
        totalDispatched,
        totalDelivered,
        totalReturned,
        returnsReceived,
        totalRevenue,
        totalCourierFees,
        totalAdSpend,
        totalCOGS,
        totalPackagingCost,
        totalSalesTax,
        netProfit,
        avgCourierFee,
      });

      setInventory(inventoryData);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Dashboard Overview</h2>
        <div className="flex gap-4 items-center">
          {/* Sales Tax Input */}
          <div className="flex items-center gap-2">
            <div className="flex items-center">
              <span className="text-sm font-medium mr-2">Sales Tax (%)</span>
              {isLoadingSalesTax ? (
                <div className="w-16 h-9 bg-gray-100 animate-pulse rounded-md"></div>
              ) : isSalesTaxEditing ? (
                <div className="flex items-center">
                  <Input 
                    type="number" 
                    className="w-16 h-9" 
                    value={salesTaxInput}
                    onChange={(e) => setSalesTaxInput(e.target.value)} 
                  />
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-9 w-9 ml-2" 
                    onClick={handleSaveClick}
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-medium bg-gray-100 py-1 px-3 rounded-md text-gray-500">
                    {salesTax}%
                  </span>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8" 
                    onClick={handleEditClick}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Month Selection */}
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
      </div>

      {/* Financial Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
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
            <p className="text-xs text-muted-foreground">Revenue - All Expenses</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Courier Fees</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">PKR {stats.totalCourierFees.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Total delivery charges</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ad Spend</CardTitle>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7h18" />
              <path d="m8 12 4 4 4-4" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">PKR {stats.totalAdSpend.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Marketing expenses</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Packaging</CardTitle>
            <Package2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">PKR {stats.totalPackagingCost.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Packaging materials</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sales Tax</CardTitle>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
              <path d="M2 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z"/>
              <path d="M12 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z"/>
              <path d="M7 14c3.22-2.91 4.29-8.75 5-12 1.66 2.38 4.94 9 5 12"/>
              <path d="M22 9c-4.29 0-7.14-2.33-10-7 5.71 0 10 4.67 10 7Z"/>
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">PKR {stats.totalSalesTax.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">{salesTax}% of Revenue</p>
          </CardContent>
        </Card>
      </div>

      {/* COGS card moved to second row */}
      <div className="grid gap-4 md:grid-cols-1">
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

      {/* Profit Analysis */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Profit Analysis</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
            <div className="flex flex-col justify-between p-3 border rounded-md">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">Profit Margin</span>
                <span className={`text-lg font-bold ${stats.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {stats.totalRevenue > 0 ? ((stats.netProfit / stats.totalRevenue) * 100).toFixed(1) : '0'}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Net profit as % of revenue</p>
            </div>
            
            <div className="flex flex-col justify-between p-3 border rounded-md">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">COGS</span>
                <span className="text-lg font-bold">
                  {stats.totalRevenue > 0 ? ((stats.totalCOGS / stats.totalRevenue) * 100).toFixed(1) : '0'}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Cost of goods sold</p>
            </div>
            
            <div className="flex flex-col justify-between p-3 border rounded-md">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">Courier</span>
                <span className="text-lg font-bold">
                  {stats.totalRevenue > 0 ? ((stats.totalCourierFees / stats.totalRevenue) * 100).toFixed(1) : '0'}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Shipping costs</p>
            </div>
            
            <div className="flex flex-col justify-between p-3 border rounded-md">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">Ad Spend</span>
                <span className="text-lg font-bold">
                  {stats.totalRevenue > 0 ? ((stats.totalAdSpend / stats.totalRevenue) * 100).toFixed(1) : '0'}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Marketing costs</p>
            </div>
            
            <div className="flex flex-col justify-between p-3 border rounded-md">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">Packaging</span>
                <span className="text-lg font-bold">
                  {stats.totalRevenue > 0 ? ((stats.totalPackagingCost / stats.totalRevenue) * 100).toFixed(1) : '0'}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Packaging materials</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Operations Overview */}
      <div className="grid gap-4 md:grid-cols-4">
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
            <CardTitle className="text-sm font-medium">Delivered Orders</CardTitle>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted-foreground">
              <path d="M5 12.55a11 11 0 0 1 14.08 0" />
              <path d="M1.42 9a16 16 0 0 1 21.16 0" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12" y2="20" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalDelivered}</div>
            <p className="text-xs text-muted-foreground">Successfully delivered</p>
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