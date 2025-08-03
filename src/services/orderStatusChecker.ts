import { supabase } from "@/integrations/supabase/client";

interface PostExStatusResponse {
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

// The final statuses that don't need further checking
const FINAL_STATUSES = ['delivered', 'returned'];

// Track the checker's running state
let isCheckerRunning = false;

/**
 * Fetch order details from PostEx API
 */
const fetchOrderStatus = async (trackingNumber: string): Promise<PostExStatusResponse | null> => {
  try {
    const response = await fetch(`https://api.postex.pk/services/integration/api/order/v1/track-order/${trackingNumber}`, {
      method: 'GET',
      headers: {
        'token': 'OTMxNzA0NTRhN2E3NGQ4MzkxMDE3YjdmYjEwNzZkM2U6NDYyNGZlMTZhNGRhNDY0NTg4YzhmZDc5OWVkYjEyMDI=',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error(`Error fetching status for ${trackingNumber}: ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Exception fetching status for ${trackingNumber}:`, error);
    return null;
  }
};

/**
 * Update order status and courier fee in the database
 */
const updateOrderStatusAndFee = async (
  trackingNumber: string, 
  status: string, 
  transactionFee: number, 
  transactionTax: number
): Promise<boolean> => {
  try {
    // Only update the status and courier fee fields, not the entire record
    const { error } = await supabase
      .from('orders')
      .update({ 
        order_status: status.toLowerCase(),
        courier_fee: transactionFee + transactionTax
      })
      .eq('tracking_number', trackingNumber);
    
    if (error) {
      console.error(`Error updating order ${trackingNumber}:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Exception updating order ${trackingNumber}:`, error);
    return false;
  }
};

/**
 * Main function to check and update orders
 */
export const checkAndUpdateOrderStatuses = async (): Promise<void> => {
  // Prevent multiple concurrent executions
  if (isCheckerRunning) {
    console.log('Status checker is already running');
    return;
  }
  
  isCheckerRunning = true;
  console.log('Starting order status check...');
  
  try {
    // Get all non-final status orders
    const { data: pendingOrders, error } = await supabase
      .from('orders')
      .select('tracking_number, order_status')
      .not('order_status', 'in', `(${FINAL_STATUSES.join(',')})`);
    
    if (error) {
      console.error('Error fetching pending orders:', error);
      return;
    }
    
    console.log(`Found ${pendingOrders?.length || 0} orders to check`);
    
    // Process each order
    let updatedCount = 0;
    for (const order of (pendingOrders || [])) {
      const orderData = await fetchOrderStatus(order.tracking_number);
      
      if (orderData && orderData.statusCode === "200") {
        const { dist } = orderData;
        
        // Get new status and fees
        const newStatus = dist.transactionStatus.toLowerCase();
        const transactionFee = dist.transactionFee;
        const transactionTax = dist.transactionTax;
        
        // Check if status or fees changed
        const hasNewStatus = newStatus !== order.order_status;
        const hasFees = transactionFee > 0 || transactionTax > 0;
        
        if (hasNewStatus || hasFees) {
          const success = await updateOrderStatusAndFee(
            order.tracking_number, 
            newStatus, 
            transactionFee, 
            transactionTax
          );
          
          if (success) {
            updatedCount++;
            console.log(
              `Updated order ${order.tracking_number}: ` +
              `status ${order.order_status} → ${newStatus}, ` +
              `courier fee: ${transactionFee + transactionTax}`
            );
          }
        }
      }
      
      // Add small delay between API calls to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`Completed order status check. Updated ${updatedCount} orders.`);
  } catch (error) {
    console.error('Error in order status checker:', error);
  } finally {
    isCheckerRunning = false;
  }
};

/**
 * Start the periodic order status checker
 * Runs every 6 hours by default
 */
export const startOrderStatusChecker = (intervalHours = 6): NodeJS.Timeout => {
  // Run once immediately on startup
  checkAndUpdateOrderStatuses();
  
  // Then set up the interval for future checks
  const intervalMs = intervalHours * 60 * 60 * 1000;
  return setInterval(checkAndUpdateOrderStatuses, intervalMs);
};

/**
 * Stop the periodic order status checker
 */
export const stopOrderStatusChecker = (interval: NodeJS.Timeout): void => {
  clearInterval(interval);
};