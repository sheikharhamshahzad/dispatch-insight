-- FIFO-based COGS tracking implementation
-- This migration adds support for tracking inventory batches and order line items

-- Create inventory_batches table for FIFO tracking
CREATE TABLE public.inventory_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  batch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity_received INTEGER NOT NULL,
  quantity_remaining INTEGER NOT NULL,
  cogs_per_unit DECIMAL(10,2) NOT NULL,
  supplier_reference TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create order_line_items table to track allocated inventory per order
CREATE TABLE public.order_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  batch_id UUID NOT NULL REFERENCES public.inventory_batches(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  cogs_per_unit DECIMAL(10,2) NOT NULL,
  total_cogs DECIMAL(10,2) NOT NULL,
  allocated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add new column to orders table to track if COGS have been allocated
ALTER TABLE public.orders ADD COLUMN cogs_allocated BOOLEAN DEFAULT false;

-- Create trigger for inventory_batches timestamp updates
CREATE TRIGGER update_inventory_batches_updated_at
  BEFORE UPDATE ON public.inventory_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_inventory_batches_product_id ON public.inventory_batches(product_id);
CREATE INDEX idx_inventory_batches_batch_date ON public.inventory_batches(batch_date);
CREATE INDEX idx_inventory_batches_quantity_remaining ON public.inventory_batches(quantity_remaining);
CREATE INDEX idx_order_line_items_order_id ON public.order_line_items(order_id);
CREATE INDEX idx_order_line_items_product_id ON public.order_line_items(product_id);
CREATE INDEX idx_order_line_items_batch_id ON public.order_line_items(batch_id);

-- Migrate existing inventory to batches
-- For each existing product, create an initial batch with current stock and COGS
INSERT INTO public.inventory_batches (product_id, batch_date, quantity_received, quantity_remaining, cogs_per_unit, notes)
SELECT 
  id,
  CURRENT_DATE - INTERVAL '1 day', -- Set batch date to yesterday to ensure it's the oldest
  current_stock,
  current_stock,
  cogs,
  'Initial batch from existing inventory'
FROM public.products
WHERE current_stock > 0;

-- Create function to allocate inventory using FIFO
CREATE OR REPLACE FUNCTION allocate_inventory_fifo(
  p_product_id UUID,
  p_order_id UUID,
  p_product_name TEXT,
  p_quantity INTEGER
) RETURNS TABLE(
  allocated_quantity INTEGER,
  total_cogs DECIMAL(10,2),
  allocation_success BOOLEAN
) AS $$
DECLARE
  batch_record RECORD;
  remaining_to_allocate INTEGER := p_quantity;
  current_allocation INTEGER;
  running_total_cogs DECIMAL(10,2) := 0;
  allocated_total INTEGER := 0;
BEGIN
  -- Loop through batches in FIFO order (oldest first)
  FOR batch_record IN 
    SELECT id, quantity_remaining, cogs_per_unit
    FROM public.inventory_batches 
    WHERE product_id = p_product_id 
      AND quantity_remaining > 0
    ORDER BY batch_date ASC, created_at ASC
  LOOP
    -- Calculate how much to allocate from this batch
    current_allocation := LEAST(remaining_to_allocate, batch_record.quantity_remaining);
    
    -- Insert allocation record
    INSERT INTO public.order_line_items (
      order_id, product_id, batch_id, product_name, quantity, cogs_per_unit, total_cogs
    ) VALUES (
      p_order_id, 
      p_product_id, 
      batch_record.id, 
      p_product_name, 
      current_allocation, 
      batch_record.cogs_per_unit,
      current_allocation * batch_record.cogs_per_unit
    );
    
    -- Update batch remaining quantity
    UPDATE public.inventory_batches 
    SET quantity_remaining = quantity_remaining - current_allocation,
        updated_at = now()
    WHERE id = batch_record.id;
    
    -- Update totals
    allocated_total := allocated_total + current_allocation;
    running_total_cogs := running_total_cogs + (current_allocation * batch_record.cogs_per_unit);
    remaining_to_allocate := remaining_to_allocate - current_allocation;
    
    -- Exit if we've allocated everything needed
    EXIT WHEN remaining_to_allocate = 0;
  END LOOP;
  
  -- Return allocation results
  RETURN QUERY SELECT 
    allocated_total,
    running_total_cogs,
    (allocated_total = p_quantity)::BOOLEAN;
END;
$$ LANGUAGE plpgsql;

-- Create function to add new inventory batch
CREATE OR REPLACE FUNCTION add_inventory_batch(
  p_product_id UUID,
  p_quantity INTEGER,
  p_cogs_per_unit DECIMAL(10,2),
  p_supplier_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  new_batch_id UUID;
BEGIN
  -- Insert new batch
  INSERT INTO public.inventory_batches (
    product_id, quantity_received, quantity_remaining, cogs_per_unit, supplier_reference, notes
  ) VALUES (
    p_product_id, p_quantity, p_quantity, p_cogs_per_unit, p_supplier_reference, p_notes
  ) RETURNING id INTO new_batch_id;
  
  -- Update product current_stock
  UPDATE public.products 
  SET current_stock = current_stock + p_quantity,
      updated_at = now()
  WHERE id = p_product_id;
  
  RETURN new_batch_id;
END;
$$ LANGUAGE plpgsql;

-- Create view for easy batch summary per product
CREATE VIEW product_batch_summary AS
SELECT 
  p.id as product_id,
  p.name as product_name,
  p.current_stock,
  COALESCE(SUM(ib.quantity_remaining), 0) as total_batch_remaining,
  COALESCE(COUNT(ib.id) FILTER (WHERE ib.quantity_remaining > 0), 0) as active_batches,
  COALESCE(ROUND(AVG(ib.cogs_per_unit) FILTER (WHERE ib.quantity_remaining > 0), 2), p.cogs) as avg_active_cogs
FROM public.products p
LEFT JOIN public.inventory_batches ib ON p.id = ib.product_id
GROUP BY p.id, p.name, p.current_stock, p.cogs;