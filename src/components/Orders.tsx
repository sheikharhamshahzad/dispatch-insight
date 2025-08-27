import { useState, useEffect, useRef } from "react";
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
import { checkAndUpdateOrderStatuses } from "@/services/orderStatusChecker";
import { fetchOrderDetails, POSTEX_API_CONFIG } from "@/services/postexApiService";
import { FIFOInventoryService } from "@/services/fifoInventoryService";
import { parseProductDescriptions, findMatchingProduct } from "@/services/productMatchingService";

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
  cogs_allocated: boolean;
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
    baseName?: string; // Base product name without variant
  };
}

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
    productCOGSBreakdown: {} as Record<string, number>,
    deliveredAndReturnedCount: 0,
    deliveredCount: 0,
    returnedCount: 0
  });

  // Add this state to your Orders component
  const [isCheckingStatuses, setIsCheckingStatuses] = useState(false);

  // Add a request sequence ref to ignore stale responses
  const fetchSeq = useRef(0);

  useEffect(() => {
    fetchOrders();
  }, [selectedMonth, date, useCustomDateRange, searchQuery, statusFilter]); // Add statusFilter to dependency array

  const fetchOrders = async () => {
    const seq = ++fetchSeq.current;

    let query = supabase.from('orders').select('*');
    
    // Apply date filtering
    if (useCustomDateRange && date?.from) {
      // Build a half-open interval: [from, toNextDay)
      const fromStr = format(date.from, 'yyyy-MM-dd');
      const toDate = date.to ?? date.from;
      const toNextDay = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1);
      const toNextDayStr = format(toNextDay, 'yyyy-MM-dd');

      query = query.gte('dispatch_date', fromStr).lt('dispatch_date', toNextDayStr);
    } else {
      // Month-based filtering using half-open interval for the whole month
      const [year, month] = selectedMonth.split('-').map(Number); // e.g. "2025-08"
      const monthStart = new Date(year, month - 1, 1);
      const nextMonthStart = new Date(year, month, 1);
      const monthStartStr = format(monthStart, 'yyyy-MM-dd');
      const nextMonthStartStr = format(nextMonthStart, 'yyyy-MM-dd');

      query = query.gte('dispatch_date', monthStartStr).lt('dispatch_date', nextMonthStartStr);
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

    // Ignore stale responses
    if (seq !== fetchSeq.current) return;

    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch orders",
        variant: "destructive",
      });
    } else {
      const mappedOrders = (data || []).map(item => {
        return {
          id: item.id,
          tracking_number: item.tracking_number,
          order_id: item.order_id,
          customer_name: item.customer_name,
          customer_address: item.customer_address,
          customer_phone: item.customer_phone || '',
          product_name: item.product_name,
          amount: item.amount,
          order_status: item.order_status,
          dispatch_date: item.dispatch_date,
          return_received: item.return_received,
          courier_fee: item.courier_fee,
          customer_city: item.customer_city || ''
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

  // Save order to Supabase
  const saveOrderToSupabase = async (orderData: PostExResponse): Promise<boolean> => {
    try {
      const { dist } = orderData;
      
      // Calculate courier fee based on order status
      const isReturned = dist.transactionStatus.toLowerCase() === 'returned';
      
      // Log all relevant values with better formatting
      console.log("Order details:", {
        trackingNumber: dist.trackingNumber,
        orderRef: dist.orderRefNumber,
        status: dist.transactionStatus,
        isReturned,
        transactionFee: dist.transactionFee,
        transactionTax: dist.transactionTax,
        reversalFee: dist.reversalFee,
        reversalTax: dist.reversalTax
      });
      
      // Ensure we handle undefined values with defaults of 0
      const transactionFee = dist.transactionFee || 0;
      const transactionTax = dist.transactionTax || 0;
      const reversalFee = dist.reversalFee || 0;
      const reversalTax = dist.reversalTax || 0;
      
      // For returned orders, use reversalFee + reversalTax
      // For other statuses, use transactionFee + transactionTax
      const courierFee = isReturned 
        ? (reversalFee + reversalTax)
        : (transactionFee + transactionTax);
      
      console.log("Calculated courier fee:", courierFee);
      
      // If courier fee is 0 for a delivered order, log a warning
      if (courierFee === 0 && dist.transactionStatus.toLowerCase() === 'delivered') {
        console.warn(`Warning: Zero courier fee for delivered order ${dist.trackingNumber}. API may not have provided fee data.`);
      }
      
      // Create today's date for new orders in YYYY-MM-DD format
      const today = new Date();
      const dispatchDate = format(today, 'yyyy-MM-dd');
      
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
        dispatch_date: dist.transactionDate || dispatchDate, // Use provided date or today
        courier_fee: courierFee,
        return_received: false // Default value for new orders
      };

      // Check if order already exists (to avoid duplicate inventory updates)
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('tracking_number, courier_fee, order_status')
        .eq('tracking_number', order.tracking_number)
        .single();
    
      // If this is a new order, update inventory
      const isNewOrder = !existingOrder;

      // If order exists and the status has changed to "delivered", update the courier fee
      if (existingOrder && 
          existingOrder.order_status !== 'delivered' && 
          order.order_status === 'delivered') {
        console.log(`Order status changed to delivered. Updating courier fee to ${courierFee}`);
      }

      // If existing order has 0 courier fee but we now have a valid fee, use our calculated value
      if (existingOrder && existingOrder.courier_fee === 0 && courierFee > 0) {
        console.log(`Updating zero courier fee for existing order to ${courierFee}`);
      }

      const { error } = await supabase.from('orders').upsert([order], {
        onConflict: 'tracking_number'
      });

      if (error) {
        console.error('Error saving order:', error);
        return false;
      }

      // Get the saved order ID
      const { data: savedOrder } = await supabase
        .from('orders')
        .select('id, cogs_allocated')
        .eq('tracking_number', order.tracking_number)
        .single();

      if (!savedOrder) {
        console.error('Could not fetch saved order');
        return false;
      }
      
      // Only allocate inventory for new orders and if not already allocated
      if (isNewOrder && !savedOrder.cogs_allocated) {
        console.log('Allocating FIFO inventory for new order:', order.tracking_number);
        await allocateInventoryForOrder(savedOrder.id, order.product_name);
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
          // We're creating new orders, so we know they'll use the new token
          // No need to pass a dispatch date
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
      // Before deleting, reverse FIFO allocations if the order had them
      if (orderToDelete.cogs_allocated) {
        console.log('Reversing FIFO allocations for deleted order:', orderToDelete.order_id);
        const reverseSuccess = await FIFOInventoryService.reverseAllocation(orderToDelete.id);
        
        if (!reverseSuccess) {
          console.warn('Failed to reverse FIFO allocations for order:', orderToDelete.order_id);
        }
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
          description: "Order deleted successfully and inventory restored",
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
    const statusColors: Record<string, string> = {
      delivered: "bg-green-100 text-green-800 hover:bg-green-100",
      returned: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
      unbooked: "bg-gray-100 text-gray-800 hover:bg-gray-100",
      "postex warehouse": "bg-purple-100 text-purple-800 hover:bg-purple-100",
      "out for delivery": "bg-blue-100 text-blue-800 hover:bg-blue-100",
      "picked by postex": "bg-indigo-100 text-indigo-800 hover:bg-indigo-100",
      "delivery under review": "bg-orange-100 text-orange-800 hover:bg-orange-100",
      "out for return": "bg-red-100 text-red-800 hover:bg-red-100",
      attempted: "bg-pink-100 text-pink-800 hover:bg-pink-100",
      dispatched: "bg-blue-100 text-blue-800 hover:bg-blue-100", // Keep for backward compatibility
      failed: "bg-red-100 text-red-800 hover:bg-red-100", // Keep for backward compatibility
    };
    
    // Normalize the status by converting to lowercase
    const normalizedStatus = status.toLowerCase();
    
    return (
      <Badge className={statusColors[normalizedStatus] || "bg-gray-100 text-gray-800"}>
        {status}
      </Badge>
    );
  };

  // Toggle return status
  const toggleReturnStatus = async (order: Order) => {
    try {
      const newStatus = !order.return_received;
      
      // If marking as received, add to inventory (regardless of whether the order was 
      // delivered or returned, as we want to increase inventory when items come back)
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
    // Enable custom range whenever a start date exists; let useEffect fetch
    setUseCustomDateRange(!!range?.from);
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
      
      parsedProducts.forEach(({ product, variant, quantity, fullProductName }) => {
        // Use the full product name (with variant) as the key
        const productKey = fullProductName;
        
        if (!totals[productKey]) {
          totals[productKey] = {
            total: 0,
            variants: {},
            baseName: product // Store base product name
          };
        }
        
        totals[productKey].total += quantity;
        
        // Track variant breakdown
        if (!totals[productKey].variants[variant]) {
          totals[productKey].variants[variant] = 0;
        }
        totals[productKey].variants[variant] += quantity;
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

  // Add this function to calculate COGS and courier statistics using FIFO
  const calculateCOGSAndCourierStats = async () => {
    // Only consider delivered orders for COGS calculation
    const deliveredOrders = orders.filter(order => order.order_status === 'delivered');
    const returnedOrders = orders.filter(order => order.order_status === 'returned');
    
    // Get delivered order IDs
    const deliveredOrderIds = deliveredOrders.map(order => order.id);
    
    // Use FIFO service to calculate COGS from recorded line items
    const { totalCOGS, productBreakdown } = await FIFOInventoryService.calculateDeliveredOrdersCOGS(deliveredOrderIds);
    
    console.log('FIFO COGS Calculation - Total:', totalCOGS);
    console.log('FIFO COGS Breakdown:', productBreakdown);
    
    // Calculate courier statistics for delivered and returned orders
    const deliveredAndReturnedOrders = [...deliveredOrders, ...returnedOrders];
    
    const totalCourierFees = deliveredAndReturnedOrders.reduce((sum, order) => sum + (order.courier_fee || 0), 0);
    const avgCourierFee = deliveredAndReturnedOrders.length > 0 ? totalCourierFees / deliveredAndReturnedOrders.length : 0;
    
    // Update stats
    setCogsStats({
      totalCOGS,
      totalCourierFees,
      avgCourierFee,
      productCOGSBreakdown: productBreakdown,
      deliveredAndReturnedCount: deliveredAndReturnedOrders.length,
      deliveredCount: deliveredOrders.length,
      returnedCount: returnedOrders.length
    });
  };

  // Add this useEffect to calculate COGS stats when orders or product totals change
  useEffect(() => {
    if (Object.keys(productTotals).length > 0) {
      calculateCOGSAndCourierStats();
    }
  }, [productTotals]);

  // Add these new functions to your Orders.tsx file

  // Function to update inventory based on product name and variant
  const updateInventory = async (product: { product: string, variant: string, quantity: number, fullProductName: string }, quantityChange: number) => {
    try {
      // Fetch inventory data to find matching product
      const { data: inventoryData, error: fetchError } = await supabase
        .from('products')
        .select('*');
        
      if (fetchError) {
        console.error('Error fetching inventory data:', fetchError);
        return false;
      }
      
      // Use the enhanced product matching function
      const matchingProduct = findMatchingProduct(
        inventoryData, 
        product.product, 
        product.variant, 
        product.fullProductName
      );
      
      if (matchingProduct) {
        // Calculate new stock level and ensure it doesn't go below 0
        const newStock = Math.max(0, matchingProduct.current_stock + quantityChange);
        
        console.log(`Updating inventory for ${matchingProduct.name}: ${matchingProduct.current_stock} → ${newStock}`);
        
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
      } else {
        console.warn(`No matching product found in inventory for: ${product.fullProductName}`);
        return false;
      }
    } catch (error) {
      console.error('Error updating inventory:', error);
      return false;
    }
  };

  // FIFO inventory allocation function
  const allocateInventoryForOrder = async (orderId: string, productDescription: string) => {
    if (!productDescription) return;
    
    console.log('Starting FIFO allocation for order:', orderId, 'products:', productDescription);
    
    const parsedProducts = parseProductDescriptions(productDescription);
    
    // Fetch inventory data to find matching products
    const { data: inventoryData, error: fetchError } = await supabase
      .from('products')
      .select('*');
      
    if (fetchError) {
      console.error('Error fetching inventory data:', fetchError);
      return;
    }
    
    let allAllocationsSuccessful = true;
    
    for (const { product, variant, quantity, fullProductName } of parsedProducts) {
      console.log(`Allocating ${quantity} units of ${fullProductName}`);
      
      // Find matching product
      const matchingProduct = findMatchingProduct(inventoryData, product, variant, fullProductName);
      
      if (!matchingProduct) {
        console.warn(`❌ No matching product found for: ${fullProductName}`);
        allAllocationsSuccessful = false;
        continue;
      }
      
      // Allocate inventory using FIFO
      const allocationResult = await FIFOInventoryService.allocateInventoryForOrder(
        matchingProduct.id,
        orderId,
        fullProductName,
        quantity
      );
      
      if (allocationResult.allocation_success) {
        console.log(`✅ Successfully allocated ${allocationResult.allocated_quantity} units with total COGS: ${allocationResult.total_cogs}`);
      } else {
        console.warn(`❌ Failed to allocate ${quantity} units for ${fullProductName}. Only ${allocationResult.allocated_quantity} units allocated.`);
        allAllocationsSuccessful = false;
      }
    }
    
    if (allAllocationsSuccessful) {
      // Mark order as having COGS allocated
      await FIFOInventoryService.markOrderCOGSAllocated(orderId);
    }
    
    return allAllocationsSuccessful;
  };

  // Function to process inventory updates for multiple products (legacy function, kept for compatibility)
  const processInventoryUpdates = async (
    productDescription: string, 
    quantityMultiplier: number // Use 1 for adding to inventory, -1 for removing
  ) => {
    if (!productDescription) return;
    
    const parsedProducts = parseProductDescriptions(productDescription);
    const updateResults: {product: string, variant: string, success: boolean}[] = [];
    
    for (const product of parsedProducts) {
      const success = await updateInventory(
        product,
        product.quantity * quantityMultiplier
      );
      updateResults.push({ 
        product: product.product, 
        variant: product.variant,
        success 
      });
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

  // Add this function to your Orders component
  const handleCheckOrderStatuses = async () => {
    setIsCheckingStatuses(true);
    try {
      toast({ title: "Processing", description: "Checking order statuses..." });

      const { data: pendingOrders, error } = await supabase
        .from('orders')
        .select('tracking_number, order_status, dispatch_date')
        .not('order_status', 'in', '(delivered,returned)');

      if (error) throw new Error('Failed to fetch pending orders');

      const norm = (d?: string) => (d ? d.slice(0,10) : "");

      const oldOrdersGroup = (pendingOrders || []).filter(o => {
        const nd = norm(o.dispatch_date);
        return nd !== "" && nd <= POSTEX_API_CONFIG.CUTOFF_DATE;
      });

      const newOrdersGroup = (pendingOrders || []).filter(o => {
        const nd = norm(o.dispatch_date);
        return nd !== "" && nd >= POSTEX_API_CONFIG.NEW_START_DATE;
      });

      console.log(`Pending: ${pendingOrders?.length || 0}`);
      console.log(`Old token group: ${oldOrdersGroup.length}`);
      console.log(`New token group: ${newOrdersGroup.length}`);

      let updated = 0;

      const processGroup = async (group: any[], label: string) => {
        console.log(`Processing ${group.length} with ${label} token`);
        for (const order of group) {
          const orderData = await fetchOrderDetails(order.tracking_number, norm(order.dispatch_date));
          if (orderData?.statusCode === "200") {
            const newStatus = orderData.dist.transactionStatus.toLowerCase();
            if (newStatus !== order.order_status) {
              await updateOrderStatus(order.tracking_number, orderData);
              updated++;
            }
          }
          await new Promise(r => setTimeout(r, 300));
        }
      };

      await processGroup(oldOrdersGroup, "OLD");
      await processGroup(newOrdersGroup, "NEW");

      toast({ title: "Done", description: `Updated ${updated} orders.` });
      fetchOrders();
    } catch (e) {
      console.error(e);
      toast({ title: "Error", description: "Status check failed", variant: "destructive" });
    } finally {
      setIsCheckingStatuses(false);
    }
  };

  // Add this helper function to update an order's status and courier fee
  const updateOrderStatus = async (trackingNumber: string, orderData: any): Promise<boolean> => {
    try {
      const { dist } = orderData;
      const newStatus = dist.transactionStatus.toLowerCase();
      
      // Different fee calculation based on status
      let courierFee = 0;
      
      if (newStatus === "returned") {
        // For returned orders, use reversalFee + reversalTax
        courierFee = (dist.reversalFee || 0) + (dist.reversalTax || 0);
      } else if (newStatus === "delivered") {
        // For delivered orders, use transactionFee + transactionTax
        courierFee = (dist.transactionFee || 0) + (dist.transactionTax || 0);
      }
      
      // Update database with new status and courier fee (for delivered/returned)
      const updateData: any = { order_status: newStatus };
      
      // Only update courier fee for final statuses
      if (newStatus === "delivered" || newStatus === "returned") {
        updateData.courier_fee = courierFee;
      }
      
      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('tracking_number', trackingNumber);
      
      if (error) {
        console.error(`Error updating order ${trackingNumber}:`, error);
        return false;
      }
      
      console.log(`✅ Updated order ${trackingNumber}: status → ${newStatus}${
        updateData.courier_fee !== undefined ? `, courier fee: ${updateData.courier_fee}` : ''
      }`);
      
      return true;
    } catch (error) {
      console.error(`Error processing update for ${trackingNumber}:`, error);
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Orders Management</h2>
          <p className="text-muted-foreground">Track and manage parcel operations</p>
        </div>

        {/* Controls: stack on mobile, row on md+ */}
        <div className="w-full md:w-auto flex flex-col md:flex-row gap-2 md:gap-4">
          {/* Check Status */}
          <Button
            onClick={handleCheckOrderStatuses}
            disabled={isCheckingStatuses}
            variant="outline"
            className="w-full md:w-auto md:mr-2 justify-start md:justify-center text-left"
          >
            {isCheckingStatuses ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Checking Orders...
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-2"
                >
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 21h5v-5" />
                </svg>
                Check Order Statuses
              </>
            )}
          </Button>

          {/* Search by Order ID */}
          <div className="relative w-full md:w-[200px]">
            <Input
              type="text"
              placeholder="Search by Order ID"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
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

          {/* Select date or range */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className={cn(
                  "justify-start text-left font-normal w-full md:w-[280px]",
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

          {/* Month selection (only when not using custom date range) */}
          {!useCustomDateRange && (
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-full md:w-48">
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
                      className="flex justify-between items-center p-3 border rounded-md bg-muted/30"
                    >
                      <span className="text-sm font-medium mr-2 break-words" style={{ wordBreak: 'break-word', maxWidth: '75%' }} title={product}>
                        {product}
                      </span>
                      <Badge variant="secondary" className="ml-auto shrink-0">
                        {data.total} units
                      </Badge>
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
                For {cogsStats.deliveredCount} delivered & {cogsStats.returnedCount} returned orders
              </div>
            </div>
            
            <div className="p-4 border rounded-md">
              <div className="text-sm font-medium text-muted-foreground mb-1">Avg Courier Fee</div>
              <div className="text-2xl font-bold">PKR {cogsStats.avgCourierFee.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Per delivered/returned order
              </div>
            </div>
          </div>
          
          {Object.keys(cogsStats.productCOGSBreakdown).length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <h4 className="text-sm font-medium mb-2">COGS Breakdown by Product</h4>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                {Object.entries(cogsStats.productCOGSBreakdown)
                  .sort(([, a], [, b]) => b - a) // Sort by COGS value (highest first)
                  .map(([product, cogs]) => (
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
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[240px] p-0" align="start">
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
                              <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-0.5 rounded mr-2">•</span>
                              Delivered
                            </Button>
                            <Button 
                              variant={statusFilter === "returned" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("returned")}
                            >
                              <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded mr-2">•</span>
                              Returned
                            </Button>
                            <Button 
                              variant={statusFilter === "unbooked" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("unbooked")}
                            >
                              <span className="bg-gray-100 text-gray-800 text-xs font-medium px-2 py-0.5 rounded mr-2">•</span>
                              Unbooked
                            </Button>
                            <Button 
                              variant={statusFilter === "postex warehouse" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("postex warehouse")}
                            >
                              <span className="bg-purple-100 text-purple-800 text-xs font-medium px-2 py-0.5 rounded mr-2">•</span>
                              PostEx WareHouse
                            </Button>
                            <Button 
                              variant={statusFilter === "out for delivery" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("out for delivery")}
                            >
                              <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded mr-2">•</span>
                              Out For Delivery
                            </Button>
                            <Button 
                              variant={statusFilter === "picked by postex" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("picked by postex")}
                            >
                              <span className="bg-indigo-100 text-indigo-800 text-xs font-medium px-2 py-0.5 rounded mr-2">•</span>
                              Picked By PostEx
                            </Button>
                            <Button 
                              variant={statusFilter === "delivery under review" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("delivery under review")}
                            >
                              <span className="bg-orange-100 text-orange-800 text-xs font-medium px-2 py-0.5 rounded mr-2">•</span>
                              Delivery Under Review
                            </Button>
                            <Button 
                              variant={statusFilter === "out for return" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("out for return")}
                            >
                              <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-0.5 rounded mr-2">•</span>
                              Out For Return
                            </Button>
                            <Button 
                              variant={statusFilter === "attempted" ? "default" : "ghost"} 
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => handleStatusFilterChange("attempted")}
                            >
                              <span className="bg-pink-100 text-pink-800 text-xs font-medium px-2 py-0.5 rounded mr-2">•</span>
                              Attempted
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
