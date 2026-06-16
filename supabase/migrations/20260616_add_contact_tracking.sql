-- Add contact tracking fields to delivery_reviews table
ALTER TABLE delivery_reviews
ADD COLUMN customer_whatsapp_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN sales_whatsapp_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN postex_email_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN customer_whatsapp_sent_at TIMESTAMPTZ NULL,
ADD COLUMN sales_whatsapp_sent_at TIMESTAMPTZ NULL,
ADD COLUMN postex_email_sent_at TIMESTAMPTZ NULL;

-- Create indexes for tracking queries
CREATE INDEX idx_delivery_reviews_customer_whatsapp_sent ON delivery_reviews(customer_whatsapp_sent);
CREATE INDEX idx_delivery_reviews_sales_whatsapp_sent ON delivery_reviews(sales_whatsapp_sent);
CREATE INDEX idx_delivery_reviews_postex_email_sent ON delivery_reviews(postex_email_sent);
