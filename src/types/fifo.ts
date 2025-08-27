// Types for FIFO-based COGS tracking implementation

export interface InventoryBatch {
  id: string;
  product_id: string;
  batch_date: string;
  quantity_received: number;
  quantity_remaining: number;
  cogs_per_unit: number;
  supplier_reference?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderLineItem {
  id: string;
  order_id: string;
  product_id: string;
  batch_id: string;
  product_name: string;
  quantity: number;
  cogs_per_unit: number;
  total_cogs: number;
  allocated_at: string;
  created_at: string;
}

export interface ProductBatchSummary {
  product_id: string;
  product_name: string;
  current_stock: number;
  total_batch_remaining: number;
  active_batches: number;
  avg_active_cogs: number;
}

export interface FIFOAllocationResult {
  allocated_quantity: number;
  total_cogs: number;
  allocation_success: boolean;
}

export interface BatchAllocationDetail {
  batch_id: string;
  batch_date: string;
  quantity_allocated: number;
  cogs_per_unit: number;
  total_cogs: number;
}

// Extended Order interface to include COGS allocation flag
export interface OrderWithCOGS {
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