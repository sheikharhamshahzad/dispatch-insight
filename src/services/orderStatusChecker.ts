import { supabase } from "@/integrations/supabase/client";
import { fetchBulkOrderDetails, POSTEX_API_CONFIG } from "./postexApiService";

// The final statuses that don't need further checking
const FINAL_STATUSES = ['delivered', 'returned'];

// Track the checker's running state
let isCheckerRunning = false;

// Batch size for bulk API calls (PostEx may have limits)
const BATCH_SIZE = 50;

/**
 * Main function to check and update orders using BULK API
 */
export const checkAndUpdateOrderStatuses = async (): Promise<void> => {
  // Prevent multiple concurrent executions
  if (isCheckerRunning) {
    console.log('Status checker is already running');
    return;
  }
  
  isCheckerRunning = true;
  console.log('Starting bulk order status check...');
  
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
    
    const orders = pendingOrders || [];
    console.log(`Found ${orders.length} orders to check`);
    
    if (orders.length === 0) {
      return;
    }

    // Separate orders by token (OLD vs NEW based on dispatch date)
    const oldTokenOrders: typeof orders = [];
    const newTokenOrders: typeof orders = [];
    
    for (const order of orders) {
      const dispatchDate = order.dispatch_date?.slice(0, 10) || '';
      if (dispatchDate && dispatchDate <= POSTEX_API_CONFIG.CUTOFF_DATE) {
        oldTokenOrders.push(order);
      } else {
        newTokenOrders.push(order);
      }
    }

    console.log(`Split: ${oldTokenOrders.length} OLD token, ${newTokenOrders.length} NEW token`);

    let updatedCount = 0;

    // Helper to process a batch with a specific token
    const processBatch = async (
      batch: typeof orders, 
      token: string, 
      tokenLabel: string
    ): Promise<number> => {
      let batchUpdates = 0;
      const trackingNumbers = batch.map(o => o.tracking_number);
      
      console.log(`[${tokenLabel}] Fetching ${trackingNumbers.length} orders in bulk...`);
      
      const response = await fetchBulkOrderDetails(trackingNumbers, token);
      
      if (!response || response.statusCode !== '200' || !response.dist) {
        console.error(`[${tokenLabel}] Bulk API failed:`, response?.statusMessage || 'No response');
        return 0;
      }

      console.log(`[${tokenLabel}] Got ${response.dist.length} results from API`);

      // Create a map of tracking number -> order for quick lookup
      const orderMap = new Map(batch.map(o => [o.tracking_number, o]));

      // Process each result
      for (const item of response.dist) {
        if (item.message !== 'SUCCESSFULLY RETRIEVE ORDER' || !item.trackingResponse) {
          console.log(`[${tokenLabel}] Skipping ${item.trackingNumber}: ${item.message}`);
          continue;
        }

        const dist = item.trackingResponse;
        const trackingNumber = item.trackingNumber;
        const existingOrder = orderMap.get(trackingNumber);
        
        if (!existingOrder) {
          console.log(`[${tokenLabel}] Order ${trackingNumber} not in our batch, skipping`);
          continue;
        }

        const newStatus = dist.transactionStatus.toLowerCase();
        
        // Only update if status changed
        if (newStatus !== existingOrder.order_status) {
          // Calculate courier fee based on status (same logic as before)
          let courierFeeUpdate: number | undefined;
          
          if (newStatus === 'delivered') {
            // For delivered: transactionFee + transactionTax
            courierFeeUpdate = (dist.transactionFee || 0) + (dist.transactionTax || 0);
          } else if (newStatus === 'returned') {
            // For returned: reversalFee + reversalTax
            courierFeeUpdate = (dist.reversalFee || 0) + (dist.reversalTax || 0);
          }

          const updateObj: Record<string, any> = { order_status: newStatus };
          if (courierFeeUpdate !== undefined) {
            updateObj.courier_fee = courierFeeUpdate;
          }

          const { error: updateError } = await supabase
            .from('orders')
            .update(updateObj)
            .eq('tracking_number', trackingNumber);

          if (updateError) {
            console.error(`[${tokenLabel}] Error updating ${trackingNumber}:`, updateError);
          } else {
            console.log(
              `[${tokenLabel}] ${trackingNumber}: ${existingOrder.order_status} → ${newStatus}` +
              (courierFeeUpdate !== undefined ? ` (fee: ${courierFeeUpdate})` : '')
            );
            batchUpdates++;
          }
        }
      }
      
      return batchUpdates;
    };

    // Process OLD token orders in batches
    if (oldTokenOrders.length > 0) {
      console.log(`Processing ${oldTokenOrders.length} orders with OLD token...`);
      for (let i = 0; i < oldTokenOrders.length; i += BATCH_SIZE) {
        const batch = oldTokenOrders.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(oldTokenOrders.length / BATCH_SIZE);
        console.log(`[OLD] Processing batch ${batchNum}/${totalBatches}`);
        updatedCount += await processBatch(batch, POSTEX_API_CONFIG.OLD_TOKEN, 'OLD');
      }
    }

    // Process NEW token orders in batches
    if (newTokenOrders.length > 0) {
      console.log(`Processing ${newTokenOrders.length} orders with NEW token...`);
      for (let i = 0; i < newTokenOrders.length; i += BATCH_SIZE) {
        const batch = newTokenOrders.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(newTokenOrders.length / BATCH_SIZE);
        console.log(`[NEW] Processing batch ${batchNum}/${totalBatches}`);
        updatedCount += await processBatch(batch, POSTEX_API_CONFIG.NEW_TOKEN, 'NEW');
      }
    }

    console.log(`✅ Completed bulk order status check. Updated ${updatedCount} orders.`);
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