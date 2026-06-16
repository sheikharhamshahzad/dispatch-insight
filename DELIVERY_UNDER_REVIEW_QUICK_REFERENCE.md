# Delivery Under Review - Quick Reference

## What Was Built

A complete RTO (Return To Origin) Recovery module that:
- 🎯 Detects failed delivery attempts (code 0013) from PostEx API
- 📱 Sends WhatsApp messages to customers with attempt reasons
- 📊 Tracks follow-up actions and recovery outcomes
- 💾 Maintains permanent audit trail of all attempts
- 🚀 Integrates seamlessly with existing order workflow

## Core Features

### Attempt Reason Detection
Automatically detects when customers refuse or are unavailable:
- **RFD**: Refused To Receive
- **CNA**: Customer Not Available
- **ICA**: Incomplete Address
- **OPN**: Customer Wants to Open Parcel
- **PNA**: Payment Not Available

### Dashboard Metrics
- Total cases under review
- WhatsApp messages sent
- Successful deliveries after follow-up
- Recovery rate percentage

### Customer Actions
- Send WhatsApp with pre-written message
- Mark as contacted
- Mark order as returned
- Mark attempt as fake
- Add custom notes

## How It Works

```
Every 6 Hours:
1. Check all pending orders via PostEx Bulk API
2. If attempt detected (code 0013):
   → Create delivery review record
   → Add to "Delivery Under Review" queue
3. Support team contacts customer via WhatsApp
4. When order is finally delivered/returned:
   → Mark review as completed
   → Calculate recovery metrics
```

## Files Overview

### Backend Services
| File | Purpose |
|------|---------|
| `deliveryReviewHelpers.ts` | Helper functions for parsing attempt reasons |
| `deliveryReviewService.ts` | Database operations for reviews |
| `orderStatusChecker.ts` | MODIFIED: Integrated delivery review creation |

### Frontend
| File | Purpose |
|------|---------|
| `DeliveryUnderReview.tsx` | Main UI component |
| `Index.tsx` | MODIFIED: Added RTO Recovery tab |

### Database
| Table | Purpose |
|-------|---------|
| `order_status_history` | Audit log of all status changes |
| `delivery_reviews` | RTO recovery case management |

## Setup Steps

1. **Apply Database Migration**
   ```bash
   # Migration file: supabase/migrations/20250610000000_add_delivery_reviews_tables.sql
   ```

2. **Rebuild Project**
   ```bash
   bun run build
   ```

3. **Restart Application**
   ```bash
   bun run dev
   ```

4. **Verify**
   - Go to Dashboard → "RTO Recovery" tab
   - Should see empty list initially
   - After next status check (6 hours), reviews will appear

## Key Technical Details

### Database Constraints
- **Duplicate Prevention**: `(tracking_number, review_reason_code)` unique
- **Relationships**: Foreign keys to orders table for data integrity
- **Automatic Timestamps**: `updated_at` automatically set on changes

### API Response Handling
- Supports both bulk and single PostEx API formats
- Handles missing/incomplete data gracefully
- Parses transaction status history arrays
- Extracts attempt reason codes from text messages

### WhatsApp Integration
- Automatically formats phone numbers (converts to 92XXXXXXXXXX)
- Generates context-aware messages per attempt reason
- Pre-fills message when WhatsApp opens
- Tracks which customers were contacted

## Important Notes

✅ **Non-Breaking**: Existing order workflow completely unchanged
✅ **Safe**: All new data in separate tables
✅ **Automatic**: No manual configuration needed
✅ **Reversible**: Can be rolled back if needed
✅ **Scalable**: Uses same batch processing as existing checker

⚠️ **First Attempt Review**: New reviews only created for orders with 0013 status codes in PostEx history
⚠️ **Phone Format**: Assumes Pakistani phone numbers for WhatsApp
⚠️ **6-Hour Interval**: Status checker runs every 6 hours - reviews not immediate

## Testing Without Real PostEx Data

### Option 1: Manual Database Insert
```sql
INSERT INTO delivery_reviews (
  tracking_number, order_ref_number, customer_name, customer_phone,
  review_reason_code, review_reason_label, review_reason_display,
  attempt_date, review_status
) VALUES (
  'TEST-001', 'ORD-001', 'Ahmed Khan', '03001234567',
  'RFD', 'REFUSED TO RECEIVE', 'RFD - Refused To Receive',
  now(), 'open'
);
```

### Option 2: Wait for Real Attempt
- Create a test order in system
- Dispatch via PostEx
- Force a delivery attempt that PostEx marks as attempt (0013)
- Next status checker run will create the review

## Monitoring & Debugging

### Check if Reviews are Being Created
```sql
SELECT COUNT(*) FROM delivery_reviews;
SELECT * FROM delivery_reviews ORDER BY created_at DESC LIMIT 5;
```

### Check Status History
```sql
SELECT * FROM order_status_history ORDER BY created_at DESC LIMIT 10;
```

### Check Order Status Checker Logs
- Open browser DevTools (F12)
- Watch Console tab
- Should see `[OrderStatusHistory]` and `[DeliveryReview]` logs

## Common Questions

**Q: Why aren't delivery reviews appearing?**
A: Order status checker only runs every 6 hours. If you just started, wait 6 hours or manually trigger `checkAndUpdateOrderStatuses()` in console.

**Q: Can I change the attempt reasons?**
A: Yes! Edit `ATTEMPT_REASONS` array in `deliveryReviewHelpers.ts` and add/modify reason codes.

**Q: What if customer's phone number is invalid?**
A: The WhatsApp URL will still be generated but won't connect. The `formatPakistanPhoneForWhatsApp()` function handles most Pakistan formats.

**Q: Will this affect existing orders?**
A: No. Only new attempt attempts are detected going forward. Existing orders won't have reviews created unless they get a new 0013 status.

**Q: Can I delete completed reviews?**
A: Not recommended. The `final_outcome` field tracks resolution type. Best practice is to archive old data periodically.

## Support

For issues:
1. Check browser console for error messages (F12)
2. Check database tables exist: `SELECT * FROM information_schema.tables WHERE table_schema='public';`
3. Verify migration was applied successfully
4. Check `orderStatusChecker.ts` logs for API errors

## Version History

- **v1.0** (Current): Initial implementation with WhatsApp integration
- Future: SMS fallback, escalation workflows, analytics dashboard
