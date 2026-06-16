-- Create order_status_history table for tracking all status changes
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  tracking_number TEXT NOT NULL,

  old_status TEXT,
  new_status TEXT,

  status_message TEXT,
  status_code TEXT,

  postex_status_code TEXT,
  postex_status_message TEXT,
  postex_updated_at TIMESTAMPTZ,

  attempt_reason_code TEXT,
  attempt_reason_label TEXT,

  transaction_status_history JSONB,
  raw_response JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for order_status_history
CREATE INDEX IF NOT EXISTS idx_order_status_history_tracking_number
ON public.order_status_history(tracking_number);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id
ON public.order_status_history(order_id);

CREATE INDEX IF NOT EXISTS idx_order_status_history_created_at
ON public.order_status_history(created_at);

CREATE INDEX IF NOT EXISTS idx_order_status_history_attempt_reason_code
ON public.order_status_history(attempt_reason_code);

-- Create delivery_reviews table for RTO Recovery case management
CREATE TABLE IF NOT EXISTS public.delivery_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  tracking_number TEXT NOT NULL,

  order_ref_number TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  delivery_address TEXT,
  order_detail TEXT,

  dispatch_date TIMESTAMPTZ,
  attempt_date TIMESTAMPTZ NOT NULL,

  review_reason_code TEXT NOT NULL,
  review_reason_label TEXT NOT NULL,
  review_reason_display TEXT NOT NULL,

  initial_attempt_status TEXT,
  initial_status_history_code TEXT,
  initial_status_history_message TEXT,
  initial_status_history_updated_at TIMESTAMPTZ,

  latest_status_history_code TEXT,
  latest_status_history_message TEXT,
  latest_status_history_updated_at TIMESTAMPTZ,

  current_order_status TEXT,

  review_status TEXT NOT NULL DEFAULT 'open',
  whatsapp_sent BOOLEAN NOT NULL DEFAULT false,
  whatsapp_sent_at TIMESTAMPTZ,

  customer_response TEXT,
  courier_action TEXT DEFAULT 'none',
  final_outcome TEXT DEFAULT 'pending',

  completed_at TIMESTAMPTZ,
  notes TEXT,

  raw_postex_response JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create unique constraint to prevent duplicates for same tracking + reason
CREATE UNIQUE INDEX IF NOT EXISTS uniq_delivery_reviews_tracking_reason
ON public.delivery_reviews(tracking_number, review_reason_code)
WHERE review_status != 'completed';

-- Create useful indexes for delivery_reviews
CREATE INDEX IF NOT EXISTS idx_delivery_reviews_attempt_date
ON public.delivery_reviews(attempt_date);

CREATE INDEX IF NOT EXISTS idx_delivery_reviews_completed_at
ON public.delivery_reviews(completed_at);

CREATE INDEX IF NOT EXISTS idx_delivery_reviews_review_status
ON public.delivery_reviews(review_status);

CREATE INDEX IF NOT EXISTS idx_delivery_reviews_reason_code
ON public.delivery_reviews(review_reason_code);

CREATE INDEX IF NOT EXISTS idx_delivery_reviews_current_order_status
ON public.delivery_reviews(current_order_status);

CREATE INDEX IF NOT EXISTS idx_delivery_reviews_customer_phone
ON public.delivery_reviews(customer_phone);

-- Create trigger to update delivery_reviews.updated_at automatically
CREATE OR REPLACE FUNCTION public.update_delivery_reviews_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_delivery_reviews_updated_at
  BEFORE UPDATE ON public.delivery_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_delivery_reviews_updated_at_column();
