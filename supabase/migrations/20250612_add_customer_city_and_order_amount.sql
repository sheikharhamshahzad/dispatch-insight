-- Add customer_city and order_amount columns to delivery_reviews table
ALTER TABLE public.delivery_reviews
ADD COLUMN IF NOT EXISTS customer_city TEXT,
ADD COLUMN IF NOT EXISTS order_amount NUMERIC(10, 2);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_delivery_reviews_customer_city
ON public.delivery_reviews(customer_city);

CREATE INDEX IF NOT EXISTS idx_delivery_reviews_order_amount
ON public.delivery_reviews(order_amount);
