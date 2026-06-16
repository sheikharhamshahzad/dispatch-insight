# Deployment Guide: Delivery Under Review Module

## Pre-Deployment Checklist

- [ ] All files have been created
- [ ] Database migration file exists
- [ ] No TypeScript compilation errors
- [ ] All imports are correct

## Step-by-Step Deployment

### 1. Apply Database Migration

```bash
# Navigate to project directory
cd c:\Users\arham\OneDrive\Desktop\AstroPortal\dispatch-insight

# Apply the Supabase migration
# Option A: Using Supabase CLI
supabase migration up

# Option B: Manual SQL execution
# Copy the SQL from: supabase/migrations/20250610000000_add_delivery_reviews_tables.sql
# Paste into Supabase SQL Editor and execute
```

**Expected Results**:
- Two new tables: `order_status_history` and `delivery_reviews`
- Indexes created on relevant columns
- Trigger created for `updated_at` column

### 2. Verify Migration Success

```sql
-- Check tables were created
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('order_status_history', 'delivery_reviews');

-- Expected output: 2 rows
```

### 3. Rebuild and Deploy

```bash
# Install dependencies (if needed)
bun install

# Build the project
bun run build

# The following files will be bundled:
# - src/services/deliveryReviewHelpers.ts
# - src/services/deliveryReviewService.ts
# - src/components/DeliveryUnderReview.tsx
# - src/services/orderStatusChecker.ts (updated)
# - src/pages/Index.tsx (updated)
```

### 4. Start the Application

```bash
# Development
bun run dev

# Production
bun run build && bun run preview
```

### 5. Test the Integration

#### 5.1 Check Order Status Checker
```javascript
// In browser console at /dashboard
// Order status checker should run automatically
// Check logs:
console.log("Status checker will process pending orders every 6 hours")
```

#### 5.2 Verify New Tab Appears
- Navigate to dashboard
- Look for "RTO Recovery" tab between "Orders" and "Ad Costs"
- Tab should load without errors

#### 5.3 Test Delivery Review Detection
```sql
-- Manually check if delivery reviews are being created
-- After 6-hour interval or manual trigger
SELECT COUNT(*) FROM public.delivery_reviews;
SELECT * FROM public.delivery_reviews LIMIT 1;
```

#### 5.4 Test WhatsApp Integration
- Click on a delivery review (if any exist)
- Click "WhatsApp" button
- Should open WhatsApp with pre-filled message
- Message should be customized based on attempt reason

## Files Modified/Created

### New Files (5):
1. `supabase/migrations/20250610000000_add_delivery_reviews_tables.sql` - Database migration
2. `src/services/deliveryReviewHelpers.ts` - Helper functions
3. `src/services/deliveryReviewService.ts` - API service layer
4. `src/components/DeliveryUnderReview.tsx` - Frontend component
5. `DELIVERY_UNDER_REVIEW_IMPLEMENTATION.md` - Documentation

### Modified Files (2):
1. `src/services/orderStatusChecker.ts` - Added delivery review integration
2. `src/pages/Index.tsx` - Added new tab and import

### Configuration Files (0):
- No config changes needed
- No environment variables added
- Existing Supabase connection reused

## Troubleshooting

### Issue: "Delivery reviews not being created"
**Solution**:
1. Verify migration was applied: `SELECT * FROM delivery_reviews;`
2. Check browser console for errors in `deliveryReviewService.ts`
3. Verify order status checker is running (check logs every 6 hours)
4. Manually trigger: `checkAndUpdateOrderStatuses()` in console

### Issue: "RTO Recovery tab not appearing"
**Solution**:
1. Hard refresh browser (Ctrl+Shift+R)
2. Clear browser cache
3. Verify build completed successfully
4. Check browser console for import errors

### Issue: "WhatsApp links not working"
**Solution**:
1. Verify phone number format is valid Pakistan number
2. Check: `formatPakistanPhoneForWhatsApp()` is converting correctly
3. Ensure WhatsApp Web is accessible from your network
4. Test manually: `https://wa.me/923001234567?text=Hello`

### Issue: "Database migration failed"
**Solution**:
1. Check migration file syntax
2. Verify you have correct Supabase permissions
3. Run migration step by step if needed
4. Check Supabase error logs

## Rollback Plan (If Needed)

```sql
-- Drop the new tables (data will be lost)
DROP TABLE IF EXISTS public.delivery_reviews CASCADE;
DROP TABLE IF EXISTS public.order_status_history CASCADE;

-- Verify rollback
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('order_status_history', 'delivery_reviews');

-- Expected: No rows returned
```

Then:
1. Revert code changes to `orderStatusChecker.ts` and `Index.tsx`
2. Remove the new service files
3. Rebuild and redeploy

## Performance Considerations

- **Batch Size**: 50 orders per batch (maintained from original)
- **Database Indexes**: All important columns indexed for fast queries
- **Update Frequency**: Every 6 hours (same as existing checker)
- **Storage**: Minimal impact - only new orders with attempts create reviews

## Monitoring

### Key Metrics to Track
```sql
-- Total delivery reviews created
SELECT COUNT(*) as total_reviews FROM delivery_reviews;

-- Open reviews (not yet contacted)
SELECT COUNT(*) FROM delivery_reviews WHERE review_status = 'open';

-- WhatsApp sent (contacted)
SELECT COUNT(*) FROM delivery_reviews WHERE whatsapp_sent = true;

-- Successful outcomes
SELECT final_outcome, COUNT(*) 
FROM delivery_reviews 
WHERE review_status = 'completed'
GROUP BY final_outcome;

-- By attempt reason
SELECT review_reason_code, COUNT(*) 
FROM delivery_reviews 
GROUP BY review_reason_code;
```

## Support & Logs

All operations logged with `[DeliveryReview]` prefix for easy searching:
- `[DeliveryReview] Created review {id}`
- `[DeliveryReview] Completed reviews for {trackingNumber}`
- `[OrderStatusHistory] Saved history for {trackingNumber}`

Check browser console (F12) for real-time logs during status checking.
