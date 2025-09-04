// Update your imports at the top of the file
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Upload, Download, Trash2, Calendar as CalendarIcon, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { checkAndUpdateOrderStatuses } from "@/services/orderStatusChecker";
import { fetchOrderDetails, POSTEX_API_CONFIG } from "@/services/postexApiService";
import { ErrorBoundary } from "react-error-boundary";
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
  precogs?: number;
  cogs?: number; // Add this field
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
    trackingNumber: string; // Add this field
    transactionStatus: string; // Add this field
    transactionDate: string; // Add this field
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

// REPLACE the current parseProductDescriptions with this simplified version
export const parseProductDescriptions = (
  description: string
): { fullProductName: string; baseName: string; variant: string; quantity: number }[] => {
  const results: { fullProductName: string; baseName: string; variant: string; quantity: number }[] = [];

  if (!description) return results;

  // Match every [...] block
  const blocks = [...description.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim());

  // If no bracketed format, treat entire string as one product (qty 1)
  if (blocks.length === 0) {
    const cleaned = description.trim().replace(/\s-\s*$/, ''); // drop trailing ' - '
    const lastDash = cleaned.lastIndexOf(' - ');
    const baseName = lastDash !== -1 ? cleaned.slice(0, lastDash).trim() : cleaned;
    const variant = lastDash !== -1 ? cleaned.slice(lastDash + 3).trim() : '';
    results.push({
      fullProductName: cleaned,
      baseName,
      variant,
      quantity: 1
    });
    return results;
  }

  for (const raw of blocks) {
    // Pattern: QTY x NAME...(possibly ends with " - " or " - Variant - ")
    const m = raw.match(/^(\d+)\s*x\s*(.+)$/i);
    if (!m) continue;

    const quantity = parseInt(m[1], 10);
    let namePart = m[2].trim();

    // Remove exactly one trailing " - " if present
    namePart = namePart.replace(/\s-\s*$/, '');

    // Split variant (variant is the last ' - ' segment if present)
    const lastDash = namePart.lastIndexOf(' - ');
    const baseName = lastDash !== -1 ? namePart.slice(0, lastDash).trim() : namePart;
    const variant = lastDash !== -1 ? namePart.slice(lastDash + 3).trim() : '';

    results.push({
      fullProductName: namePart,
      baseName,
      variant,
      quantity
    });
  }

  return results;
};

// Enhanced product matching function - moved outside of Orders component to top level
export const findMatchingProduct = (
  inventoryData: any[], 
  productName: string, 
  variant: string, 
  fullProductName: string
) => {
  console.log(`Looking for match: "${fullProductName}" (Base: "${productName}", Variant: "${variant}")`);

  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/™|®|©/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // 1. Exact full name (case-insensitive)
  let match = inventoryData?.find(p =>
    p.name.toLowerCase() === fullProductName.toLowerCase()
  );
  if (match) {
    console.log(`✅ Exact full name match: ${match.name}`);
    return match;
  }

  // 2. Normalized full name equality
  const normalizedFull = normalize(fullProductName);
  match = inventoryData?.find(p => normalize(p.name) === normalizedFull);
  if (match) {
    console.log(`✅ Normalized full name match: ${match.name}`);
    return match;
  }

  // 3. Exact base name match
  match = inventoryData?.find(p =>
    p.name.toLowerCase() === productName.toLowerCase()
  );
  if (match) {
    console.log(`✅ Base name match: ${match.name}`);
    return match;
  }

  // Prepare word tokens (significant words only)
  const baseNormalized = normalize(productName);
  const productWords = baseNormalized.split(' ').filter(w => w.length > 2);

  // If only a single significant word, disallow fuzzy / substring / similarity
  // This prevents generic single tokens from attaching to larger product names.
  if (productWords.length === 1) {
    const single = productWords[0];

    // Allow only inventory names that are exactly that single word (normalized)
    match = inventoryData?.find(p => normalize(p.name) === single);
    if (match) {
      console.log(`✅ Exact single-word inventory name match: ${match.name}`);
      return match;
    }

    console.log(`❌ Single-word "${single}" has no exact inventory match; skipping fuzzy to avoid false positives`);
    return null;
  }

  // From here on we have at least 2 significant words -> allow controlled fuzzy matching.

  // 4. Keyword containment: require at least 2 distinct product words present
  match = inventoryData?.find(p => {
    const inv = normalize(p.name);
    const count = productWords.filter(w => inv.includes(w)).length;
    return count >= 2;
  });
  if (match) {
    console.log(`✅ Multi-word containment match: ${match.name}`);
    return match;
  }

  // 5. Similarity scoring (multi-word)
  const candidates = inventoryData.map(p => {
    const invWords = normalize(p.name).split(' ').filter(w => w.length > 2);
    const matchingWords = productWords.filter(w =>
      invWords.some(iw => iw === w || iw.includes(w) || w.includes(iw))
    );
    const overlapScore = matchingWords.length / productWords.length; // focus on how much of parsed name is covered
    return { product: p, matchingWords, overlapScore };
  }).filter(c => c.matchingWords.length >= 2); // need at least 2 overlapping words

  candidates.sort((a, b) => b.overlapScore - a.overlapScore);

  if (candidates.length > 0 && candidates[0].overlapScore >= 0.5) {
    match = candidates[0].product;
    console.log(
      `✅ Similarity match ${(candidates[0].overlapScore * 100).toFixed(1)}%: ${match.name}`
    );
    return match;
  }

  console.log(`❌ No match found for: ${fullProductName}`);
  return null;
};

// Create a fallback component
const ErrorFallback = ({ error, resetErrorBoundary }: { error: Error, resetErrorBoundary: () => void }) => {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-red-600">Something went wrong:</h2>
      <pre className="mt-4 p-4 bg-red-50 rounded-md text-sm overflow-auto">
        {error.message}
      </pre>
      <Button 
        className="mt-4" 
        onClick={resetErrorBoundary}
        variant="outline"
      >
        Try Again
      </Button>
    </div>
  );
};

// Add right after existing interfaces
interface OrderInventoryAllocations {
  [productName: string]: {
    total: number;
    items: {
      batch_id: string;
      unit_cogs: number;
      batch_number: number;
    }[];
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
  const [searchQuery, setSearchQuery] = useState('');
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

  // Add this new state for processed count
  const [processedCount, setProcessedCount] = useState<number>(0);

  // Add these new state variables at the top of your Orders component
  const [successCount, setSuccessCount] = useState<number>(0);
  const [failedCount, setFailedCount] = useState<number>(0);

  // NEW: Add these states for bulk selection
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // NEW: Helper functions for selection
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedOrders(new Set(orders.map(order => order.id)));
    } else {
      setSelectedOrders(new Set());
    }
  };

  const handleSelectOrder = (orderId: string, checked: boolean) => {
    const newSelected = new Set(selectedOrders);
    if (checked) {
      newSelected.add(orderId);
    } else {
      newSelected.delete(orderId);
    }
    setSelectedOrders(newSelected);
  };

  const isAllSelected = orders.length > 0 && selectedOrders.size === orders.length;
  const isIndeterminate = selectedOrders.size > 0 && selectedOrders.size < orders.length;

  // NEW: Bulk delete function
  const handleBulkDelete = async () => {
    if (selectedOrders.size === 0) return;
    
    setIsBulkDeleting(true);
    let successCount = 0;
    let failureCount = 0;
    
    try {
      const ordersToDelete = orders.filter(order => selectedOrders.has(order.id));
      
      for (const order of ordersToDelete) {
        try {
          // Check if we need to add items back to inventory
          if (order.order_status !== 'returned' && !order.return_received) {
            // Fetch the order's inventory allocations
            const { data: allocOrder, error: allocErr } = await supabase
              .from('orders')
              .select('inventory_allocations')
              .eq('id', order.id)
              .single();

            if (allocErr) throw allocErr;
            
            const allocations: OrderInventoryAllocations = allocOrder?.inventory_allocations || {};
            const productEntries = Object.entries(allocations);

            if (productEntries.length > 0) {
              console.log(`Restoring inventory for order ${order.order_id}`);
              
              // Process each product allocation
              for (const [productName, alloc] of productEntries) {
                if (!alloc?.items?.length) continue;

                // Get product row (exact ilike)
                const { data: prodRow, error: prodErr } = await supabase
                  .from('products')
                  .select('id,current_stock')
                  .ilike('name', productName)
                  .maybeSingle();
                
                if (prodErr) throw prodErr;
                if (!prodRow) {
                  console.warn(`Product "${productName}" not found during restoration.`);
                  continue;
                }

                // Group by batch_id to restore quantities efficiently
                const batchGroups: Record<string, number> = {};
                alloc.items.forEach(it => {
                  batchGroups[it.batch_id] = (batchGroups[it.batch_id] || 0) + 1;
                });

                // Restore to each batch
                for (const [batchId, qty] of Object.entries(batchGroups)) {
                  const { data: batchRow, error: batchErr } = await supabase
                    .from('inventory_batches')
                    .select('remaining_quantity')
                    .eq('id', batchId)
                    .single();
                    
                  if (batchErr) throw batchErr;
                  if (!batchRow) {
                    console.warn(`Batch ${batchId} missing; skipping.`);
                    continue;
                  }
                  
                  // Update batch quantity
                  const { error: updBatchErr } = await supabase
                    .from('inventory_batches')
                    .update({ remaining_quantity: batchRow.remaining_quantity + qty })
                    .eq('id', batchId);
                
                  if (updBatchErr) throw updBatchErr;
                }

                // Update product stock (increase by allocation total)
                const { error: updProdErr } = await supabase
                  .from('products')
                  .update({ current_stock: (prodRow.current_stock || 0) + alloc.total })
                  .eq('id', prodRow.id);
                
                if (updProdErr) throw updProdErr;
              }
            }
          }
          
          // Delete the order
          const { error } = await supabase
            .from('orders')
            .delete()
            .eq('id', order.id);
        
          if (error) throw error;
          
          successCount++;
        } catch (error: any) {
          console.error(`Error deleting order ${order.order_id}:`, error);
          failureCount++;
        }
      }
      
      // Update orders list
      setOrders(orders.filter(order => !selectedOrders.has(order.id)));
      
      // Clear selection
      setSelectedOrders(new Set());
      
      toast({
        title: "Bulk Delete Complete",
        description: `${successCount} orders deleted successfully${failureCount > 0 ? `, ${failureCount} failed` : ''}`,
        variant: failureCount > 0 ? "destructive" : "default",
      });
      
    } catch (error: any) {
      console.error('Error in bulk delete:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete orders",
        variant: "destructive",
      });
    } finally {
      setIsBulkDeleting(false);
      setBulkDeleteConfirmOpen(false);
    }
  };

  // Move these functions right after your state declarations but before useEffects
  const generateCSV = () => {
    const headers = [
      'Order ID',
      'Tracking Number',
      'Customer Name',
      'Customer Phone',
      'Customer City',
      'Customer Address',
      'Product Name',
      'Amount',
      'Order Status',
      'Courier Fee',
      'COGS',
      'Dispatch Date',
      'Return Received'
    ];

    const rows = orders.map(order => [
      order.order_id,
      order.tracking_number,
      order.customer_name,
      order.customer_phone,
      order.customer_city,
      order.customer_address,
      order.product_name,
      order.amount,
      order.order_status,
      order.courier_fee || 0,
      order.cogs || 0,
      order.dispatch_date,
      order.return_received ? 'Yes' : 'No'
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    return csvContent;
  };

  const downloadCSV = (csvContent: string, filename: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCheckOrderStatuses = async () => {
    setIsCheckingStatuses(true);
    try {
      await checkAndUpdateOrderStatuses();
      toast({
        title: "Success",
        description: "Order statuses updated successfully",
      });
      // Refresh orders after checking statuses
      fetchOrders();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to check order statuses",
        variant: "destructive",
      });
    } finally {
      setIsCheckingStatuses(false);
    }
  };

  useEffect(() => {
    // Fetch orders first, then calculate totals and stats
    fetchOrders().then(() => {
      // These calculations will now run after orders are fetched
      calculateCOGSAndCourierStats();
      setProductTotals(calculateProductTotals(orders));
    });
  }, [selectedMonth, date, useCustomDateRange, searchQuery, statusFilter]); // Keep existing dependencies

  // Add another useEffect to ensure calculations happen when orders data is available
  useEffect(() => {
    if (orders.length > 0) {
      calculateCOGSAndCourierStats();
      setProductTotals(calculateProductTotals(orders));
    }
  }, [orders]); // This will trigger whenever orders change

  // Update fetchOrders to search by both order_id and customer_name
  const fetchOrders = async () => {
    const seq = ++fetchSeq.current;

    let query = supabase.from('orders').select('*');
    
    // Apply date filtering
    if (useCustomDateRange && date?.from) {
      const fromStr = format(date.from, 'yyyy-MM-dd');
      const toDate = date.to ?? date.from;
      const toNextDay = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1);
      const toNextDayStr = format(toNextDay, 'yyyy-MM-dd');

      query = query.gte('dispatch_date', fromStr).lt('dispatch_date', toNextDayStr);
    } else {
      const [year, month] = selectedMonth.split('-').map(Number);
      const monthStart = new Date(year, month - 1, 1);
      const nextMonthStart = new Date(year, month, 1);
      const monthStartStr = format(monthStart, 'yyyy-MM-dd');
      const nextMonthStartStr = format(nextMonthStart, 'yyyy-MM-dd');

      query = query.gte('dispatch_date', monthStartStr).lt('dispatch_date', nextMonthStartStr);
    }
    
    // Updated search logic to include both order_id and customer_name
    if (searchQuery.trim()) {
      // Use the .or() method to search in both columns
      query = query.or(`order_id.ilike.%${searchQuery.trim()}%,customer_name.ilike.%${searchQuery.trim()}%`);
    }

    if (statusFilter) {
      query = query.eq('order_status', statusFilter);
    }

    const { data, error } = await query.order('dispatch_date', { ascending: false });

    if (seq !== fetchSeq.current) return;

    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch orders",
        variant: "destructive",
      });
    } else {
      // Map the data directly
      const mappedOrders = (data || []).map((item) => ({
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
        customer_city: item.customer_city || '',
        precogs: item.precogs,
        cogs: item.cogs
      }));

      setOrders(mappedOrders);
      
      // Automatically update COGS for delivered orders that don't have it set
      updateOrderCOGSOnDelivery(mappedOrders);
    }
  };

  // Helper function to get status colors for icons and badges
  const getStatusColor = (status: string): { bg: string, text: string, icon: string } => {
    const normalizedStatus = status.toLowerCase();
    
    const statusColors: Record<string, { bg: string, text: string, icon: string }> = {
      delivered: { bg: "bg-green-100", text: "text-green-800", icon: "text-green-500" },
      returned: { bg: "bg-yellow-100", text: "text-yellow-800", icon: "text-yellow-500" },
      unbooked: { bg: "bg-gray-100", text: "text-gray-800", icon: "text-gray-500" },
      "postex warehouse": { bg: "bg-purple-100", text: "text-purple-800", icon: "text-purple-500" },
      "out for delivery": { bg: "bg-blue-100", text: "text-blue-800", icon: "text-blue-500" },
      "picked by postex": { bg: "bg-indigo-100", text: "text-indigo-800", icon: "text-indigo-500" },
      "delivery under review": { bg: "bg-orange-100", text: "text-orange-800", icon: "text-orange-500" },
      "out for return": { bg: "bg-red-100", text: "text-red-800", icon: "text-red-500" },
      attempted: { bg: "bg-pink-100", text: "text-pink-800", icon: "text-pink-500" },
      "en-route to islamabad warehouse": { bg: "bg-blue-100", text: "text-blue-800", icon: "text-blue-500" },
      dispatched: { bg: "bg-blue-100", text: "text-blue-800", icon: "text-blue-500" },
      failed: { bg: "bg-red-100", text: "text-red-800", icon: "text-red-500" },
    };
    
    return statusColors[normalizedStatus] || { bg: "bg-gray-100", text: "text-gray-800", icon: "text-gray-500" };
  };
  
  // Update the status badge function to use the color helper
  const getStatusBadge = (status: string) => {
    const { bg, text } = getStatusColor(status);
    
    return (
      <Badge className={`${bg} ${text}`}>
        {status}
      </Badge>
    );
  };

  // Move these function implementations here, before the return statement
  // Add the handleDateSelect function
  const handleDateSelect = (selectedDate: DateRange | undefined) => {
    setDate(selectedDate);
    if (selectedDate?.from) {
      setUseCustomDateRange(true);
    }
  };

  // Add the clearDateSelection function
  const clearDateSelection = () => {
    setDate(undefined);
    setUseCustomDateRange(false);
  };

  // Add the handleStatusFilterChange function
  const handleStatusFilterChange = (status: string | null) => {
    setStatusFilter(status);
  };

  // Replace the toggleReturnStatus function with this implementation
  const toggleReturnStatus = async (order: Order) => {
    try {
      const wasReceived = order.return_received;
      const newStatus = !wasReceived;

      // Update flag first (optimistic)
      setOrders(orders.map(o => o.id === order.id ? { ...o, return_received: newStatus } : o));

      // Fetch the order's inventory allocations
      const { data: allocOrder, error: allocErr } = await supabase
        .from('orders')
        .select('inventory_allocations')
        .eq('id', order.id)
        .single();

      if (allocErr) throw allocErr;
      const allocations: OrderInventoryAllocations = allocOrder?.inventory_allocations || {};
      const productEntries = Object.entries(allocations);

      if (productEntries.length === 0) {
        console.log('No inventory allocations stored; nothing to restore or remove.');
      } else {
        // When changing from TRUE to FALSE (return received -> not received)
        if (wasReceived && !newStatus) {
          // REMOVE items from inventory (reverse of restoration)
          for (const [productName, alloc] of productEntries) {
            if (!alloc?.items?.length) continue;

            // Get product row (exact ilike)
            const { data: prodRow, error: prodErr } = await supabase
              .from('products')
              .select('id,current_stock')
              .ilike('name', productName)
              .maybeSingle();
            if (prodErr) throw prodErr;
            if (!prodRow) {
              console.warn(`Product "${productName}" not found during inventory removal.`);
              continue;
            }

            // Group by batch_id
            const batchGroups: Record<string, number> = {};
            alloc.items.forEach(it => {
              batchGroups[it.batch_id] = (batchGroups[it.batch_id] || 0) + 1;
            });

            // Remove from each batch
            for (const [batchId, qty] of Object.entries(batchGroups)) {
              const { data: batchRow, error: batchErr } = await supabase
                .from('inventory_batches')
                .select('remaining_quantity')
                .eq('id', batchId)
                .single();
              if (batchErr) throw batchErr;
              if (!batchRow) {
                console.warn(`Batch ${batchId} missing; skipping.`);
                continue;
              }
              const { error: updBatchErr } = await supabase
                .from('inventory_batches')
                .update({ remaining_quantity: batchRow.remaining_quantity - qty })
                .eq('id', batchId);
              if (updBatchErr) throw updBatchErr;
            }

            // Update product stock (reduce by allocation total)
            const { error: updProdErr } = await supabase
              .from('products')
              .update({ current_stock: Math.max((prodRow.current_stock || 0) - alloc.total, 0) })
              .eq('id', prodRow.id);
            if (updProdErr) throw updProdErr;
          }
          console.log(`Inventory removed for order ${order.order_id} (return marked as not received)`);
        } 
        // When changing from FALSE to TRUE (not received -> return received)
        else if (!wasReceived && newStatus) {
          // ADD items back to inventory (restoration)
          for (const [productName, alloc] of productEntries) {
            if (!alloc?.items?.length) continue;

            // Get product row (exact ilike)
            const { data: prodRow, error: prodErr } = await supabase
              .from('products')
              .select('id,current_stock')
              .ilike('name', productName)
              .maybeSingle();
            if (prodErr) throw prodErr;
            if (!prodRow) {
              console.warn(`Product "${productName}" not found during restoration.`);
              continue;
            }

            // Group by batch_id
            const batchGroups: Record<string, number> = {};
            alloc.items.forEach(it => {
              batchGroups[it.batch_id] = (batchGroups[it.batch_id] || 0) + 1;
            });

            // Restore each batch
            for (const [batchId, qty] of Object.entries(batchGroups)) {
              const { data: batchRow, error: batchErr } = await supabase
                .from('inventory_batches')
                .select('remaining_quantity')
                .eq('id', batchId)
                .single();
              if (batchErr) throw batchErr;
              if (!batchRow) {
                console.warn(`Batch ${batchId} missing; skipping.`);
                continue;
              }
              const { error: updBatchErr } = await supabase
                .from('inventory_batches')
                .update({ remaining_quantity: batchRow.remaining_quantity + qty })
                .eq('id', batchId);
              if (updBatchErr) throw updBatchErr;
            }

            // Update product stock
            const { error: updProdErr } = await supabase
              .from('products')
              .update({ current_stock: (prodRow.current_stock || 0) + alloc.total })
              .eq('id', prodRow.id);
            if (updProdErr) throw updProdErr;
          }
          console.log(`Inventory restored for order ${order.order_id} (return marked as received)`);
        }
      }

      // Persist return_received flag
      const { error: updFlagErr } = await supabase
        .from('orders')
        .update({ return_received: newStatus })
        .eq('id', order.id);
      if (updFlagErr) throw updFlagErr;

      toast({
        title: "Success",
        description: newStatus
          ? "Return received. Inventory restored to batches."
          : "Return status unset. Inventory removed from batches."
      });
    } catch (e: any) {
      console.error(e);
      // Revert optimistic change on failure
      setOrders(orders.map(o => o.id === order.id ? { ...o, return_received: order.return_received } : o));
      toast({
        title: "Error",
        description: e.message || "Failed to toggle return status",
        variant: "destructive",
      });
    }
  };

  // Update the handlePdfUpload function to correctly calculate courier fees
  const handlePdfUpload = async (pdfType: 'dispatch' | 'return') => {
    if (!pdfFile) return;
    
    setIsProcessing(true);
    setProcessedCount(0);
    setSuccessCount(0);
    setFailedCount(0);

    try {
      const fileData = await pdfFile.arrayBuffer();
      
      // Try to debug PDF content first
      console.log("PDF upload started, extracting content...");
      
      // Load the PDF document
      const pdf = await pdfjs.getDocument({ data: fileData }).promise;
      console.log(`PDF loaded successfully with ${pdf.numPages} pages`);
      
      // Extract and show the full text for debugging
      let fullText = '';
      for (let i = 1; i <= Math.min(pdf.numPages, 2); i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        fullText += pageText + '\n\n';
      }
      
      // Log a sample of the text to help debug tracking number extraction
      console.log(`PDF text sample (first 500 chars): ${fullText.substring(0, 500)}`);
      
      const numPages = pdf.numPages;
      let extractedData = [];

      // Debug logging for PDF processing
      console.log(`Processing PDF with ${numPages} pages`);

      // Enhanced tracking number extraction
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        
        console.log(`Page ${i} text length: ${pageText.length} characters`);
        
        // Try different regex patterns to extract tracking numbers
        const patterns = [
          /\b(\d{14})\b/g,                      // Basic 14-digit number
          /tracking\s*(?:number|no|#)?[:\s]*(\d{14})/gi, // "tracking number: XXXXXX" format
          /waybill\s*(?:number|no|#)?[:\s]*(\d{14})/gi,  // "waybill number: XXXXXX" format
          /consignment\s*(?:number|no|#)?[:\s]*(\d{14})/gi // "consignment number: XXXXXX" format
        ];
        
        let foundNumbers = [];
        
        for (const pattern of patterns) {
          const matches = [...pageText.matchAll(pattern)];
          for (const match of matches) {
            const trackingNumber = match[1];
            if (trackingNumber && trackingNumber.length === 14) {
              foundNumbers.push(trackingNumber);
            }
          }
        }
        
        console.log(`Found ${foundNumbers.length} tracking numbers on page ${i}`);
        extractedData.push(...foundNumbers.map(num => ({ trackingNumber: num })));
      }

      // Deduplicate tracking numbers
      const uniqueTrackingNumbers = Array.from(new Set(extractedData.map(data => data.trackingNumber)));
      console.log(`Found ${uniqueTrackingNumbers.length} unique tracking numbers`);
      
      // Track successes and failures locally within this function
      let localSuccessCount = 0;
      let localFailedCount = 0;
      
      // Process each tracking number
      for (let i = 0; i < uniqueTrackingNumbers.length; i++) {
        const trackingNumber = uniqueTrackingNumbers[i];
        setProcessedCount(i + 1);
        
        try {
          // Check if tracking number already exists
          const { data: existingOrders } = await supabase
            .from('orders')
            .select('tracking_number')
            .eq('tracking_number', trackingNumber);

          if (existingOrders && existingOrders.length > 0) {
            console.log(`Order with tracking number ${trackingNumber} already exists. Skipping.`);
            localFailedCount++;
            setFailedCount(localFailedCount);
            continue;
          }
          
          console.log(`Fetching details for tracking number: ${trackingNumber}`);
          
          // Log the API call for debugging
          console.log(`Calling PostEx API for tracking number: ${trackingNumber}`);
          
          // Fetch order details from PostEx API
          const orderDetails = await fetchOrderDetails(trackingNumber);
          console.log(`API response for ${trackingNumber}:`, orderDetails);
          
          if (orderDetails && (orderDetails.statusCode === '100' || 
              orderDetails.statusMessage?.includes("SUCCESS"))) {
            const { dist } = orderDetails;
            
            console.log(`Creating order for ${trackingNumber}`);
            
            // Calculate appropriate courier fee based on status
            let courierFee = 0;
            const status = dist.transactionStatus?.toLowerCase() || 'unbooked';
            
            if (status === 'returned') {
              // For returned orders: reversalFee + reversalTax
              courierFee = (dist.reversalFee || 0) + (dist.reversalTax || 0);
            } else {
              // For delivered and other statuses: transactionFee + transactionTax
              courierFee = (dist.transactionFee || 0) + (dist.transactionTax || 0);
            }
            
            // Create a new order in database with correct courier fee
            const { error: insertError } = await supabase.from('orders').insert({
              tracking_number: trackingNumber,
              order_id: dist.orderRefNumber || `Unknown-${Date.now()}`,
              customer_name: dist.customerName || 'Unknown',
              customer_phone: dist.customerPhone || '',
              customer_address: dist.deliveryAddress || '',
              customer_city: dist.cityName || '',
              product_name: dist.orderDetail || '',
              amount: dist.invoicePayment || 0,
              courier_fee: courierFee, // Updated to use the correctly calculated fee
              order_status: status,
              dispatch_date: new Date().toISOString().split('T')[0],
              return_received: false
            });

            if (insertError) {
              console.error(`Error inserting order ${trackingNumber}:`, insertError);
              localFailedCount++;
              setFailedCount(localFailedCount);
              continue;
            }
            
            // Update inventory if product details exist
            if (dist.orderDetail) {
              try {
                const { allocations, totalPrecogs } = await processInventoryUpdatesWithFifo(
                  dist.orderDetail,
                  -1
                );

                if (totalPrecogs > 0) {
                  await supabase
                    .from('orders')
                    .update({
                      precogs: totalPrecogs,
                      inventory_allocations: allocations
                    })
                    .eq('tracking_number', trackingNumber);
                }

                localSuccessCount++;
                setSuccessCount(localSuccessCount);
              } catch (inventoryError: any) {
                console.error(`Inventory error for ${trackingNumber}:`, inventoryError.message);
                
                // Delete the order we just created since inventory failed
                await supabase
                  .from('orders')
                  .delete()
                  .eq('tracking_number', trackingNumber);
                
                console.log(`Deleted order ${trackingNumber} due to inventory failure`);
                
                localFailedCount++;
                setFailedCount(localFailedCount);
              }
            } else {
              console.log(`No product details for ${trackingNumber}, marking as success`);
              // No product details but order created successfully
              localSuccessCount++;
              setSuccessCount(localSuccessCount);
            }
          } else {
            // API error or no data
            console.error(`API error for ${trackingNumber}:`, orderDetails?.statusMessage || 'Unknown error');
            localFailedCount++;
            setFailedCount(localFailedCount);
          }
        } catch (error: any) {
          console.error(`Error processing tracking number ${trackingNumber}:`, error.message);
          localFailedCount++;
          setFailedCount(localFailedCount);
        }
      }
      
      // Now show the toast with the final counts
      toast({
        title: "Processing Complete",
        description: `Processed ${uniqueTrackingNumbers.length} orders: ${localSuccessCount} successful, ${localFailedCount} failed`,
      });
      
      // Refresh orders list
      fetchOrders();
      
    } catch (error: any) {
      console.error('Error processing PDF:', error);
      toast({
        title: "Error",
        description: `Failed to process PDF file: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setPdfFile(null);
    }
  };

  // Add the calculateProductTotals function
  const calculateProductTotals = (orders: Order[]): ProductTotals => {
    const totals: ProductTotals = {};
    
    for (const order of orders) {
      if (!order.product_name) continue;
      
      const parsedProducts = parseProductDescriptions(order.product_name);
      
      for (const product of parsedProducts) {
        const fullName = product.fullProductName;

        if (!totals[fullName]) {
          totals[fullName] = {
            total: 0,
            variants: {},
            baseName: product.product
          };
        }
        
        // Add to total for this product
        totals[fullName].total += product.quantity;
        
        // Track by variant
        const variantKey = product.variant || 'Default';
        if (!totals[fullName].variants[variantKey]) {
          totals[fullName].variants[variantKey] = 0;
        }
        totals[fullName].variants[variantKey] += product.quantity;
      }
    }
    
    return totals;
  };

  // Fix the calculateCOGSAndCourierStats function to correctly count delivered orders
  const calculateCOGSAndCourierStats = () => {
    let totalCOGS = 0;
    let totalCourierFees = 0;
    let deliveredCount = 0;
    let returnedCount = 0;
    const productCOGSBreakdown: Record<string, number> = {};

    for (const order of orders) {
      // Count all orders with "delivered" status
      if (order.order_status === 'delivered') {
        deliveredCount++;
        
        // Add courier fees if they exist
        if (order.courier_fee) {
          totalCourierFees += order.courier_fee;
        }
        
        // COGS calculation for delivered orders
        if (order.cogs) {
          totalCOGS += order.cogs;
          
          // Track COGS by product
          const parsedProducts = parseProductDescriptions(order.product_name);
          for (const product of parsedProducts) {
            const fullName = product.fullProductName;
            const productCOGS = (order.cogs / parsedProducts.length) * product.quantity;
            
            if (!productCOGSBreakdown[fullName]) {
              productCOGSBreakdown[fullName] = 0;
            }
            productCOGSBreakdown[fullName] += productCOGS;
          }
        }
      }
      
      // Handle returned orders separately
      if (order.order_status === 'returned') {
        returnedCount++;
        
        // Add courier fees for returned orders
        if (order.courier_fee) {
          totalCourierFees += order.courier_fee;
        }
      }
    }
    
    // Calculate average courier fee
    const deliveredAndReturnedCount = deliveredCount + returnedCount;
    const avgCourierFee = deliveredAndReturnedCount > 0 
      ? totalCourierFees / deliveredAndReturnedCount
      : 0;

    setCogsStats({
      totalCOGS,
      totalCourierFees,
      avgCourierFee,
      productCOGSBreakdown,
      deliveredAndReturnedCount,
      deliveredCount,
      returnedCount
    });
  };

  // Add the updateOrderCOGSOnDelivery function
  const updateOrderCOGSOnDelivery = async (orders: Order[]) => {
    const ordersToUpdate = orders.filter(order => 
      order.order_status === 'delivered' && 
      !order.cogs && 
      order.precogs
    );

    if (ordersToUpdate.length === 0) return;

    for (const order of ordersToUpdate) {
      try {
        await supabase
          .from('orders')
          .update({ cogs: order.precogs })
          .eq('id', order.id);
          
        console.log(`Updated COGS for order ${order.order_id}`);
      } catch (error) {
        console.error(`Error updating COGS for order ${order.order_id}:`, error);
      }
    }
    
    // Refresh orders to get the updated COGS values
    fetchOrders();
  };

  // Add the openDeleteConfirm function
  const openDeleteConfirm = (order: Order) => {
    setOrderToDelete(order);
    setDeleteConfirmOpen(true);
  };

  // Update the handleDeleteOrder function
  const handleDeleteOrder = async () => {
    if (!orderToDelete) return;
    
    try {
      // Check if we need to add items back to inventory
      if (orderToDelete.order_status !== 'returned' && !orderToDelete.return_received) {
        // Fetch the order's inventory allocations
        const { data: allocOrder, error: allocErr } = await supabase
          .from('orders')
          .select('inventory_allocations')
          .eq('id', orderToDelete.id)
          .single();

        if (allocErr) throw allocErr;
        
        const allocations: OrderInventoryAllocations = allocOrder?.inventory_allocations || {};
        const productEntries = Object.entries(allocations);

        if (productEntries.length === 0) {
          console.log('No inventory allocations stored; nothing to restore');
        } else {
          console.log(`Restoring inventory for order ${orderToDelete.order_id}`);
          
          // Process each product allocation
          for (const [productName, alloc] of productEntries) {
            if (!alloc?.items?.length) continue;

            // Get product row (exact ilike)
            const { data: prodRow, error: prodErr } = await supabase
              .from('products')
              .select('id,current_stock')
              .ilike('name', productName)
              .maybeSingle();
              
            if (prodErr) throw prodErr;
            if (!prodRow) {
              console.warn(`Product "${productName}" not found during restoration.`);
              continue;
            }

            // Group by batch_id to restore quantities efficiently
            const batchGroups: Record<string, number> = {};
            alloc.items.forEach(it => {
              batchGroups[it.batch_id] = (batchGroups[it.batch_id] || 0) + 1;
            });

            // Restore to each batch
            for (const [batchId, qty] of Object.entries(batchGroups)) {
              const { data: batchRow, error: batchErr } = await supabase
                .from('inventory_batches')
                .select('remaining_quantity')
                .eq('id', batchId)
                .single();
                
              if (batchErr) throw batchErr;
              if (!batchRow) {
                console.warn(`Batch ${batchId} missing; skipping.`);
                continue;
              }
              
              // Update batch quantity
              const { error: updBatchErr } = await supabase
                .from('inventory_batches')
                .update({ remaining_quantity: batchRow.remaining_quantity + qty })
                .eq('id', batchId);
              
              if (updBatchErr) throw updBatchErr;
            }

            // Update product stock (increase by allocation total)
            const { error: updProdErr } = await supabase
              .from('products')
              .update({ current_stock: (prodRow.current_stock || 0) + alloc.total })
              .eq('id', prodRow.id);
            
            if (updProdErr) throw updProdErr;
          }
          
          console.log(`Inventory restoration completed for order ${orderToDelete.order_id}`);
        }
      }
      
      // Delete the order
      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderToDelete.id);
    
      if (error) throw error;
    
      // Update orders list
      setOrders(orders.filter(o => o.id !== orderToDelete.id));
    
      toast({
        title: "Success",
        description: `Order ${orderToDelete.order_id} deleted successfully`,
      });
    
      // Close the dialog
      setDeleteConfirmOpen(false);
      setOrderToDelete(null);
    } catch (error: any) {
      console.error('Error deleting order:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete order",
        variant: "destructive",
      });
    }
  };

  // Add functions for editing order amount
  const startEditing = (order: Order) => {
    setEditingOrder(order.id);
    setEditingAmount(order.amount.toString());
  };

  const handleAmountUpdate = async (orderId: string) => {
    try {
      const amount = parseFloat(editingAmount);
      if (isNaN(amount)) {
        throw new Error("Invalid amount");
      }
      
      // Update database
      const { error } = await supabase
        .from('orders')
        .update({ amount })
        .eq('id', orderId);
      
      if (error) throw error;
      
      // Update local state
      setOrders(orders.map(order => 
        order.id === orderId ? { ...order, amount } : order
      ));
      
      toast({
        title: "Success",
        description: "Order amount updated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update order amount",
        variant: "destructive",
      });
    } finally {
      // Reset editing state
      setEditingOrder(null);
    }
  };

  // Helper function for inventory updates (stub implementation if you don't have this defined)
  const processInventoryUpdates = async (productName: string, quantity: number) => {
    // Implement or reference your inventory update function here
    console.log(`Processing inventory update for ${productName}, quantity: ${quantity}`);
    // Actual implementation would interact with your inventory system
  };

  // REPLACE processInventoryUpdatesWithFifo with this version
  const processInventoryUpdatesWithFifo = async (
    rawProductLine: string,
    sign: 1 | -1
  ): Promise<{ allocations: OrderInventoryAllocations; totalPrecogs: number }> => {
    const parsed = parseProductDescriptions(rawProductLine);
    const allocations: OrderInventoryAllocations = {};
    let totalPrecogs = 0;

    for (const p of parsed) {
      const fullName = p.fullProductName;

      // Exact (case-insensitive) match only
      const { data: product } = await supabase
        .from('products')
        .select('id,name,current_stock')
        .ilike('name', fullName)
        .maybeSingle();

      if (!product) {
        console.warn(`No exact product match in inventory for "${fullName}". Skipping.`);
        continue; // Skip instead of throwing so other items still process
      }

      if (sign === -1) {
        // Consume stock with FIFO
        if ((product.current_stock || 0) < p.quantity) {
          console.warn(`Insufficient stock for "${product.name}". Needed ${p.quantity}, have ${product.current_stock || 0}. Skipping.`);
          continue;
        }

        const { data: batches } = await supabase
          .from('inventory_batches')
          .select('id,remaining_quantity,cogs,batch_number,batch_datetime,created_at')
          .eq('product_id', product.id)
          .gt('remaining_quantity', 0)
          .order('batch_datetime', { ascending: true })
          .order('created_at', { ascending: true });

        if (!batches || batches.length === 0) {
          console.warn(`No available batches for "${product.name}". Skipping.`);
          continue;
        }

        let needed = p.quantity;
        const itemEntries: { batch_id: string; batch_number: number; unit_cogs: number }[] = [];

        for (const b of batches) {
          if (needed <= 0) break;
          const take = Math.min(needed, b.remaining_quantity);
          if (take <= 0) continue;

          // Update batch remaining
          await supabase
            .from('inventory_batches')
            .update({ remaining_quantity: b.remaining_quantity - take })
            .eq('id', b.id);

          for (let i = 0; i < take; i++) {
            itemEntries.push({
              batch_id: b.id,
              batch_number: b.batch_number || 0,
              unit_cogs: b.cogs
            });
            totalPrecogs += b.cogs;
          }
          needed -= take;
        }

        // Update product stock if we actually consumed anything
        const consumed = p.quantity - needed;
        if (consumed > 0) {
          await supabase
            .from('products')
            .update({ current_stock: (product.current_stock || 0) - consumed })
            .eq('id', product.id);

          allocations[product.name] = {
            total: consumed,
            items: itemEntries
          };
        }
      } else {
        // sign === 1 restore path (not used here but kept for symmetry)
        // You could implement restoration logic using stored allocations
      }
    }

    return { allocations, totalPrecogs };
  };

  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => {
        fetchOrders();
      }}
    >
      <div className="space-y-6">
        {/* Top section with controls */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          {/* Existing heading and controls */}
          <div>
            <h2 className="text-2xl font-bold">Orders Management</h2>
            <p className="text-muted-foreground">Track and manage parcel operations</p>
          </div>

          {/* Controls: stack on mobile, row on md+ */}
          <div className="w-full md:w-auto flex flex-col md:flex-row gap-2 md:gap-4">
            {/* Check Status - unchanged */}
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
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 0-9-9V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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

            {/* Updated Search - now includes placeholder for name search */}
            <div className="relative w-full md:w-[240px]">
              <Input
                type="text"
                placeholder="Search by Order ID or Name"
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

            {/* Existing date selector and month selection - unchanged */}
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

            {/* Month selection (only when not using custom date range) - unchanged */}
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
                {isProcessing
                  ? `Processing... (${processedCount}/${successCount} success/${failedCount} failed)`
                  : 'Process Dispatch PDF'}
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
              <div className="grid gap-2 max-h-64 overflow-auto pr-1">
                {Object.keys(productTotals).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No products found in current orders
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {Object.entries(productTotals).map(([name, data]) => (
                      <div
                        key={name}
                        className="flex justify-between items-center p-2 border rounded-md bg-muted/30"
                      >
                        <span
                          className="text-sm font-medium mr-2 break-words"
                          style={{ wordBreak: 'break-word', maxWidth: '70%' }}
                          title={name}
                        >
                          {name}
                        </span>
                        <Badge variant="secondary" className="ml-auto shrink-0">
                          {data.total} units
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="mt-4 pt-4 border-t flex justify-between items-center">
                <span className="text-sm font-semibold">Total Products:</span>
                <Badge variant="outline" className="text-sm">
                  {Object.values(productTotals).reduce((a, b) => a + b.total, 0)} units
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* COGS and Courier Summary Card */}
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
                    .sort(([, a], [, b]) => b - a)
                    .map(([product, cogs]) => (
                      <div key={product} className="flex justify-between p-2 border rounded-md bg-muted/20">
                        <div className="flex items-center space-x-2 truncate" style={{ maxWidth: '70%' }}>
                          <span className="text-xs font-medium truncate" title={product}>
                            {product}
                          </span>
                        </div>
                        <span className="text-xs font-bold whitespace-nowrap">
                          PKR {Math.round(cogs).toLocaleString()}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Orders Table Section */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle>Orders ({orders.length})</CardTitle>
                <CardDescription>
                  {useCustomDateRange ? (
                    date?.from ? (
                      date.to ? (
                        <>Showing orders from {format(date.from, "MMM d, y")} to {format(date.to, "MMM d, y")}</>
                      ) : (
                        <>Showing orders for {format(date.from, "MMM d, y")}</>
                      )
                    ) : (
                      "Select a date range to view orders"
                    )
                  ) : (
                    <>Showing orders for {new Date(selectedMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</>
                  )}
                  {selectedOrders.size > 0 && (
                    <span className="block text-sm text-blue-600 mt-1">
                      {selectedOrders.size} order{selectedOrders.size > 1 ? 's' : ''} selected
                    </span>
                  )}
                </CardDescription>
              </div>
              
              {/* Status Filter and Bulk Delete Button Container */}
              <div className="flex items-center gap-2">
                {/* Status Filter with color indicators */}
                <Select value={statusFilter || 'all'} onValueChange={(value) => handleStatusFilterChange(value === 'all' ? null : value)}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Filter by status">
                      {statusFilter ? (
                        <div className="flex items-center">
                          <div className={`w-3 h-3 rounded-full mr-2 ${getStatusColor(statusFilter).bg}`}></div>
                          <span>{statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}</span>
                        </div>
                      ) : (
                        "All Statuses"
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full bg-gray-400 mr-2"></div>
                        <span>All Statuses</span>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="delivered">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
                        <span>Delivered</span>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="returned">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></div>
                        <span>Returned</span>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="unbooked">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full bg-gray-500 mr-2"></div>
                        <span>Unbooked</span>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="postex warehouse">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full bg-purple-500 mr-2"></div>
                        <span>Postex Warehouse</span>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="out for delivery">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full bg-blue-500 mr-2"></div>
                        <span>Out for Delivery</span>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="picked by postex">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full bg-indigo-500 mr-2"></div>
                        <span>Picked by Postex</span>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="delivery under review">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full bg-orange-500 mr-2"></div>
                        <span>Delivery Under Review</span>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="out for return">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full bg-red-500 mr-2"></div>
                        <span>Out for Return</span>
                      </div>
                    </SelectItem>
                    
                    <SelectItem value="attempted">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full bg-pink-500 mr-2"></div>
                        <span>Attempted</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>

                {/* Bulk Delete Button - positioned next to status filter */}
                {selectedOrders.size > 0 && (
                  <Button
                    onClick={() => setBulkDeleteConfirmOpen(true)}
                    disabled={isBulkDeleting}
                    variant="destructive"
                    size="sm"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete ({selectedOrders.size})
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={isAllSelected}
                        onCheckedChange={handleSelectAll}
                        ref={(ref) => {
                          if (ref) {
                            ref.indeterminate = isIndeterminate;
                          }
                        }}
                        aria-label="Select all orders"
                      />
                    </TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Tracking #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Products</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Courier Fee</TableHead>
                    <TableHead>COGS</TableHead>
                    <TableHead>Dispatch Date</TableHead>
                    <TableHead>Return Received</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedOrders.has(order.id)}
                          onCheckedChange={(checked) => handleSelectOrder(order.id, checked as boolean)}
                          aria-label={`Select order ${order.order_id}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{order.order_id}</TableCell>
                      <TableCell className="font-mono text-sm">
                        <a 
                          href={`https://postex.pk/tracking?cn=${order.tracking_number}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {order.tracking_number}
                        </a>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{order.customer_name}</div>
                          <div className="text-sm text-muted-foreground">{order.customer_phone}</div>
                        </div>
                      </TableCell>
                      <TableCell>{order.customer_city}</TableCell>
                      <TableCell className="max-w-xs">
                        <div className="truncate" title={order.customer_address}>
                          {order.customer_address}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="truncate" title={order.product_name}>
                          {order.product_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        {editingOrder === order.id ? (
                          <div className="flex items-center space-x-2">
                            <Input
                              type="number" 
                              value={editingAmount}
                              onChange={(e) => setEditingAmount(e.target.value)}
                              className="w-20"
                            />
                            <Button size="sm" onClick={() => handleAmountUpdate(order.id)}>
                              Save
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <span>PKR {order.amount.toLocaleString()}</span>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 w-8 p-0" 
                              onClick={() => startEditing(order)}
                            >
                              <Pencil className="h-4 w-4" />
                              <span className="sr-only">Edit amount</span>
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(order.order_status)}</TableCell>
                      <TableCell>
                        {order.courier_fee ? `PKR ${order.courier_fee.toLocaleString()}` : '-'}
                      </TableCell>
                      <TableCell>
                        {order.order_status === 'delivered' && order.cogs ? (
                          <span className="font-medium">PKR {order.cogs.toLocaleString()}</span>
                        ) : (
                          order.precogs ? (
                            <span className="text-gray-500">PKR {order.precogs.toLocaleString()}</span>
                          ) : (
                            '-'
                          )
                        )}
                      </TableCell>
                      <TableCell>{new Date(order.dispatch_date).toLocaleDateString()}</TableCell>
                      
                      {/* Simplified Return Received Buttons */}
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleReturnStatus(order)}
                          className={cn(
                            "w-16 transition-colors",
                            order.return_received 
                              ? "bg-green-600 hover:bg-green-700 text-white border-green-600" 
                              : "bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200"
                          )}
                        >
                          {order.return_received ? "Yes" : "No"}
                        </Button>
                      </TableCell>
                      
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full text-destructive hover:bg-red-100 hover:text-destructive"
                          onClick={() => openDeleteConfirm(order)}
                          title="Delete Order"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete order {orderToDelete?.order_id}? 
                {orderToDelete && orderToDelete.order_status !== 'returned' && !orderToDelete.return_received && (
                  <span className="block mt-2 text-orange-600">
                    ⚠️ This will also add the items back to inventory since the order hasn't been returned.
                  </span>
                )}
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteOrder}>
                Delete Order
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk Delete Confirmation Dialog */}
        <Dialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Bulk Deletion</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete {selectedOrders.size} selected order{selectedOrders.size > 1 ? 's' : ''}?
                <span className="block mt-2 text-orange-600">
                  ⚠️ For orders that haven't been returned, this will also add the items back to inventory.
                </span>
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setBulkDeleteConfirmOpen(false)}
                disabled={isBulkDeleting}
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 0-9-9V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Deleting...
                  </>
                ) : (
                  `Delete ${selectedOrders.size} Order${selectedOrders.size > 1 ? 's' : ''}`
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ErrorBoundary>
  );
};
