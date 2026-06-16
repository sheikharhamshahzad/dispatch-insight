# Duplicate Delivery Under Review Entries - Fix Implementation Summary

## Problem Statement

The Delivery Under Review (RTO Recovery) section was creating multiple cards for the same order when PostEx history contained multiple [0013] "Attempt Made" statuses with different reasons.

### Example of the Problem:
- Order with tracking number TRK123
- PostEx history shows:
  - Jun 13: [0013] Attempt Made - CNA (Customer Not Available)
  - Jun 15: [0013] Attempt Made - RFD (Refused To Receive)
- **Expected Result**: One card showing RFD (latest attempt)
- **Actual Result**: Two cards showing both CNA and RFD

## Root Cause

1. **Helper function** (`detectAttemptReasonsFromStatusHistory()`) was returning ALL [0013] entries from history
2. **Service logic** was inserting a new record for each reason code, without checking if an open review already existed
3. **Database constraint** allowed multiple open reviews per tracking number as long as reason codes differed

## Solution Implemented

### 1. Helper Function Enhancement
**File**: `src/services/deliveryReviewHelpers.ts`

#### Change 1: Latest Attempt Only
- **Function**: `detectAttemptReasonsFromStatusHistory()`
- **Before**: Returned array of ALL [0013] attempts found in history
- **After**: Returns array with ONLY the LATEST [0013] attempt
- **Benefit**: Prevents processing of old attempts that should only be historical

#### Change 2: Attempt History Tracking
- **New Functions**: 
  - `getPreviousAttemptsHistory()` - Extracts all [0013] entries except the latest
  - `formatPreviousAttempts()` - Formats previous attempts for display (e.g., "CNA on Jun 13")
- **Benefit**: Allows UI to show attempt history without creating separate cards

### 2. Service Logic - UPSERT Pattern
**File**: `src/services/deliveryReviewService.ts`

#### Function: `createDeliveryReviewsFromTrackingResponse()`

**Old Logic Flow**:
```
1. Detect attempt reasons (returns ALL)
2. Check if ANY review exists for this tracking number
3. If ANY exists: SKIP (don't create anything)
4. If NONE exist: INSERT new review for each reason
Result: No updates, no duplicates, but also no updates when old reasons change
```

**New Logic Flow** (UPSERT):
```
1. Detect attempt reasons (returns ONLY latest)
2. Check for OPEN review for this tracking number
3. If OPEN review exists:
   - UPDATE it with latest attempt info
   - Preserve contact tracking fields
   - Update timestamp and status history
4. If COMPLETED review exists:
   - SKIP (don't modify closed cases)
5. If NO review exists:
   - INSERT new review
Result: One card per tracking number, always up-to-date, contact history preserved
```

**Key Code Changes**:
- Check for existing open review: `SELECT id, review_reason_code, review_status... WHERE tracking_number = X`
- For open review: `UPDATE delivery_reviews SET ... WHERE id = X`
- For no review: `INSERT INTO delivery_reviews VALUES (...)`
- For completed review: `RETURN (skip)`

### 3. Database Constraints
**Files**: Migration files in `supabase/migrations/`

#### File: `20260616_fix_duplicate_delivery_reviews.sql`

**Old Constraint** (Removed):
```sql
CREATE UNIQUE INDEX uniq_delivery_reviews_tracking_reason
ON public.delivery_reviews(tracking_number, review_reason_code)
WHERE review_status != 'completed';
```
- **Problem**: Allowed multiple open reviews per tracking number with different reason codes

**New Constraint** (Added):
```sql
CREATE UNIQUE INDEX uniq_delivery_reviews_tracking_open
ON public.delivery_reviews(tracking_number)
WHERE review_status = 'open';
```
- **Solution**: Ensures only ONE open review per tracking number
- **Scope**: Only applies to status = 'open', completed reviews are excluded
- **Benefit**: Database enforces uniqueness, prevents accidental duplicates

#### File: `20260616_cleanup_duplicate_delivery_reviews.sql`

**Cleanup Function**: `merge_duplicate_delivery_reviews()`
- **Purpose**: Merge existing duplicate open reviews
- **Strategy**:
  1. Find tracking numbers with multiple open reviews
  2. Keep the review with LATEST attempt_date
  3. Merge contact tracking flags from all duplicates:
     - If ANY duplicate has `customer_whatsapp_sent = true`, result has `true`
     - Same for `sales_whatsapp_sent` and `postex_email_sent`
     - Use earliest `sent_at` timestamp
  4. Delete other duplicate reviews
- **Output**: Report showing which duplicates were merged

### 4. UI Enhancement
**File**: `src/components/DeliveryUnderReview.tsx`

**New Feature**: Previous Attempts Display
- **Where**: Both "Ready for Reattempt" and "Open Reviews" card sections
- **Shows**: Optional chip like "Previous: CNA on Jun 13"
- **Condition**: Only displays if multiple [0013] entries exist
- **Icon**: History icon for visual clarity
- **Goal**: Give operations team context that multiple attempts happened

**Code Changes**:
```tsx
// After reason badge, add:
{review.raw_postex_response && getPreviousAttemptsHistory(review.raw_postex_response).length > 0 && (
  <div className="flex items-center gap-1 text-xs text-slate-600 mt-2">
    <History className="h-3 w-3" />
    <span className="text-slate-500">
      Previous: {formatPreviousAttempts(getPreviousAttemptsHistory(review.raw_postex_response))}
    </span>
  </div>
)}
```

## Behavior Changes

### Before Fix
| Scenario | Result |
|----------|--------|
| Order with CNA, then RFD | 2 cards appear (duplicate issue) |
| Running checker twice | Creates same duplicates again |
| Updating contact status | Affects only one card (wrong one) |
| Completed case gets new 0013 | Re-opens it (bug) |

### After Fix
| Scenario | Result |
|----------|--------|
| Order with CNA, then RFD | 1 card with RFD + "Previous: CNA on Jun 13" |
| Running checker twice | Updates single card, no duplicates |
| Updating contact status | Affects single card (correct) |
| Completed case gets new 0013 | Stays completed (protected) |

## Files Modified

1. **`src/services/deliveryReviewHelpers.ts`**
   - Modified: `detectAttemptReasonsFromStatusHistory()`
   - Added: `getPreviousAttemptsHistory()`
   - Added: `formatPreviousAttempts()`
   - Added: `PreviousAttempt` interface

2. **`src/services/deliveryReviewService.ts`**
   - Modified: `createDeliveryReviewsFromTrackingResponse()` - Entire function rewritten for UPSERT logic

3. **`src/components/DeliveryUnderReview.tsx`**
   - Updated imports to include new helper functions
   - Modified: "Ready for Reattempt" card section - Added previous attempts chip
   - Modified: "Open Reviews" card section - Added previous attempts chip

4. **`supabase/migrations/20260616_fix_duplicate_delivery_reviews.sql`** (New)
   - Drops old constraint
   - Adds new unique constraint
   - Adds helper function

5. **`supabase/migrations/20260616_cleanup_duplicate_delivery_reviews.sql`** (New)
   - Implements merge cleanup function
   - Merges existing duplicates
   - Preserves contact tracking data

## What Did NOT Change

✅ **Preserved/Unchanged**:
- WhatsApp logic - Still works the same
- Email notification logic - Still works the same
- Reattempt request API - Still works the same
- Order status checking - Still works the same
- Contact tracking API calls - Still work the same
- Other UI sections - No changes
- Database schema (table structure) - No columns added/removed
- Existing order_status_history - Unaffected

## Deployment Steps

1. **Before deploying code**:
   - Backup database or ensure backup is current
   
2. **Deploy code changes**:
   - Push code to production
   - Run `npm run build` to verify compilation
   - Deploy to hosting platform

3. **Apply database migrations** (in order):
   - Run: `20260616_fix_duplicate_delivery_reviews.sql`
     - This adds the new constraint
   - Run: `20260616_cleanup_duplicate_delivery_reviews.sql`
     - This merges existing duplicates

4. **Verify**:
   - Check logs for any errors
   - Verify Delivery Under Review page loads
   - Search for a known order with multiple attempts
   - Confirm only one card appears
   - Verify previous attempts chip displays

## Rollback Instructions

If issues occur:

### Code Rollback
```bash
git revert <commit-hash>
npm run build
# Redeploy
```

### Database Rollback
```sql
-- Drop new constraint
DROP INDEX IF EXISTS uniq_delivery_reviews_tracking_open;

-- Restore old constraint
CREATE UNIQUE INDEX uniq_delivery_reviews_tracking_reason
ON public.delivery_reviews(tracking_number, review_reason_code)
WHERE review_status != 'completed';

-- Drop merge function
DROP FUNCTION IF EXISTS merge_duplicate_delivery_reviews();
DROP FUNCTION IF EXISTS get_delivery_review_attempts_info(TEXT);
```

**Note**: Old duplicates will NOT be restored, but new ones won't be created either.

## Testing

See `DUPLICATE_FIX_TESTING.md` for comprehensive testing checklist including:
- Unit test cases
- Integration test cases  
- Database constraint verification
- UI component testing
- Contact tracking preservation
- Completed case protection
- Logs verification

## Performance Impact

- **Minimal**: One additional SELECT query per order status check (already indexed)
- **Database**: Unique constraint check adds negligible overhead
- **UI**: Helper functions run client-side with minimal data
- **Overall**: No measurable performance degradation

## Success Metrics

✅ **After this fix**:
1. Zero duplicate Delivery Under Review cards per tracking number
2. Always shows latest attempt reason
3. Checker can run multiple times without creating duplicates
4. Contact tracking data is preserved across upserts
5. Completed cases are protected from re-opening
6. Previous attempt history is visible in UI
7. Database enforces uniqueness constraint
8. All logs are clean with no duplicate creation messages

---

**Version**: 1.0  
**Date**: 2026-06-16  
**Status**: Ready for Testing & Deployment
