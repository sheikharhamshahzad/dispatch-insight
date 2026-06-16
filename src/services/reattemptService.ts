import { supabase } from "@/integrations/supabase/client";
import { POSTEX_API_CONFIG, getPostexApiToken } from "@/services/postexApiService";

// PostEx API endpoints (matching pattern from working track-order endpoints)
const POSTEX_SAVE_SHIPPER_ADVICE_URL = "https://api.postex.pk/services/integration/api/order/v2/save-shipper-advice";
const POSTEX_GET_SHIPPER_ADVICE_BASE = "https://api.postex.pk/services/integration/api/order/v1/get-shipper-advice";

export interface ReattemptRequestPayload {
  remarks: string;
}

export interface ReattemptResponse {
  success: boolean;
  message: string;
  postexResponse?: any;
  error?: string;
}

/**
 * Request reattempt for a delivery review
 * Calls PostEx Save Shipper Advice API with statusId=2 (Mark Retry Attempt)
 * NOTE: PostEx API only supports statusId 1 (Return) and 2 (Retry)
 * The tracking history message "Merchant Request For Re-Attempt" vs "Attempt Made" 
 * depends on PostEx's internal logic and may vary based on order state
 */
export async function requestReattempt(
  deliveryReviewId: string,
  remarks: string
): Promise<ReattemptResponse> {
  try {
    // Validate inputs
    if (!deliveryReviewId || !remarks.trim()) {
      return {
        success: false,
        message: "Delivery review ID and remarks are required",
        error: "VALIDATION_ERROR",
      };
    }

    // Step 1: Fetch the delivery review
     const { data: review, error: fetchError } = await (supabase as any)
       .from("delivery_reviews")
       .select("id, tracking_number, reattempt_requested, dispatch_date")
       .eq("id", deliveryReviewId)
       .single();

    if (fetchError || !review) {
      console.error("Error fetching delivery review:", fetchError);
      return {
        success: false,
        message: "Delivery review not found",
        error: "NOT_FOUND",
      };
    }

    // Step 2: Check if reattempt was already requested
    if (review.reattempt_requested) {
      console.warn(`Reattempt already requested for review ${deliveryReviewId}`);
      // Allow re-requesting but user should see confirmation
    }

    // Step 3: Call PostEx Save Shipper Advice API
    // Get the appropriate token based on dispatch date
    const postexToken = review.dispatch_date 
      ? getPostexApiToken(review.dispatch_date)
      : POSTEX_API_CONFIG.NEW_TOKEN;

    // Call Save Shipper Advice API with statusId as NUMBER (not string)
    const postexResponse = await fetch(
      POSTEX_SAVE_SHIPPER_ADVICE_URL,
      {
        method: "PUT",
        headers: {
          "token": postexToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trackingNumber: review.tracking_number,
          statusId: 2, // MUST be number 2 = Mark Retry Attempt
          remarks: remarks,
        }),
      }
    );

    const responseText = await postexResponse.text();
    let postexData: any;
    
    try {
      postexData = JSON.parse(responseText);
    } catch (parseError) {
      console.error("PostEx Save Shipper Advice API returned non-JSON response:", responseText);
      console.error("Response status:", postexResponse.status);
      return {
        success: false,
        message: "PostEx API returned invalid response (not JSON). Check console for details.",
        error: "POSTEX_INVALID_RESPONSE",
        postexResponse: responseText,
      };
    }

    console.log("PostEx Save Shipper Advice API response:", {
      status: postexResponse.status,
      data: postexData,
      trackingNumber: review.tracking_number,
      statusId: 2,
    });

    if (!postexResponse.ok) {
      console.error("PostEx Save Shipper Advice API error - Status:", postexResponse.status, "Response:", postexData);
      return {
        success: false,
        message: "Failed to process reattempt request with PostEx",
        error: "POSTEX_ERROR",
        postexResponse: postexData,
      };
    }

    // Verify the advice was saved by calling Get Shipper Advice API
    console.log("Verifying reattempt advice was saved for tracking number:", review.tracking_number);
    const getAdviceUrl = `${POSTEX_GET_SHIPPER_ADVICE_BASE}/${review.tracking_number}`;
    const getAdviceResponse = await fetch(getAdviceUrl, {
      method: "GET",
      headers: {
        "token": postexToken,
        "Accept": "application/json",
      },
    });

    const getAdviceText = await getAdviceResponse.text();
    try {
      const getAdviceData = JSON.parse(getAdviceText);
      console.log("Get Shipper Advice API response:", {
        status: getAdviceResponse.status,
        data: getAdviceData,
        trackingNumber: review.tracking_number,
      });
    } catch (e) {
      console.error("Get Shipper Advice API returned non-JSON:", getAdviceText);
    }

     // Step 4: Fetch the updated tracking data to get the latest history
     console.log("Fetching updated tracking data after reattempt request...");
     const trackingUrl = `https://api.postex.pk/services/integration/api/order/v1/track-order/${review.tracking_number}`;
     const trackingResponse = await fetch(trackingUrl, {
       method: "GET",
       headers: {
         "token": postexToken,
         "Accept": "application/json",
       },
     });

     let updatedTrackingData: any = null;
     if (trackingResponse.ok) {
       try {
         updatedTrackingData = await trackingResponse.json();
         console.log("Updated tracking data received:", {
           trackingNumber: review.tracking_number,
           status: updatedTrackingData?.dist?.transactionStatus,
           historyCount: updatedTrackingData?.dist?.transactionStatusHistory?.length || 0,
         });
       } catch (e) {
         console.error("Failed to parse updated tracking data:", e);
       }
     }

      // Step 5: Update delivery_reviews with reattempt info AND updated tracking history
      // Note: We mark it as reattempt_requested but keep review_status as "open"
      // This ensures the open cases count doesn't decrease when reattempt is requested
      // The order will move to actual reattempt status when PostEx tracking updates
      const now = new Date().toISOString();
      const updatePayload: Record<string, any> = {
        reattempt_requested: true,
        reattempt_requested_at: now,
        reattempt_remarks: remarks,
        postex_reattempt_response: postexData,
        courier_action: "reattempt_requested",
        final_outcome: "pending",
        // Keep review_status as "open" so it stays in the open cases count
        notes: `Reattempt advice sent to PostEx. Waiting for courier status update.`,
        updated_at: now,
      };

     // If we got updated tracking data, include it in the raw_postex_response
     if (updatedTrackingData?.dist) {
       updatePayload.raw_postex_response = updatedTrackingData.dist;
       console.log("Updated raw_postex_response with latest tracking history");
     }

     const { error: updateError } = await (supabase as any)
       .from("delivery_reviews")
       .update(updatePayload)
       .eq("id", deliveryReviewId);

    if (updateError) {
      console.error("Error updating delivery review:", updateError);
      // Still consider this a success since PostEx API succeeded
      // Database update failure is secondary
      return {
        success: true,
        message: "Reattempt request sent but database update had issues",
        postexResponse: postexData,
      };
    }

    return {
      success: true,
      message: "Reattempt requested successfully",
      postexResponse: postexData,
    };
  } catch (error) {
    console.error("Exception in requestReattempt:", error);
    return {
      success: false,
      message: "An error occurred while processing the reattempt request",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    };
  }
}

/**
 * Request return for a delivery review (similar to reattempt but with statusId=1)
 */
export async function requestReturn(
  deliveryReviewId: string,
  remarks: string
): Promise<ReattemptResponse> {
  try {
    if (!deliveryReviewId || !remarks.trim()) {
      return {
        success: false,
        message: "Delivery review ID and remarks are required",
        error: "VALIDATION_ERROR",
      };
    }

     const { data: review, error: fetchError } = await (supabase as any)
       .from("delivery_reviews")
       .select("id, tracking_number, dispatch_date")
       .eq("id", deliveryReviewId)
       .single();

    if (fetchError || !review) {
      console.error("Error fetching delivery review:", fetchError);
      return {
        success: false,
        message: "Delivery review not found",
        error: "NOT_FOUND",
      };
    }

    // Get the appropriate token based on dispatch date
    const postexToken = review.dispatch_date 
      ? getPostexApiToken(review.dispatch_date)
      : POSTEX_API_CONFIG.NEW_TOKEN;

    const postexResponse = await fetch(
      POSTEX_SAVE_SHIPPER_ADVICE_URL,
      {
        method: "PUT",
        headers: {
          "token": postexToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trackingNumber: review.tracking_number,
          statusId: 1, // MUST be number 1 = Mark Return Requested
          remarks: remarks,
        }),
      }
    );

    const responseText = await postexResponse.text();
    let postexData: any;
    
    try {
      postexData = JSON.parse(responseText);
    } catch (parseError) {
      console.error("PostEx Save Shipper Advice API returned non-JSON response:", responseText);
      console.error("Response status:", postexResponse.status);
      return {
        success: false,
        message: "PostEx API returned invalid response (not JSON). Check console for details.",
        error: "POSTEX_INVALID_RESPONSE",
        postexResponse: responseText,
      };
    }

    console.log("PostEx Save Shipper Advice API response (Return):", {
      status: postexResponse.status,
      data: postexData,
      trackingNumber: review.tracking_number,
      statusId: 1,
    });

    if (!postexResponse.ok) {
      console.error("PostEx Save Shipper Advice API error - Status:", postexResponse.status, "Response:", postexData);
      return {
        success: false,
        message: "Failed to process return request with PostEx",
        error: "POSTEX_ERROR",
        postexResponse: postexData,
      };
    }

    // Verify the advice was saved
    console.log("Verifying return advice was saved for tracking number:", review.tracking_number);
    const getAdviceUrl = `${POSTEX_GET_SHIPPER_ADVICE_BASE}/${review.tracking_number}`;
    const getAdviceResponse = await fetch(getAdviceUrl, {
      method: "GET",
      headers: {
        "token": postexToken,
        "Accept": "application/json",
      },
    });

    const getAdviceText = await getAdviceResponse.text();
    try {
      const getAdviceData = JSON.parse(getAdviceText);
      console.log("Get Shipper Advice API response (Return):", {
        status: getAdviceResponse.status,
        data: getAdviceData,
        trackingNumber: review.tracking_number,
      });
    } catch (e) {
      console.error("Get Shipper Advice API returned non-JSON:", getAdviceText);
    }

     // Update database with return request info
     const now = new Date().toISOString();
     await (supabase as any)
       .from("delivery_reviews")
       .update({
         final_outcome: "return_requested",
         courier_action: "return_requested",
         notes: `Return advice sent to PostEx. Remarks: ${remarks}`,
         updated_at: now,
       })
       .eq("id", deliveryReviewId);

    return {
      success: true,
      message: "Return requested successfully",
      postexResponse: postexData,
    };
  } catch (error) {
    console.error("Exception in requestReturn:", error);
    return {
      success: false,
      message: "An error occurred while processing the return request",
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    };
  }
}
