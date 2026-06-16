-- Migration to fix duplicate Delivery Under Review entries
-- Problem: Multiple [0013] Attempt Made statuses were creating separate cards
-- Solution: Add constraint to prevent multiple open reviews per tracking number

-- Step 1: Remove the old partial unique index that allowed duplicates
-- The old index was: CREATE UNIQUE INDEX uniq_delivery_reviews_tracking_reason
-- on (tracking_number, review_reason_code) WHERE review_status != 'completed'
-- This allowed multiple open reviews for the same tracking number with different reason codes

DROP INDEX IF EXISTS uniq_delivery_reviews_tracking_reason;

-- Step 2: Add new unique constraint to ensure only ONE open review per tracking number
-- This prevents duplicate cards from appearing in the Delivery Under Review section
-- Completed reviews are excluded from this constraint to allow historical records
CREATE UNIQUE INDEX uniq_delivery_reviews_tracking_open
ON public.delivery_reviews(tracking_number)
WHERE review_status = 'open';

-- Step 3: Add a helper function to get all attempt dates for a tracking number
-- This will be used by the cleanup script to preserve the latest attempt information
CREATE OR REPLACE FUNCTION get_delivery_review_attempts_info(p_tracking_number TEXT)
RETURNS TABLE(
  review_id UUID,
  attempt_date TIMESTAMPTZ,
  review_reason_code TEXT,
  review_status TEXT,
  rn INT
) AS $$
  SELECT
    id,
    attempt_date,
    review_reason_code,
    review_status,
    ROW_NUMBER() OVER (ORDER BY attempt_date DESC) as rn
  FROM delivery_reviews
  WHERE tracking_number = p_tracking_number
  AND review_status = 'open'
  ORDER BY attempt_date DESC;
$$ LANGUAGE SQL;

-- Step 4: Log migration completion
SELECT pg_catalog.set_config('app.migration_info', 'Duplicate delivery reviews fix applied', false);
