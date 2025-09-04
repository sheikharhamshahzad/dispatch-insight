-- Migration script to create initial batches for existing inventory
-- This should be run once after the new system is deployed

DO $$
DECLARE
  product_record RECORD;
BEGIN
  -- For each product with current stock, create an initial batch
  FOR product_record IN 
    SELECT id, name, current_stock, cogs 
    FROM products 
    WHERE current_stock > 0
  LOOP
    -- Insert initial batch for existing inventory
    INSERT INTO inventory_batches (
      product_id, 
      quantity, 
      remaining_quantity, 
      cogs, 
      batch_datetime
    ) VALUES (
      product_record.id,
      product_record.current_stock,
      product_record.current_stock,
      product_record.cogs,
      '2025-08-28 23:59:59'::timestamp with time zone -- Day before cutover
    );
    
    RAISE NOTICE 'Created initial batch for %: % units at % COGS', 
      product_record.name, product_record.current_stock, product_record.cogs;
  END LOOP;
END $$;