-- Cleanup Migration: Merge duplicate Delivery Under Review entries
-- Identifies and consolidates multiple open reviews for the same tracking number
-- Strategy: Keep the most recent attempt, merge contact tracking flags from duplicates

-- Function to safely merge duplicate delivery reviews
CREATE OR REPLACE FUNCTION merge_duplicate_delivery_reviews()
RETURNS TABLE(
  tracking_number TEXT,
  duplicates_found INT,
  kept_review_id UUID,
  kept_reason_code TEXT,
  deleted_count INT
) AS $$
DECLARE
  v_tracking_number TEXT;
  v_latest_id UUID;
  v_latest_reason TEXT;
  v_old_id UUID;
  v_customer_whatsapp_sent BOOLEAN;
  v_sales_whatsapp_sent BOOLEAN;
  v_postex_email_sent BOOLEAN;
  v_customer_whatsapp_sent_at TIMESTAMPTZ;
  v_sales_whatsapp_sent_at TIMESTAMPTZ;
  v_postex_email_sent_at TIMESTAMPTZ;
  v_deleted_count INT;
  v_duplicate_count INT;

  v_duplicates CURSOR FOR
    SELECT tracking_number, COUNT(*) as dup_count
    FROM delivery_reviews
    WHERE review_status = 'open'
    GROUP BY tracking_number
    HAVING COUNT(*) > 1
    ORDER BY tracking_number;

  v_old_reviews CURSOR FOR
    SELECT id,
           customer_whatsapp_sent,
           sales_whatsapp_sent,
           postex_email_sent,
           customer_whatsapp_sent_at,
           sales_whatsapp_sent_at,
           postex_email_sent_at
    FROM delivery_reviews
    WHERE tracking_number = v_tracking_number
    AND review_status = 'open'
    AND id != v_latest_id
    ORDER BY attempt_date ASC;
BEGIN
  v_deleted_count := 0;

  FOR v_duplicate_record IN v_duplicates LOOP
    v_tracking_number := v_duplicate_record.tracking_number;
    v_duplicate_count := v_duplicate_record.dup_count;

    -- Get the review with the latest attempt_date (this becomes the keeper)
    SELECT id, review_reason_code
    INTO v_latest_id, v_latest_reason
    FROM delivery_reviews
    WHERE tracking_number = v_tracking_number
    AND review_status = 'open'
    ORDER BY attempt_date DESC
    LIMIT 1;

    -- Merge contact tracking flags from all duplicates
    -- If ANY duplicate has the flag set, keep it as true
    -- Use the earliest sent_at timestamp if multiple are set
    SELECT
      COALESCE(MAX(CASE WHEN customer_whatsapp_sent THEN TRUE END), FALSE),
      COALESCE(MAX(CASE WHEN sales_whatsapp_sent THEN TRUE END), FALSE),
      COALESCE(MAX(CASE WHEN postex_email_sent THEN TRUE END), FALSE),
      MIN(NULLIF(customer_whatsapp_sent_at, NULL)),
      MIN(NULLIF(sales_whatsapp_sent_at, NULL)),
      MIN(NULLIF(postex_email_sent_at, NULL))
    INTO
      v_customer_whatsapp_sent,
      v_sales_whatsapp_sent,
      v_postex_email_sent,
      v_customer_whatsapp_sent_at,
      v_sales_whatsapp_sent_at,
      v_postex_email_sent_at
    FROM delivery_reviews
    WHERE tracking_number = v_tracking_number
    AND review_status = 'open';

    -- Update the keeper review with merged contact tracking flags
    UPDATE delivery_reviews
    SET
      customer_whatsapp_sent = v_customer_whatsapp_sent,
      sales_whatsapp_sent = v_sales_whatsapp_sent,
      postex_email_sent = v_postex_email_sent,
      customer_whatsapp_sent_at = v_customer_whatsapp_sent_at,
      sales_whatsapp_sent_at = v_sales_whatsapp_sent_at,
      postex_email_sent_at = v_postex_email_sent_at
    WHERE id = v_latest_id;

    -- Delete all other duplicate reviews for this tracking number
    DELETE FROM delivery_reviews
    WHERE tracking_number = v_tracking_number
    AND review_status = 'open'
    AND id != v_latest_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN QUERY SELECT
      v_tracking_number,
      v_duplicate_count,
      v_latest_id,
      v_latest_reason,
      v_deleted_count;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Execute the merge function and report results
SELECT * FROM merge_duplicate_delivery_reviews();

-- Drop the temporary function
DROP FUNCTION IF EXISTS merge_duplicate_delivery_reviews();

-- Verify the constraint is working: Count remaining duplicates (should be 0)
SELECT
  tracking_number,
  COUNT(*) as duplicate_count
FROM delivery_reviews
WHERE review_status = 'open'
GROUP BY tracking_number
HAVING COUNT(*) > 1;

-- Add comment to explain the fix
COMMENT ON INDEX uniq_delivery_reviews_tracking_open IS 'Ensures only ONE open review exists per tracking number to prevent duplicate Delivery Under Review cards. Completed/historical reviews are excluded.';
