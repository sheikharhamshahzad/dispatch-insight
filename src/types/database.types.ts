export interface Order {
  id: string;
  tracking_number: string;
  order_id: string;
  customer_name: string;
  customer_address: string;
  customer_phone: string;
  customer_city: string;
  product_name: string;
  amount: number;
  order_status: string;
  dispatch_date: string;
  return_received: boolean;
  courier_fee: number;
  precogs?: number;
  cogs?: number;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  current_stock: number;
  cogs: number;
  created_at: string;
  updated_at: string;
}

export interface InventoryBatch {
  id: string;
  product_id: string;
  quantity: number;
  remaining_quantity: number;
  cogs: number;
  batch_datetime: string;
  created_at: string;
}

export interface AdCost {
  id: string;
  date: string;
  platform: string;
  amount: number;
  created_at: string;
}

// Database types for Supabase
export type Database = {
  public: {
    Tables: {
      orders: {
        Row: Order;
        Insert: Partial<Order>;
        Update: Partial<Order>;
      };
      products: {
        Row: Product;
        Insert: Partial<Product>;
        Update: Partial<Product>;
      };
      inventory_batches: {
        Row: InventoryBatch;
        Insert: Partial<InventoryBatch>;
        Update: Partial<InventoryBatch>;
      };
      ad_costs: {
        Row: AdCost;
        Insert: Partial<AdCost>;
        Update: Partial<AdCost>;
      };
    };
    Functions: {
      add_inventory_batch: {
        Args: {
          p_product_id: string;
          p_quantity: number;
          p_cogs: number;
        };
        Returns: null;
      };
      allocate_inventory_fifo: {
        Args: {
          p_product_id: string;
          p_quantity: number;
        };
        Returns: number;
      };
    };
  };
};