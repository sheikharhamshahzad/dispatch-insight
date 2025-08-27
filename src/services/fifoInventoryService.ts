// FIFO Inventory Service
// Handles all FIFO-based inventory allocation and batch management

import { supabase } from "@/integrations/supabase/client";
import { InventoryBatch, OrderLineItem, FIFOAllocationResult, ProductBatchSummary } from "@/types/fifo";

export class FIFOInventoryService {
  
  /**
   * Allocate inventory for an order using FIFO logic
   */
  static async allocateInventoryForOrder(
    productId: string,
    orderId: string,
    productName: string,
    quantity: number
  ): Promise<FIFOAllocationResult> {
    try {
      const { data, error } = await supabase.rpc('allocate_inventory_fifo', {
        p_product_id: productId,
        p_order_id: orderId,
        p_product_name: productName,
        p_quantity: quantity
      });

      if (error) {
        console.error('Error allocating inventory:', error);
        return { allocated_quantity: 0, total_cogs: 0, allocation_success: false };
      }

      return data[0] || { allocated_quantity: 0, total_cogs: 0, allocation_success: false };
    } catch (error) {
      console.error('Error in allocateInventoryForOrder:', error);
      return { allocated_quantity: 0, total_cogs: 0, allocation_success: false };
    }
  }

  /**
   * Add a new inventory batch
   */
  static async addInventoryBatch(
    productId: string,
    quantity: number,
    cogsPerUnit: number,
    supplierReference?: string,
    notes?: string
  ): Promise<string | null> {
    try {
      const { data, error } = await supabase.rpc('add_inventory_batch', {
        p_product_id: productId,
        p_quantity: quantity,
        p_cogs_per_unit: cogsPerUnit,
        p_supplier_reference: supplierReference,
        p_notes: notes
      });

      if (error) {
        console.error('Error adding inventory batch:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in addInventoryBatch:', error);
      return null;
    }
  }

  /**
   * Get all batches for a product
   */
  static async getProductBatches(productId: string): Promise<InventoryBatch[]> {
    try {
      const { data, error } = await supabase
        .from('inventory_batches')
        .select('*')
        .eq('product_id', productId)
        .order('batch_date', { ascending: true });

      if (error) {
        console.error('Error fetching product batches:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getProductBatches:', error);
      return [];
    }
  }

  /**
   * Get order line items for an order
   */
  static async getOrderLineItems(orderId: string): Promise<OrderLineItem[]> {
    try {
      const { data, error } = await supabase
        .from('order_line_items')
        .select('*')
        .eq('order_id', orderId)
        .order('allocated_at', { ascending: true });

      if (error) {
        console.error('Error fetching order line items:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getOrderLineItems:', error);
      return [];
    }
  }

  /**
   * Get batch summary for all products
   */
  static async getProductBatchSummaries(): Promise<ProductBatchSummary[]> {
    try {
      const { data, error } = await supabase
        .from('product_batch_summary')
        .select('*')
        .order('product_name', { ascending: true });

      if (error) {
        console.error('Error fetching product batch summaries:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getProductBatchSummaries:', error);
      return [];
    }
  }

  /**
   * Calculate total COGS for delivered orders using recorded line items
   */
  static async calculateDeliveredOrdersCOGS(orderIds: string[]): Promise<{
    totalCOGS: number;
    productBreakdown: Record<string, number>;
  }> {
    try {
      if (orderIds.length === 0) {
        return { totalCOGS: 0, productBreakdown: {} };
      }

      const { data, error } = await supabase
        .from('order_line_items')
        .select('product_name, total_cogs')
        .in('order_id', orderIds);

      if (error) {
        console.error('Error calculating delivered orders COGS:', error);
        return { totalCOGS: 0, productBreakdown: {} };
      }

      const productBreakdown: Record<string, number> = {};
      let totalCOGS = 0;

      data?.forEach(item => {
        totalCOGS += item.total_cogs;
        productBreakdown[item.product_name] = 
          (productBreakdown[item.product_name] || 0) + item.total_cogs;
      });

      return { totalCOGS, productBreakdown };
    } catch (error) {
      console.error('Error in calculateDeliveredOrdersCOGS:', error);
      return { totalCOGS: 0, productBreakdown: {} };
    }
  }

  /**
   * Reverse inventory allocation when order is deleted or returned
   */
  static async reverseAllocation(orderId: string): Promise<boolean> {
    try {
      // Get all line items for the order
      const lineItems = await this.getOrderLineItems(orderId);
      
      // Restore inventory to batches
      for (const item of lineItems) {
        const { error: updateError } = await supabase
          .from('inventory_batches')
          .update({ 
            quantity_remaining: supabase.sql`quantity_remaining + ${item.quantity}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.batch_id);

        if (updateError) {
          console.error('Error reversing allocation for batch:', updateError);
          return false;
        }
      }

      // Delete order line items
      const { error: deleteError } = await supabase
        .from('order_line_items')
        .delete()
        .eq('order_id', orderId);

      if (deleteError) {
        console.error('Error deleting order line items:', deleteError);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in reverseAllocation:', error);
      return false;
    }
  }

  /**
   * Check if order has COGS allocated
   */
  static async isOrderCOGSAllocated(orderId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('cogs_allocated')
        .eq('id', orderId)
        .single();

      if (error) {
        console.error('Error checking COGS allocation:', error);
        return false;
      }

      return data?.cogs_allocated || false;
    } catch (error) {
      console.error('Error in isOrderCOGSAllocated:', error);
      return false;
    }
  }

  /**
   * Mark order as having COGS allocated
   */
  static async markOrderCOGSAllocated(orderId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ cogs_allocated: true })
        .eq('id', orderId);

      if (error) {
        console.error('Error marking order COGS allocated:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in markOrderCOGSAllocated:', error);
      return false;
    }
  }
}