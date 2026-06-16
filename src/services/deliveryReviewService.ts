/**
 * Delivery Review / RTO Recovery API Service
 * Handles database operations for delivery reviews
 */

import { supabase } from "@/integrations/supabase/client";
import {
  detectAttemptReasonsFromStatusHistory,
  getLatestStatusHistoryEntry,
  NormalizedTrackingResponse,
  AttemptMatch
} from "./deliveryReviewHelpers";

/**
 * Insert order status history entry
 * This prevents duplicate entries for the same tracking number and status combination
 */
export async function saveOrderStatusHistoryIfNew(
  trackingNumber: string,
  orderData: {
    id?: string;
    order_status?: string;
    order_status_prev?: string;
  },
  postexResponse: NormalizedTrackingResponse
): Promise<boolean> {
  try {
    const newStatus = postexResponse.transactionStatus?.toLowerCase();
    const oldStatus = orderData.order_status?.toLowerCase();

    // Check if status actually changed
    if (newStatus === oldStatus) {
      console.log(`[OrderStatusHistory] Status unchanged for ${trackingNumber}, skipping`);
      return false;
    }

    const latestEntry = getLatestStatusHistoryEntry(postexResponse.transactionStatusHistory);

    const historyPayload = {
      tracking_number: trackingNumber,
      order_id: orderData.id || null,
      old_status: oldStatus || null,
      new_status: newStatus || null,
      postex_status_code: latestEntry?.transactionStatusMessageCode || null,
      postex_status_message: latestEntry?.transactionStatusMessage || null,
      postex_updated_at: latestEntry?.updatedAt || null,
      transaction_status_history: postexResponse.transactionStatusHistory || [],
      raw_response: postexResponse
    };

    const { error } = await supabase
      .from("order_status_history")
      .insert([historyPayload]);

    if (error) {
      console.error(
        `[OrderStatusHistory] Error saving history for ${trackingNumber}:`,
        error.message || JSON.stringify(error)
      );
      return false;
    }

    console.log(`[OrderStatusHistory] Saved history for ${trackingNumber}: ${oldStatus} → ${newStatus}`);
    return true;
  } catch (error) {
    console.error(`[OrderStatusHistory] Exception for ${trackingNumber}:`, error);
    return false;
  }
}

/**
 * Create or update delivery reviews from tracking response
 * Implements UPSERT pattern to prevent duplicate Delivery Under Review entries
 * 
 * DEDUPLICATION/UPSERT LOGIC:
 * 1. Only the LATEST [0013] Attempt Made is returned from detectAttemptReasonsFromStatusHistory()
 * 2. Check if an OPEN delivery review already exists for this tracking number
 * 3. If OPEN review exists:
 *    - UPDATE it with the latest attempt reason and details
 *    - Preserve existing contact tracking fields (whatsapp_sent, sales_whatsapp_sent, etc)
 *    - Update attempt_date, attempt_reason, and status history
 *    - This ensures only ONE card appears per tracking number
 * 4. If COMPLETED review exists:
 *    - SKIP (do not modify completed cases)
 * 5. If NO review exists:
 *    - INSERT a new delivery review
 */
export async function createDeliveryReviewsFromTrackingResponse(
  trackingNumber: string,
  orderData: {
    id?: string;
    customer_name?: string;
    customer_phone?: string;
    customer_address?: string;
    customer_city?: string;
    order_amount?: number;
    dispatch_date?: string;
    order_status?: string;
  },
  postexResponse: NormalizedTrackingResponse
): Promise<Array<{ id: string; reason: string }>> {
  try {
    const createdReviews: Array<{ id: string; reason: string }> = [];

    // Detect attempt reasons from status history (returns only latest 0013)
    const attemptMatches = detectAttemptReasonsFromStatusHistory(postexResponse);

    if (attemptMatches.length === 0) {
      console.log(`[DeliveryReview] No attempt reasons detected for ${trackingNumber}`);
      return createdReviews;
    }

    const latestEntry = getLatestStatusHistoryEntry(postexResponse.transactionStatusHistory);
    const match = attemptMatches[0]; // Only one match now (the latest)

    // Check for existing open review for this tracking number
    const { data: existingReviews, error: existingReviewsError } = await supabase
      .from("delivery_reviews")
      .select("id, review_reason_code, review_status, customer_whatsapp_sent, customer_whatsapp_sent_at, sales_whatsapp_sent, sales_whatsapp_sent_at, postex_email_sent, postex_email_sent_at")
      .eq("tracking_number", trackingNumber)
      .order("created_at", { ascending: false });

    if (existingReviewsError) {
      console.warn(
        `[DeliveryReview] Error checking existing reviews for ${trackingNumber}:`,
        existingReviewsError.message
      );
    }

    // Find the first open review (if any)
    const openReview = existingReviews?.find((r) => r.review_status === "open");
    const completedReview = existingReviews?.find((r) => r.review_status === "completed");

    // If there's a completed review, don't modify it
    if (completedReview && !openReview) {
      console.log(
        `[DeliveryReview] Order ${trackingNumber} has completed review (${completedReview.review_reason_code}). Skipping to preserve closed case.`
      );
      return createdReviews;
    }

    // Build the review payload
    const reviewPayload = {
      order_id: orderData.id || null,
      tracking_number: trackingNumber,
      order_ref_number: postexResponse.orderRefNumber || null,
      customer_name: orderData.customer_name || postexResponse.customerName || null,
      customer_phone: orderData.customer_phone || postexResponse.customerPhone || null,
      customer_city: orderData.customer_city || null,
      delivery_address: orderData.customer_address || postexResponse.deliveryAddress || null,
      order_detail: postexResponse.orderDetail || null,
      order_amount: orderData.order_amount || null,
      dispatch_date: orderData.dispatch_date ? new Date(orderData.dispatch_date).toISOString() : null,
      attempt_date: new Date().toISOString(),
      review_reason_code: match.code,
      review_reason_label: match.label,
      review_reason_display: match.display,
      initial_attempt_status: postexResponse.transactionStatus || null,
      initial_status_history_code: match.historyEntry?.transactionStatusMessageCode || null,
      initial_status_history_message: match.historyEntry?.transactionStatusMessage || null,
      initial_status_history_updated_at: match.historyEntry?.updatedAt || null,
      latest_status_history_code: latestEntry?.transactionStatusMessageCode || null,
      latest_status_history_message: latestEntry?.transactionStatusMessage || null,
      latest_status_history_updated_at: latestEntry?.updatedAt || null,
      current_order_status: postexResponse.transactionStatus?.toLowerCase() || null,
      review_status: "open",
      raw_postex_response: postexResponse
    };

    try {
      if (openReview) {
        // UPSERT: Update existing open review with latest attempt details
        console.log(
          `[DeliveryReview] Updating existing open review for ${trackingNumber}: ${openReview.review_reason_code} → ${match.code}`
        );

        const { data: updated, error: updateError } = await supabase
          .from("delivery_reviews")
          .update(reviewPayload)
          .eq("id", openReview.id)
          .select("id")
          .single();

        if (updateError) {
          console.error(
            `[DeliveryReview] Error updating review for ${trackingNumber}:`,
            updateError.message || JSON.stringify(updateError)
          );
          return createdReviews;
        }

        console.log(
          `[DeliveryReview] Updated review ${updated.id} for ${trackingNumber}/${match.code}`
        );
        createdReviews.push({
          id: updated.id,
          reason: match.code
        });
      } else {
        // INSERT: Create new delivery review
        const { data: review, error: insertError } = await supabase
          .from("delivery_reviews")
          .insert([reviewPayload])
          .select("id")
          .single();

        if (insertError) {
          console.error(
            `[DeliveryReview] Error creating review for ${trackingNumber}/${match.code}:`,
            insertError.message || JSON.stringify(insertError)
          );
          return createdReviews;
        }

        console.log(
          `[DeliveryReview] Created review ${review.id} for ${trackingNumber}/${match.code}`
        );
        createdReviews.push({
          id: review.id,
          reason: match.code
        });
      }
    } catch (error) {
      console.error(
        `[DeliveryReview] Exception creating/updating review for ${trackingNumber}/${match.code}:`,
        error instanceof Error ? error.message : JSON.stringify(error)
      );
    }

    return createdReviews;
  } catch (error) {
    console.error(
      `[DeliveryReview] Exception for ${trackingNumber}:`,
      error instanceof Error ? error.message : JSON.stringify(error)
    );
    return [];
  }
}

/**
 * Complete delivery reviews if order is delivered
 * Updates all open reviews for this tracking number
 */
export async function completeDeliveryReviewsIfDelivered(
  trackingNumber: string,
  newStatus: string,
  postexResponse: NormalizedTrackingResponse
): Promise<number> {
  try {
    // Only process if delivered
    if (!newStatus.toUpperCase().includes("DELIVERED")) {
      return 0;
    }

    const latestEntry = getLatestStatusHistoryEntry(postexResponse.transactionStatusHistory);

    // Update all open reviews for this tracking number
    const { error, data } = await supabase
      .from("delivery_reviews")
      .update({
        review_status: "completed",
        final_outcome: "delivered_after_followup",
        current_order_status: newStatus.toLowerCase(),
        latest_status_history_code: latestEntry?.transactionStatusMessageCode,
        latest_status_history_message: latestEntry?.transactionStatusMessage,
        latest_status_history_updated_at: latestEntry?.updatedAt,
        completed_at: new Date().toISOString(),
        notes: "Order delivered - review completed"
      })
      .eq("tracking_number", trackingNumber)
      .eq("review_status", "open")
      .select("id");

    if (error) {
      console.error(
        `[DeliveryReview] Error completing reviews for ${trackingNumber}:`,
        error.message || JSON.stringify(error)
      );
      return 0;
    }

    const count = data?.length || 0;
    if (count > 0) {
      console.log(
        `[DeliveryReview] Completed ${count} reviews for ${trackingNumber} - delivered`
      );
    }

    return count;
  } catch (error) {
    console.error(
      `[DeliveryReview] Exception completing reviews for ${trackingNumber}:`,
      error instanceof Error ? error.message : JSON.stringify(error)
    );
    return 0;
  }
}

/**
 * Complete delivery reviews if order is returned
 * Updates all open reviews for this tracking number
 */
export async function completeDeliveryReviewsIfReturned(
  trackingNumber: string,
  newStatus: string,
  postexResponse: NormalizedTrackingResponse
): Promise<number> {
  try {
    // Only process if actually returned (not interim return status)
    const statusUpper = newStatus.toUpperCase();
    const isActuallyReturned =
      statusUpper === "RETURNED" ||
      statusUpper.includes("RETURNED") ||
      statusUpper.includes("RETURN CONFIRMED");

    if (!isActuallyReturned) {
      return 0;
    }

    const latestEntry = getLatestStatusHistoryEntry(postexResponse.transactionStatusHistory);

    // Update all open reviews for this tracking number
    const { error, data } = await supabase
      .from("delivery_reviews")
      .update({
        review_status: "completed",
        final_outcome: "returned_confirmed",
        current_order_status: newStatus.toLowerCase(),
        latest_status_history_code: latestEntry?.transactionStatusMessageCode,
        latest_status_history_message: latestEntry?.transactionStatusMessage,
        latest_status_history_updated_at: latestEntry?.updatedAt,
        completed_at: new Date().toISOString(),
        notes: "Order returned - review completed"
      })
      .eq("tracking_number", trackingNumber)
      .eq("review_status", "open")
      .select("id");

    if (error) {
      console.error(
        `[DeliveryReview] Error completing reviews for ${trackingNumber}:`,
        error.message || JSON.stringify(error)
      );
      return 0;
    }

    const count = data?.length || 0;
    if (count > 0) {
      console.log(
        `[DeliveryReview] Completed ${count} reviews for ${trackingNumber} - returned`
      );
    }

    return count;
  } catch (error) {
    console.error(
      `[DeliveryReview] Exception completing reviews for ${trackingNumber}:`,
      error instanceof Error ? error.message : JSON.stringify(error)
    );
    return 0;
  }
}

/**
 * Update delivery review with WhatsApp sent status
 */
export async function markDeliveryReviewWhatsAppSent(
  reviewId: string,
  sentAt?: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("delivery_reviews")
      .update({
        whatsapp_sent: true,
        whatsapp_sent_at: sentAt || new Date().toISOString()
      })
      .eq("id", reviewId);

    if (error) {
      console.error(
        `[DeliveryReview] Error marking WhatsApp sent for ${reviewId}:`,
        error.message || JSON.stringify(error)
      );
      return false;
    }

    console.log(`[DeliveryReview] Marked WhatsApp sent for review ${reviewId}`);
    return true;
  } catch (error) {
    console.error(
      `[DeliveryReview] Exception marking WhatsApp sent:`,
      error instanceof Error ? error.message : JSON.stringify(error)
    );
    return false;
  }
}

/**
 * Update delivery review status
 */
export async function updateDeliveryReviewStatus(
  reviewId: string,
  updates: Record<string, any>
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("delivery_reviews")
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq("id", reviewId);

    if (error) {
      console.error(
        `[DeliveryReview] Error updating review ${reviewId}:`,
        error.message || JSON.stringify(error)
      );
      return false;
    }

    console.log(`[DeliveryReview] Updated review ${reviewId}`);
    return true;
  } catch (error) {
    console.error(
      `[DeliveryReview] Exception updating review:`,
      error instanceof Error ? error.message : JSON.stringify(error)
    );
    return false;
  }
}

/**
 * Mark customer WhatsApp as sent with timestamp
 */
export async function markCustomerWhatsAppSent(reviewId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("delivery_reviews")
      .update({
        customer_whatsapp_sent: true,
        customer_whatsapp_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", reviewId);

    if (error) {
      console.error(
        `[DeliveryReview] Error marking customer WhatsApp sent for ${reviewId}:`,
        error.message || JSON.stringify(error)
      );
      return false;
    }

    console.log(`[DeliveryReview] Marked customer WhatsApp sent for ${reviewId}`);
    return true;
  } catch (error) {
    console.error(
      `[DeliveryReview] Exception marking customer WhatsApp sent:`,
      error instanceof Error ? error.message : JSON.stringify(error)
    );
    return false;
  }
}

/**
 * Mark sales WhatsApp as sent with timestamp
 */
export async function markSalesWhatsAppSent(reviewId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("delivery_reviews")
      .update({
        sales_whatsapp_sent: true,
        sales_whatsapp_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", reviewId);

    if (error) {
      console.error(
        `[DeliveryReview] Error marking sales WhatsApp sent for ${reviewId}:`,
        error.message || JSON.stringify(error)
      );
      return false;
    }

    console.log(`[DeliveryReview] Marked sales WhatsApp sent for ${reviewId}`);
    return true;
  } catch (error) {
    console.error(
      `[DeliveryReview] Exception marking sales WhatsApp sent:`,
      error instanceof Error ? error.message : JSON.stringify(error)
    );
    return false;
  }
}

/**
 * Mark PostEx email as sent with timestamp
 */
export async function markPostExEmailSent(reviewId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("delivery_reviews")
      .update({
        postex_email_sent: true,
        postex_email_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", reviewId);

    if (error) {
      console.error(
        `[DeliveryReview] Error marking PostEx email sent for ${reviewId}:`,
        error.message || JSON.stringify(error)
      );
      return false;
    }

    console.log(`[DeliveryReview] Marked PostEx email sent for ${reviewId}`);
    return true;
  } catch (error) {
    console.error(
      `[DeliveryReview] Exception marking PostEx email sent:`,
      error instanceof Error ? error.message : JSON.stringify(error)
    );
    return false;
  }
}
