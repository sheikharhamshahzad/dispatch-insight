import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Upload, Download, Trash2, Calendar as CalendarIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";

// Import PDF.js
import * as pdfjs from 'pdfjs-dist';

// Try this alternative way to import the worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface Order {
  id: string;
  tracking_number: string;
  order_id: string;
  customer_name: string;
  customer_address: string;
  customer_phone: string;
  product_name: string;
  amount: number;
  order_status: string;
  dispatch_date: string;
  return_received: boolean;
  courier_fee: number;
  customer_city: string;
}

interface PostExResponse {
  statusCode: string;
  statusMessage: string;
  dist: {
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    invoicePayment: number;
    orderDetail: string;
    orderPickupDate: string;
    orderRefNumber: string;
    orderDeliveryDate: string;
    transactionTax: number;
    transactionFee: number;
    trackingNumber: string;
    transactionDate: string;
    upfrontPayment: number;
    merchantName: string;
    transactionStatus: string;
    reversalTax: number;
    reversalFee: number;
    cityName: string;
    pickupAddress: string;
    transactionNotes: string;
    reservePaymentDate: string;
    reservePayment: number;
    balancePayment: number;
    actualWeight: number;
    transactionStatusHistory: Array<{
      transactionStatusMessage: string;
      transactionStatusMessageCode: string;
      updatedAt: string;
    }>;
    items: number;
    invoiceDivision: number;
    returnAddress: string;
  }
}

// Update interface to track variants for each product
interface ProductTotals {
  [key: string]: {
    total: number;
    variants: {
      [variant: string]: number;
    };
  };
}

// Move the function outside of the Orders.tsx file and export it
export const parseProductDescriptions = (description: string): { product: string, variant: string, quantity: number }[] => {
  const products: { product: string, variant: string, quantity: number }[] = [];
  
  // This improved regex handles both parentheses variants and dash-separated variants
  const regex = /(\d+)\s*x\s*([\w\s™™™\-]+?)(?:\s*\(([^)]+)\)|\s*-\s*([^-\[\]]+?)\s*-|\s*\]|$)/g;
  let match;
  
  while ((match = regex.exec(description)) !== null) {
    const quantity = parseInt(match[1], 10);
    let product = match[2].trim();
    // Get variant from either parentheses format (match[3]) or dash format (match[4])
    let variant = match[3] || match[4] || "Default";
    
    // Standardize product names (remove extra spaces and normalize)
    product = product.replace(/\s+/g, ' ').trim();
    // Also trim the variant
    variant = variant.trim();
    
    products.push({ product, variant, quantity });
  }
  
  return products;
};

export function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteTrackingNumber, setDeleteTrackingNumber] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [searchQuery, setSearchQuery] = useState(''); // Add this new state for search
  const { toast } = useToast();
  
  // Date picker state
  const [date, setDate] = useState<DateRange | undefined>({
    from: undefined,
    to: undefined
  });

  // Use either date range or month selection for filtering
  const [useCustomDateRange, setUseCustomDateRange] = useState(false);
  const [productTotals, setProductTotals] = useState<ProductTotals>({});
  
  // Add these new states for editing at the top of your Orders component
  const [editingOrder, setEditingOrder] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState<string>('');

  // Add this new state for status filtering at the top of your component
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Add these new states at the top of your Orders component
  const [cogsStats, setCogsStats] = useState({
    totalCOGS: 0,
    totalCourierFees: 0,
    avgCourierFee: 0,
    productCOGSBreakdown: {} as Record<string, number>
  });

  useEffect(() => {
    fetchOrders();
  }, [selectedMonth, date, useCustomDateRange, searchQuery, statusFilter]); // Add statusFilter to dependency array

  const fetchOrders = async () => {
    let query = supabase.from('orders').select('*');
    
    // Apply date filtering
    if (useCustomDateRange && date) {
      // If we have a custom date range
      if (date.from) {
        const formattedFrom = format(date.from, 'yyyy-MM-dd');
        query = query.gte('dispatch_date', formattedFrom);
        
        if (date.to) {
          // If we have both from and to dates
          const formattedTo = format(date.to, 'yyyy-MM-dd');
          query = query.lte('dispatch_date', formattedTo);
        } else {
          // If we only have a from date, only show that specific date
          query = query.lte('dispatch_date', formattedFrom);
        }
      }
    } else {
      // Use month-based filtering
      const startDate = `${selectedMonth}-01`;
      const endDate = `${selectedMonth}-31`;
      query = query.gte('dispatch_date', startDate).lte('dispatch_date', endDate);
    }
    
    // Apply search query if it exists
    if (searchQuery.trim()) {
      query = query.ilike('order_id', `%${searchQuery.trim()}%`);
    }

    // Apply status filter if selected
    if (statusFilter) {
      query = query.eq('order_status', statusFilter);
    }

    const { data, error } = await query.order('dispatch_date', { ascending: false });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch orders",
        variant: "destructive",
      });
    } else {
      // Map the data to ensure it matches the Order interface
      const mappedOrders = (data || []).map(item => {
        return {
          id: item.id,
          tracking_number: item.tracking_number,
          order_id: item.order_id,
          customer_name: item.customer_name,
          customer_address: item.customer_address,
          customer_phone: item.customer_phone || '',  // Default empty string if missing
          product_name: item.product_name,
          amount: item.amount,
          order_status: item.order_status,
          dispatch_date: item.dispatch_date,
          return_received: item.return_received,
          courier_fee: item.courier_fee,
          customer_city: item.customer_city || ''  // Default empty string if missing
        };
      });
      
      setOrders(mappedOrders);
    }
  };

  // Extract tracking numbers from PDF text
  const extractTrackingNumbers = (text: string): string[] => {
    const trackingRegex = /Tracking No:\s*(\d+)/g;
    const matches = [...text.matchAll(trackingRegex)];
    return matches.map(match => match[1]);
  };

  // Fetch order details from PostEx API
  const fetchOrderDetails = async (trackingNumber: string): Promise<PostExResponse | null> => {
    try {
      console.log(`Fetching details for tracking number: ${trackingNumber}`);
      
      const response = await fetch(`https://api.postex.pk/services/integration/api/order/v1/track-order/${trackingNumber}`, {
        method: 'GET',
        headers: {
          'token': 'OTMxNzA0NTRhN2E3NGQ4MzkxMDE3YjdmYjEwNzZkM2U6NDYyNGZlMTZhNGRhNDY0NTg4YzhmZDc5OWVkYjEyMDI=',
          'Accept': 'application/json'
        }
      });
      
      // Log response status for debugging
      console.log(`Response status for ${trackingNumber}: ${response.status}`);
      
      if (!response.ok) {
        // Try to get more details about the error
        const errorText = await response.text();
        console.log(`Error details: ${errorText}`);
        throw new Error(`API Error: ${response.status}. Details: ${errorText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`Error fetching data for tracking number ${trackingNumber}:`, error);
      return null;
    }
  };

  // Save order to Supabase
  const saveOrderToSupabase = async (orderData: PostExResponse): Promise<boolean> => {
    try {
      const { dist } = orderData;
      
      const order = {
        tracking_number: dist.trackingNumber,
        order_id: dist.orderRefNumber,
        customer_name: dist.customerName,
        customer_address: dist.deliveryAddress,
        customer_phone: dist.customerPhone,
        customer_city: dist.cityName,
        product_name: dist.orderDetail,
        amount: dist.invoicePayment,
        order_status: dist.transactionStatus.toLowerCase(),
        dispatch_date: dist.orderPickupDate,
        courier_fee: dist.transactionFee + dist.transactionTax,
        return_received: false // Default value for new orders
      };

      // Check if order already exists (to avoid duplicate inventory updates)
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('tracking_number')
        .eq('tracking_number', order.tracking_number)
        .single();
    
      // If this is a new order, update inventory
      const isNewOrder = !existingOrder;

      const { error } = await supabase.from('orders').upsert([order], {
        onConflict: 'tracking_number'
      });

      if (error) {
        console.error('Error saving order:', error);
        return false;
      }
      
      // Only update inventory for new orders to avoid duplicate deductions
      if (isNewOrder) {
        // Deduct from inventory (-1 multiplier to reduce stock)
        await processInventoryUpdates(order.product_name, -1);
      }
      
      return true;
    } catch (error) {
      console.error('Error processing order data:', error);
      return false;
    }
  };

  const handlePdfUpload = async (type: 'dispatch' | 'return') => {
    if (!pdfFile) {
      toast({
        title: "Error",
        description: "Please select a PDF file first",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      toast({
        title: "Processing",
        description: `Extracting tracking numbers from PDF...`,
      });
      
      // Read the PDF file
      const fileData = await pdfFile.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: fileData }).promise;
      
      // Track processing statistics
      let totalTracking = 0;
      let successfulOrders = 0;
      let failedOrders = 0;
      const allTrackingNumbers: string[] = [];
      
      // Process each page of the PDF
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map(item => 'str' in item ? item.str : '')
          .join(' ');
        
        // Extract tracking numbers from this page
        const trackingNumbers = extractTrackingNumbers(pageText);
        allTrackingNumbers.push(...trackingNumbers);
      }
      
      totalTracking = allTrackingNumbers.length;
      
      toast({
        title: "Processing",
        description: `Found ${totalTracking} tracking numbers. Fetching order details...`,
      });
      
      // Process tracking numbers based on type
      if (type === 'dispatch') {
        // For dispatch: Fetch order details and save to database
        for (const trackingNumber of allTrackingNumbers) {
          const orderData = await fetchOrderDetails(trackingNumber);
          
          if (orderData && orderData.statusCode === "200") {
            const success = await saveOrderToSupabase(orderData);
            if (success) {
              successfulOrders++;
            } else {
              failedOrders++;
            }
          } else {
            failedOrders++;
          }
        }
      } else if (type === 'return') {
        // For returns: Update return_received status
        for (const trackingNumber of allTrackingNumbers) {
          const { error } = await supabase
            .from('orders')
            .update({ return_received: true })
            .eq('tracking_number', trackingNumber);
          
          if (!error) {
            successfulOrders++;
          } else {
            failedOrders++;
          }
        }
      }
      
      // Reset file input
      setPdfFile(null);
      const fileInputs = document.querySelectorAll('input[type="file"]') as NodeListOf<HTMLInputElement>;
      fileInputs.forEach(input => input.value = '');
      
      // Show results and refresh orders
      toast({
        title: "Complete",
        description: `Processed ${totalTracking} orders: ${successfulOrders} successful, ${failedOrders} failed.`,
        variant: successfulOrders > 0 ? "default" : "destructive",
      });
      
      // Refresh orders list
      fetchOrders();
    } catch (error) {
      console.error('PDF processing error:', error);
      toast({
        title: "Error",
        description: "Failed to process PDF: " + (error instanceof Error ? error.message : "Unknown error"),
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Add this function before the return statement
  const handleDeleteOrder = async () => {
    if (!orderToDelete) return;
    
    try {
      // Before deleting, we need to add the items back to inventory if the order was dispatched
      // but not already returned
      if (orderToDelete.order_status !== 'returned' && !orderToDelete.return_received) {
        // Add items back to inventory (with +1 multiplier to increase stock)
        await processInventoryUpdates(orderToDelete.product_name, 1);
        
        // Optional: Log the inventory update
        console.log(`Inventory updated for deleted order: ${orderToDelete.order_id}`);
      }
      
      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderToDelete.id);
    
      if (error) {
        toast({
          title: "Error",
          description: "Failed to delete order: " + error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: "Order deleted successfully and inventory updated",
        });
        
        // Refresh inventory display if needed
        await refreshInventoryDisplay();
        
        // Refresh orders list
        fetchOrders();
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      // Close dialog and reset state
      setDeleteConfirmOpen(false);
      setOrderToDelete(null);
    }
  };

  const openDeleteConfirm = (order: Order) => {
    setOrderToDelete(order);
    setDeleteConfirmOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const statusColors = {
      dispatched: "bg-blue-100 text-blue-800 hover:bg-blue-100",
      delivered: "bg-green-100 text-green-800 hover:bg-green-100",
      returned: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
      failed: "bg-red-100 text-red-800 hover:bg-red-100",
    };
    
    return (
      <Badge className={statusColors[status as keyof typeof statusColors] || "bg-gray-100 text-gray-800"}>
        {status}
      </Badge>
    );
  };

  // Toggle return status
  const toggleReturnStatus = async (order: Order) => {
    try {
      const newStatus = !order.return_received;
      
      // If marking as received, add to inventory
      // If unmarking as received, remove from inventory
      if (newStatus) {
        // Add to inventory when return is received
        await processInventoryUpdates(order.product_name, 1);
      } else {
        // Remove from inventory if return mark is reversed
        await processInventoryUpdates(order.product_name, -1);
      }
      
      const { error } = await supabase
        .from('orders')
        .update({ return_received: newStatus })
        .eq('id', order.id);
      
      if (error) {
        toast({
          title: "Error",
          description: "Failed to update return status: " + error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: `Return status updated to ${newStatus ? 'Received' : 'Not Received'} and inventory ${newStatus ? 'increased' : 'decreased'}`,
        });
        // Refresh orders list
        fetchOrders();
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    }
  };

  // Handle date selection
  const handleDateSelect = (range: DateRange | undefined) => {
    setDate(range);
    setUseCustomDateRange(true);
    
    // If a single date was selected, or the range selection is complete
    if ((range?.from && !range?.to) || (range?.from && range?.to)) {
      fetchOrders();
    }
  };

  // Clear date selection
  const clearDateSelection = () => {
    setDate({ from: undefined, to: undefined });
    setUseCustomDateRange(false);
  };

  // Add this useEffect to calculate product totals when orders change
  useEffect(() => {
    calculateProductTotals();
  }, [orders]);
  
  // Updated function to calculate product totals from current orders
  const calculateProductTotals = () => {
    const totals: ProductTotals = {};
    
    orders.forEach(order => {
      if (!order.product_name) return;
      
      const parsedProducts = parseProductDescriptions(order.product_name);
      
      parsedProducts.forEach(({ product, variant, quantity }) => {
        if (!totals[product]) {
          totals[product] = {
            total: 0,
            variants: {}
          };
        }
        
        totals[product].total += quantity;
        
        // Track variant counts
        if (!totals[product].variants[variant]) {
          totals[product].variants[variant] = 0;
        }
        totals[product].variants[variant] += quantity;
      });
    });
    
    setProductTotals(totals);
  };

  // Add this function to handle the amount update
  const handleAmountUpdate = async (orderId: string) => {
    try {
      // Validate the input is a number
      const newAmount = parseFloat(editingAmount);
      if (isNaN(newAmount)) {
        toast({
          title: "Error",
          description: "Please enter a valid amount",
          variant: "destructive",
        });
        return;
      }

      // Update the order in Supabase
      const { error } = await supabase
        .from('orders')
        .update({ amount: newAmount })
        .eq('id', orderId);

      if (error) {
        toast({
          title: "Error",
          description: "Failed to update order amount: " + error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: "Order amount updated successfully",
        });
        // Refresh orders list
        fetchOrders();
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      // Reset editing state
      setEditingOrder(null);
      setEditingAmount('');
    }
  };

  // Add this handler for when editing begins
  const startEditing = (order: Order) => {
    setEditingOrder(order.id);
    setEditingAmount(order.amount.toString());
  };

  // Add this function to handle status filter changes
  const handleStatusFilterChange = (status: string | null) => {
    setStatusFilter(status);
  };

  // Add this function to fetch product COGS data from inventory
  const fetchProductsCOGS = async () => {
    const { data: inventoryData, error } = await supabase
      .from('products')
      .select('*');
      
    if (error) {
      console.error('Error fetching inventory data:', error);
      return {};
    }
    
    // Create a map of product names to their COGS values
    const cogsMap: Record<string, number> = {};
    (inventoryData || []).forEach((product) => {
      cogsMap[product.name.toLowerCase()] = product.cogs;
    });
    
    return cogsMap;
  };

  // Add this function to calculate COGS and courier statistics
  const calculateCOGSAndCourierStats = async () => {
    // Fetch product COGS data
    const cogsMap = await fetchProductsCOGS();
    
    let totalCOGS = 0;
    let productCOGSBreakdown: Record<string, number> = {};
    
    // Calculate COGS for each product
    Object.entries(productTotals).forEach(([product, data]) => {
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
        const productTotalCOGS = productCOGS * data.total;
        totalCOGS += productTotalCOGS;
        productCOGSBreakdown[product] = productTotalCOGS;
      }
    });
    
    // Calculate courier statistics
    const totalCourierFees = orders.reduce((sum, order) => sum + (order.courier_fee || 0), 0);
    const avgCourierFee = orders.length > 0 ? totalCourierFees / orders.length : 0;
    
    // Update stats
    setCogsStats({
      totalCOGS,
      totalCourierFees,
      avgCourierFee,
      productCOGSBreakdown
    });
  };

  // Add this useEffect to calculate COGS stats when orders or product totals change
  useEffect(() => {
    if (Object.keys(productTotals).length > 0) {
      calculateCOGSAndCourierStats();
    }
  }, [productTotals]);

  // Add these new functions to your Orders.tsx file

  // Function to update inventory based on product name and quantity
  const updateInventory = async (productName: string, quantityChange: number) => {
    try {
      // Fetch inventory data to find matching product
      const { data: inventoryData, error: fetchError } = await supabase
        .from('products')
        .select('*');
        
      if (fetchError) {
        console.error('Error fetching inventory data:', fetchError);
        return false;
      }
      
      // Find the matching product in inventory
      const productNameLower = productName.toLowerCase();
      let matchingProduct = inventoryData?.find(product => 
        product.name.toLowerCase() === productNameLower
      );
      
      // If no exact match, try to find a partial match
      if (!matchingProduct) {
        matchingProduct = inventoryData?.find(product => 
          productNameLower.includes(product.name.toLowerCase()) || 
          product.name.toLowerCase().includes(productNameLower)
        );
      }
      
      if (matchingProduct) {
        // Calculate new stock level and ensure it doesn't go below 0
        const newStock = Math.max(0, matchingProduct.current_stock + quantityChange);
        
        // Update the inventory
        const { error: updateError } = await supabase
          .from('products')
          .update({ current_stock: newStock })
          .eq('id', matchingProduct.id);
        
        if (updateError) {
          console.error('Error updating inventory:', updateError);
          return false;
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error updating inventory:', error);
      return false;
    }
  };

  // Function to process inventory updates for multiple products
  const processInventoryUpdates = async (
    productDescription: string, 
    quantityMultiplier: number // Use 1 for adding to inventory, -1 for removing
  ) => {
    if (!productDescription) return;
    
    const parsedProducts = parseProductDescriptions(productDescription);
    const updateResults: {product: string, success: boolean}[] = [];
    
    for (const { product, quantity } of parsedProducts) {
      const success = await updateInventory(
        product, 
        quantity * quantityMultiplier
      );
      updateResults.push({ product, success });
    }
    
    return updateResults;
  };

  // Add this utility function to your Orders component
  const refreshInventoryDisplay = async () => {
    try {
      // Create a custom event to trigger inventory refresh on the Inventory component
      const event = new CustomEvent('inventory-updated');
      window.dispatchEvent(event);
      
      return true;
    } catch (error) {
      console.error('Error triggering inventory refresh:', error);
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Orders Management</h2>
          <p className="text-muted-foreground">Track and manage parcel operations</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Search bar for Order ID */}
          <div className="relative">
            <Input
              type="text"
              placeholder="Search by Order ID"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-[200px]"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setSearchQuery('')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                </svg>
                <span className="sr-only">Clear search</span>
              </Button>
            )}
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className={cn(
                  "w-[280px] justify-start text-left font-normal",
                  !date && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, "LLL dd, y")} - {format(date.to, "LLL dd, y")}
                    </>
                  ) : (
                    format(date.from, "LLL dd, y")
                  )
                ) : (
                  "Select date or range"
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={handleDateSelect}
                numberOfMonths={2}
              />
              <div className="p-3 border-t border-border">
                <Button variant="outline" size="sm" onClick={clearDateSelection} className="w-full">
                  Reset to Month View
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          
          {!useCustomDateRange && (
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
          )}
        </div>
      </div>

      {/* PDF Upload Section with Product Totals */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Dispatch PDF
            </CardTitle>
            <CardDescription>
              Upload PDF with courier labels to automatically process orders
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="file"
              accept=".pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            />
            <Button 
              onClick={() => handlePdfUpload('dispatch')} 
              disabled={!pdfFile || isProcessing}
              className="w-full"
            >
              {isProcessing ? "Processing..." : "Process Dispatch PDF"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
              </svg>
              Product Totals
            </CardTitle>
            <CardDescription>
              Summary of products dispatched in the current view
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {Object.keys(productTotals).length === 0 ? (
                <p className="text-sm text-muted-foreground">No products found in current orders</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.entries(productTotals).map(([product, data], index) => (
                    <div 
                      key={index} 
                      className="flex justify-between items-center p-3 border rounded-md bg-muted/30 group relative"
                    >
                      <span className="text-sm font-medium truncate max-w-[70%]" title={product}>
                        {product}
                      </span>
                      <Badge variant="secondary" className="ml-2">
                        {data.total} units
                      </Badge>

                      {/* Tooltip for variant breakdown */}
                      <div className="absolute left-0 bottom-full mb-2 bg-black text-white p-2 rounded-md text-xs hidden group-hover:block z-10 min-w-[150px] shadow-lg">
                        <div className="font-semibold mb-1 pb-1 border-b border-gray-700">Variant Breakdown:</div>
                        {Object.entries(data.variants).map(([variant, count], i) => (
                          <div key={i} className="flex justify-between py-0.5">
                            <span>{variant}:</span>
                            <span className="font-medium ml-2">{count} × </span>
                          </div>
                        ))}
                        <div className="absolute left-4 bottom-[-6px] w-3 h-3 bg-black transform rotate-45"></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="mt-4 pt-4 border-t">
              <div className="flex justify-between items-center">
                <span className="font-semibold">Total Products:</span>
                <Badge variant="outline" className="text-sm">
                  {Object.values(productTotals).reduce((a, b) => a + b.total, 0)} units
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* COGS and Courier Summary Card - Add the new card here */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Cost Summary
          </CardTitle>
          <CardDescription>
            Cost of goods sold and courier charges for {useCustomDateRange ? (
              date?.from ? (
                date.to ? (
                  <>period from {format(date.from, "MMMM d, yyyy")} to {format(date.to, "MMMM d, yyyy")}</>
                ) : (
                  <>{format(date.from, "MMMM d, yyyy")}</>
                )
              ) : (
                "selected period"
              )
            ) : (
              <>the month of {new Date(selectedMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 border rounded-md">
              <div className="text-sm font-medium text-muted-foreground mb-1">Total COGS</div>
              <div className="text-2xl font-bold">PKR {cogsStats.totalCOGS.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Based on {Object.keys(productTotals).length} unique products
              </div>
            </div>
            
            <div className="p-4 border rounded-md">
              <div className="text-sm font-medium text-muted-foreground mb-1">Total Courier Fees</div>
              <div className="text-2xl font-bold">PKR {cogsStats.totalCourierFees.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">
                For {orders.length} orders
              </div>
            </div>
            
            <div className="p-4 border rounded-md">
              <div className="text-sm font-medium text-muted-foreground mb-1">Avg Courier Fee</div>
              <div className="text-2xl font-bold">PKR {cogsStats.avgCourierFee.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Per order
              </div>
            </div>
          </div>
          
          {Object.keys(cogsStats.productCOGSBreakdown).length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <h4 className="text-sm font-medium mb-2">COGS Breakdown by Product</h4>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                {Object.entries(cogsStats.productCOGSBreakdown).map(([product, cogs]) => (
                  <div key={product} className="flex justify-between p-2 border rounded text-sm">
                    <span className="truncate max-w-[70%]" title={product}>{product}</span>
                    <span className="font-medium">PKR {cogs.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {useCustomDateRange ? (
              date?.from ? (
                date.to ? (
                  <>Orders from {format(date.from, "MMMM d, yyyy")} to {format(date.to, "MMMM d, yyyy")}</>
                ) : (
                  <>Orders for {format(date.from, "MMMM d, yyyy")}</>
                )
              ) : (
                "Orders"
              )
            ) : (
              <>Orders for {new Date(selectedMonth).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}</>
            )}
          </CardTitle>
          <CardDescription>
            {orders.length} orders found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Tracking Number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Customer Phone</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>
                    <div className="flex items-center space-x-2">
                      <span>Status</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                            </svg>
                            <span className="sr-only">Filter by status</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[200px] p-0" align="start">
                          <div className="p-2 space-y-1">
                            <div className="font-medium text-sm px-2 py-1">Filter by status</div>
                            <div className="border-t my-1"></div>
                            <Button 
                              variant={statusFilter === null ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange(null)}
                            >
                              All Statuses
                            </Button>
                            <Button 
                              variant={statusFilter === "delivered" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("delivered")}
                            >
                              <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-0.5 rounded mr-2">Delivered</span>
                              Delivered
                            </Button>
                            <Button 
                              variant={statusFilter === "returned" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("returned")}
                            >
                              <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded mr-2">Returned</span>
                              Returned
                            </Button>
                            <Button 
                              variant={statusFilter === "dispatched" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("dispatched")}
                            >
                              <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded mr-2">Dispatched</span>
                              Dispatched
                            </Button>
                            <Button 
                              variant={statusFilter === "failed" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("failed")}
                            >
                              <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-0.5 rounded mr-2">Failed</span>
                              Failed
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                      {statusFilter && (
                        <Badge variant="outline" className="ml-2 bg-muted">
                          {statusFilter}
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-4 w-4 ml-1 -mr-1" 
                            onClick={() => handleStatusFilterChange(null)}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                            </svg>
                            <span className="sr-only">Clear filter</span>
                          </Button>
                        </Badge>
                      )}
                    </div>
                  </TableHead>
                  <TableHead>Dispatch Date</TableHead>
                  <TableHead>Return Received</TableHead>
                  <TableHead>Courier Fee</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.order_id}</TableCell>
                    <TableCell>
                      <a 
                        href={`https://postex.pk/tracking?cn=${order.tracking_number}`}
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {order.tracking_number}
                      </a>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{order.customer_name}</div>
                        <div className="text-sm text-muted-foreground truncate max-w-xs">
                          {order.customer_address}<br></br>{order.customer_city}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{order.customer_phone}</TableCell>
                    <TableCell>{order.product_name}</TableCell>
                    <TableCell>
                      {editingOrder === order.id ? (
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            value={editingAmount}
                            onChange={(e) => setEditingAmount(e.target.value)}
                            className="w-[100px]"
                          />
                          <Button
                            onClick={() => handleAmountUpdate(order.id)}
                            className="px-3"
                          >
                            Save
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span>PKR {order.amount}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => startEditing(order)}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 3h10v10M3 21h18" />
                            </svg>
                            <span className="sr-only">Edit amount</span>
                          </Button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(order.order_status)}</TableCell>
                    <TableCell>{new Date(order.dispatch_date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge 
                        className={order.return_received 
                          ? "bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer" 
                          : "bg-gray-100 text-gray-800 hover:bg-gray-200 cursor-pointer"}
                        onClick={() => toggleReturnStatus(order)}
                      >
                        {order.return_received ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>PKR {order.courier_fee}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDeleteConfirm(order)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {orders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-4">
                      No orders found for the selected period
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this order? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteOrder}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
