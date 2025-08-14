import { supabase } from "@/integrations/supabase/client";
import { fetchOrderDetails, POSTEX_API_CONFIG } from "./postexApiService";

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
      .select('tracking_number, order_status, dispatch_date')
      .not('order_status', 'in', `(${FINAL_STATUSES.join(',')})`);
    
    if (error) {
      console.error('Error fetching pending orders:', error);
      return;
    }
    
    console.log(`Found ${pendingOrders?.length || 0} orders to check`);
    
    // Process each order
    const normalize = (d?: string) => (d ? d.slice(0,10) : "");
    let updatedCount = 0;

    for (const order of (pendingOrders || [])) {
      const normalizedDate = normalize(order.dispatch_date);
      const tokenType = normalizedDate && normalizedDate <= POSTEX_API_CONFIG.CUTOFF_DATE ? 'OLD' : 'NEW';
      const orderData = await fetchOrderDetails(order.tracking_number, normalizedDate);

      if (orderData?.statusCode === "200") {
        const { dist } = orderData;
        const newStatus = dist.transactionStatus.toLowerCase();
        if (newStatus !== order.order_status) {
          let courierFeeUpdate: number | undefined;
          if (newStatus === 'delivered') {
            courierFeeUpdate = (dist.transactionFee || 0) + (dist.transactionTax || 0);
          } else if (newStatus === 'returned') {
            courierFeeUpdate = (dist.reversalFee || 0) + (dist.reversalTax || 0);
          }
          const updateObj: any = { order_status: newStatus };
          if (courierFeeUpdate !== undefined) updateObj.courier_fee = courierFeeUpdate;

          await supabase.from('orders')
            .update(updateObj)
            .eq('tracking_number', order.tracking_number);

          console.log(`[${tokenType}] ${order.tracking_number} → ${newStatus}${courierFeeUpdate !== undefined ? ` (fee ${courierFeeUpdate})` : ''}`);
          updatedCount++;
        }
      }
      await new Promise(r => setTimeout(r, 500));
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