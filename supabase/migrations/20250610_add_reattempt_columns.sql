-- Add reattempt-related columns to delivery_reviews table
alter table delivery_reviews
add column if not exists reattempt_requested boolean default false,
add column if not exists reattempt_requested_at timestamptz,
add column if not exists reattempt_remarks text,
add column if not exists postex_reattempt_response jsonb;

-- Add index for reattempt_requested for faster queries
create index if not exists idx_delivery_reviews_reattempt_requested 
on delivery_reviews(reattempt_requested, reattempt_requested_at desc);
