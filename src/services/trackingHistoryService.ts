/**
 * Tracking History Update Service
 * Handles fetching and updating the latest tracking history for orders in delivery under review
 */

import { supabase } from "@/integrations/supabase/client";
import { fetchOrderDetails } from "./postexApiService";
import { NormalizedTrackingResponse } from "./deliveryReviewHelpers";

export interface TrackingHistoryUpdateResult {
  success: boolean;
  message: string;
  updatedCount?: number;
  error?: string;
}

/**
 * Fetch and update tracking history for all orders in delivery under review
 * This ensures that orders show the most recent tracking history, regardless of
 * whether they were reattempted or not
 */
export async function updateTrackingHistoryForDeliveryReviews(): Promise<TrackingHistoryUpdateResult> {
  try {
    console.log("[TrackingHistory] Starting update for delivery reviews...");

    // Step 1: Fetch all open and courier_followup delivery reviews
    const { data: reviews, error: fetchError } = await supabase
      .from("delivery_reviews")
      .select("id, tracking_number, dispatch_date, review_status")
      .in("review_status", ["open", "courier_followup"]);

    if (fetchError) {
      console.error("[TrackingHistory] Error fetching delivery reviews:", fetchError);
      return {
        success: false,
        message: "Failed to fetch delivery reviews",
        error: fetchError.message,
      };
    }

    if (!reviews || reviews.length === 0) {
      console.log("[TrackingHistory] No open reviews to update");
      return {
        success: true,
        message: "No open reviews to update",
        updatedCount: 0,
      };
    }

    console.log(`[TrackingHistory] Found ${reviews.length} reviews to update`);

    let updatedCount = 0;
    const errors: Array<{ trackingNumber: string; error: string }> = [];

    // Step 2: For each review, fetch the latest tracking data from PostEx
    for (const review of reviews) {
      try {
        console.log(`[TrackingHistory] Fetching latest tracking for ${review.tracking_number}...`);

        // Fetch the latest tracking data from PostEx
        const trackingData = await fetchOrderDetails(review.tracking_number, review.dispatch_date);

        if (!trackingData || !trackingData.dist) {
          console.warn(`[TrackingHistory] No tracking data received for ${review.tracking_number}`);
          errors.push({
            trackingNumber: review.tracking_number,
            error: "No tracking data from PostEx",
          });
          continue;
        }

        const normalizedData = trackingData.dist;

        // Step 3: Update the delivery review with the latest tracking history
        const { error: updateError } = await supabase
          .from("delivery_reviews")
          .update({
            raw_postex_response: normalizedData,
            updated_at: new Date().toISOString(),
          })
          .eq("id", review.id);

        if (updateError) {
          console.error(
            `[TrackingHistory] Error updating review ${review.id}:`,
            updateError
          );
          errors.push({
            trackingNumber: review.tracking_number,
            error: updateError.message,
          });
          continue;
        }

        console.log(
          `[TrackingHistory] Updated tracking history for ${review.tracking_number}`,
          {
            historyCount: normalizedData.transactionStatusHistory?.length || 0,
            currentStatus: normalizedData.transactionStatus,
          }
        );

        updatedCount++;
      } catch (error) {
        console.error(
          `[TrackingHistory] Exception updating ${review.tracking_number}:`,
          error
        );
        errors.push({
          trackingNumber: review.tracking_number,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Step 4: Log summary
    const summary = {
      total: reviews.length,
      updated: updatedCount,
      failed: errors.length,
    };

    console.log("[TrackingHistory] Update complete:", summary);

    if (errors.length > 0) {
      console.warn("[TrackingHistory] Errors encountered:", errors);
    }

    return {
      success: true,
      message: `Updated tracking history for ${updatedCount} of ${reviews.length} reviews`,
      updatedCount,
    };
  } catch (error) {
    console.error("[TrackingHistory] Exception in updateTrackingHistoryForDeliveryReviews:", error);
    return {
      success: false,
      message: "An error occurred while updating tracking history",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    };
  }
}

/**
 * Fetch and update tracking history for a specific delivery review
 * Useful for manual refresh or when viewing a specific order
 */
export async function updateTrackingHistoryForReview(
  reviewId: string,
  trackingNumber: string,
  dispatchDate?: string
): Promise<TrackingHistoryUpdateResult> {
  try {
    console.log(`[TrackingHistory] Fetching latest tracking for review ${reviewId}...`);

    // Fetch the latest tracking data from PostEx
    const trackingData = await fetchOrderDetails(trackingNumber, dispatchDate);

    if (!trackingData || !trackingData.dist) {
      console.warn(`[TrackingHistory] No tracking data received for ${trackingNumber}`);
      return {
        success: false,
        message: "No tracking data from PostEx",
        error: "POSTEX_NO_DATA",
      };
    }

    const normalizedData = trackingData.dist;

    // Update the delivery review with the latest tracking history
    const { error: updateError } = await supabase
      .from("delivery_reviews")
      .update({
        raw_postex_response: normalizedData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reviewId);

    if (updateError) {
      console.error(`[TrackingHistory] Error updating review ${reviewId}:`, updateError);
      return {
        success: false,
        message: "Failed to update tracking history",
        error: updateError.message,
      };
    }

    console.log(`[TrackingHistory] Updated tracking history for ${trackingNumber}`, {
      historyCount: normalizedData.transactionStatusHistory?.length || 0,
      currentStatus: normalizedData.transactionStatus,
    });

    return {
      success: true,
      message: "Tracking history updated successfully",
      updatedCount: 1,
    };
  } catch (error) {
    console.error(`[TrackingHistory] Exception updating review ${reviewId}:`, error);
    return {
      success: false,
      message: "An error occurred while updating tracking history",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    };
  }
}
