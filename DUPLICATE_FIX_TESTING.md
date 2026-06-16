# Duplicate Delivery Under Review Fix - Testing & Verification Guide

## Summary of Changes

This fix resolves the issue where multiple [0013] Attempt Made statuses with different reasons (e.g., CNA on Jun 13 and RFD on Jun 15) were creating separate Delivery Under Review cards for the same order.

### Key Changes Made

1. **Helper Function Update** (`deliveryReviewHelpers.ts`)
   - `detectAttemptReasonsFromStatusHistory()` now returns ONLY the latest [0013] attempt reason
   - Previously returned ALL [0013] entries, causing duplicates
   - Added `getPreviousAttemptsHistory()` function to track previous attempts for display

2. **Service Logic Update** (`deliveryReviewService.ts`)
   - Implemented UPSERT pattern in `createDeliveryReviewsFromTrackingResponse()`
   - Checks for existing OPEN reviews and UPDATES them instead of creating duplicates
   - Preserves contact tracking fields (whatsapp_sent, sales_whatsapp_sent, postex_email_sent)
   - Skips completed reviews to avoid re-opening closed cases

3. **Database Migrations**
   - `20260616_fix_duplicate_delivery_reviews.sql`: Adds unique constraint on tracking_number for open reviews
   - `20260616_cleanup_duplicate_delivery_reviews.sql`: Merges existing duplicates, preserving contact flags

4. **UI Enhancement** (`DeliveryUnderReview.tsx`)
   - Added optional "Previous: CNA on Jun 13" chip to show attempt history
   - Only displays if multiple [0013] entries exist for the same order
   - Shows both in "Ready for Reattempt" and "Open Reviews" sections

## Testing Checklist

### 1. Build & Deploy
- [ ] Run `npm run build` to ensure TypeScript compilation succeeds
- [ ] No errors in console after build
- [ ] Deployment completes without issues

### 2. Database Migrations
- [ ] Apply `20260616_fix_duplicate_delivery_reviews.sql`
  - Verify: `SELECT * FROM information_schema.indexes WHERE indexname LIKE 'uniq_delivery_reviews%';`
  - Should show the new `uniq_delivery_reviews_tracking_open` index
  
- [ ] Apply `20260616_cleanup_duplicate_delivery_reviews.sql`
  - Should output merge results showing which duplicates were consolidated
  - Verify no open reviews have duplicate tracking numbers:
    ```sql
    SELECT tracking_number, COUNT(*) FROM delivery_reviews 
    WHERE review_status = 'open' 
    GROUP BY tracking_number 
    HAVING COUNT(*) > 1;
    ```
    - Should return 0 rows

### 3. Existing Duplicate Cleanup Verification
```sql
-- Before cleanup, check how many duplicates exist
SELECT tracking_number, COUNT(*) as duplicate_count
FROM delivery_reviews
WHERE review_status = 'open'
GROUP BY tracking_number
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- After cleanup, should be empty
SELECT tracking_number, COUNT(*) as duplicate_count
FROM delivery_reviews
WHERE review_status = 'open'
GROUP BY tracking_number
HAVING COUNT(*) > 1;
```

### 4. Test Case: Single Order with Multiple Attempts

**Test Data Setup:**
1. Create/use an order with PostEx response containing multiple [0013] entries:
   - First [0013] entry: CNA (Customer Not Available) on Jun 13
   - Second [0013] entry: RFD (Refused To Receive) on Jun 15

**Expected Behavior:**
- [ ] Only ONE Delivery Under Review card appears for this tracking number
- [ ] Card shows **RFD** as the active reason (latest attempt)
- [ ] Card shows "Previous: CNA on Jun 13" chip
- [ ] All contact tracking values from both entries are preserved/merged

**Test Steps:**
1. Open browser DevTools
2. Manually trigger the order status checker:
   ```javascript
   // In browser console:
   import { checkAndUpdateOrderStatuses } from '@/services/orderStatusChecker';
   await checkAndUpdateOrderStatuses();
   ```
3. Navigate to Delivery Under Review tab
4. Search for the tracking number
5. Verify only one card appears
6. Verify the reason shows RFD
7. Verify previous attempts chip shows

### 5. Test Case: Running Checker Multiple Times

**Expected Behavior:**
- [ ] Running the checker multiple times does NOT create new duplicates
- [ ] Existing open review is UPDATED with latest attempt info
- [ ] Contact tracking fields are never reset
- [ ] Card count remains at 1 per tracking number

**Test Steps:**
1. Run checker once, verify card appears with RFD
2. Wait 30 seconds
3. Run checker again
4. Verify:
   - Only ONE card still exists
   - Card still shows RFD as reason
   - No new cards were created
   - `updated_at` timestamp changed but `id` remained the same

### 6. Test Case: Completed Case Should Not Be Modified

**Expected Behavior:**
- [ ] If a review is marked as "completed", new [0013] statuses should NOT reopen it
- [ ] Completed reviews are protected from being re-opened by the checker

**Test Steps:**
1. Create a completed review (final_outcome = 'delivered_after_followup')
2. Simulate PostEx sending a new [0013] status for the same tracking number
3. Run checker
4. Verify:
   - Review is STILL marked as completed
   - NO new review was created
   - Log shows: "Order XXX has completed review. Skipping to preserve closed case."

### 7. Test Case: Contact Tracking Preservation

**Expected Behavior:**
- [ ] When updating an open review, contact tracking fields are merged from duplicates
- [ ] If ANY duplicate had `customer_whatsapp_sent = true`, final record has it as `true`
- [ ] Earliest `sent_at` timestamp is used if multiple exist

**Test Steps:**
1. Create test data with 2 duplicate open reviews:
   - Review A: customer_whatsapp_sent = true, sent_at = '2026-06-13 10:00'
   - Review B: customer_whatsapp_sent = false, sent_at = NULL
2. Run cleanup migration
3. Verify result:
   - One review remains
   - customer_whatsapp_sent = true
   - customer_whatsapp_sent_at = '2026-06-13 10:00'

### 8. Test Case: Constraint Enforcement

**Expected Behavior:**
- [ ] Cannot manually insert two open reviews with same tracking_number
- [ ] Database prevents constraint violation

**Test Steps:**
```sql
-- Try to insert duplicate (should fail)
INSERT INTO delivery_reviews (
  tracking_number, review_reason_code, review_reason_label,
  review_reason_display, attempt_date, review_status
) VALUES (
  'TEST123', 'RFD', 'REFUSED TO RECEIVE', 'RFD - Refused To Receive',
  now(), 'open'
);

-- Second insert with same tracking (should fail with unique constraint violation)
INSERT INTO delivery_reviews (
  tracking_number, review_reason_code, review_reason_label,
  review_reason_display, attempt_date, review_status
) VALUES (
  'TEST123', 'CNA', 'CUSTOMER NOT AVAILABLE', 'CNA - Customer Not Available',
  now(), 'open'
);
-- Expected: ERROR: duplicate key value violates unique constraint "uniq_delivery_reviews_tracking_open"
```

### 9. UI Test: Previous Attempts Chip

**Expected Behavior:**
- [ ] Chip only appears when multiple [0013] attempts exist
- [ ] Shows previous attempt codes and dates (e.g., "Previous: CNA on Jun 13")
- [ ] Does not appear for single-attempt orders
- [ ] Visible in both "Ready for Reattempt" and "Open Reviews" sections

**Test Steps:**
1. Load Delivery Under Review page
2. Find order with one attempt → chip should NOT appear
3. Find order with multiple attempts → chip SHOULD appear
4. Verify chip text format matches expected pattern

### 10. Logs Verification

**Expected Log Messages:**
- During checker run with upsert:
  ```
  [DeliveryReview] Updating existing open review for TRACKING123: CNA → RFD
  [DeliveryReview] Updated review [UUID] for TRACKING123/RFD
  ```
  
- During cleanup:
  ```
  SELECT * FROM merge_duplicate_delivery_reviews();
  -- Should output merged results
  ```

- Should NOT see:
  ```
  [DeliveryReview] Created review for TRACKING123/RFD  (if open already exists)
  [DeliveryReview] Skipping duplicate creation  (old logic)
  ```

## Rollback Plan

If issues occur:

### Rollback Database
```sql
-- Drop new constraint
DROP INDEX IF EXISTS uniq_delivery_reviews_tracking_open;

-- Restore old constraint
CREATE UNIQUE INDEX uniq_delivery_reviews_tracking_reason
ON public.delivery_reviews(tracking_number, review_reason_code)
WHERE review_status != 'completed';

-- Drop the merge function if it exists
DROP FUNCTION IF EXISTS merge_duplicate_delivery_reviews();
DROP FUNCTION IF EXISTS get_delivery_review_attempts_info(TEXT);
```

### Rollback Code
- Revert `src/services/deliveryReviewHelpers.ts` 
- Revert `src/services/deliveryReviewService.ts`
- Revert `src/components/DeliveryUnderReview.tsx`

## Performance Considerations

- **Upsert operation** adds one additional `SELECT` query to check for existing open reviews
- **Impact**: Negligible - indexes on tracking_number ensure fast lookup
- **No increase in write operations** - same number of updates/inserts as before

## Success Criteria

✅ All of the following must pass:

1. **No Duplicate Cards**: Only one Delivery Under Review card per tracking number
2. **Latest Reason Used**: Card shows the latest [0013] attempt reason
3. **Idempotent Checker**: Running checker multiple times doesn't create duplicates
4. **Preserved Fields**: Contact tracking fields survive upsert operations
5. **Completed Cases Protected**: Completed reviews are never re-opened
6. **Database Constraint**: Unique constraint prevents manual duplicate inserts
7. **UI Enhancement**: Previous attempts chip displays correctly
8. **Logs Clean**: No errors in service logs

---

## Questions & Troubleshooting

**Q: Why was the old unique index removed?**
A: The old index was on `(tracking_number, review_reason_code)`, which allowed multiple open reviews with the SAME tracking number but DIFFERENT reasons. The new constraint on just `tracking_number` (where status = 'open') prevents ALL duplicates.

**Q: What if I need to track multiple reason changes?**
A: All historical changes are preserved in `order_status_history` table. The delivery_reviews table now focuses on the CURRENT/ACTIVE attempt. This is the correct design for RTO recovery - you follow up on the current issue, not all past issues.

**Q: Will old WhatsApp messages be lost?**
A: No. The `whatsapp_sent`, `whatsapp_sent_at` fields are preserved during upsert. Contact history is maintained.

**Q: How do I manually merge existing duplicates?**
A: Run the cleanup migration. It automatically merges duplicates by keeping the latest attempt and merging contact flags.
