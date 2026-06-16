/**
 * Delivery Review / RTO Recovery Helper Functions
 * Handles detection, parsing, and management of attempted delivery cases
 */

/**
 * Attempt reason definition
 */
export interface AttemptReason {
  code: string;
  label: string;
  display: string;
  matchers: string[];
}

/**
 * PostEx status history entry
 */
export interface PostExStatusHistoryEntry {
  transactionStatusMessage: string;
  transactionStatusMessageCode: string;
  updatedAt: string;
}

/**
 * Parsed attempt match result
 */
export interface AttemptMatch extends AttemptReason {
  historyEntry: PostExStatusHistoryEntry;
}

/**
 * Normalized tracking response
 */
export interface NormalizedTrackingResponse {
  trackingNumber: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  orderRefNumber: string;
  orderDetail: string;
  orderPickupDate: string;
  transactionStatus: string;
  transactionStatusHistory: PostExStatusHistoryEntry[];
  transactionFee: number;
  transactionTax: number;
  reversalFee: number;
  reversalTax: number;
  cityName: string;
  transactionNotes: string;
  [key: string]: any;
}

/**
 * All possible attempt reason codes
 */
export const ATTEMPT_REASONS: AttemptReason[] = [
  {
    code: "RFD",
    label: "REFUSED TO RECEIVE",
    display: "RFD - Refused To Receive",
    matchers: ["RFD", "REFUSED TO RECEIVE"]
  },
  {
    code: "CNA",
    label: "CUSTOMER NOT AVAILABLE",
    display: "CNA - Customer Not Available",
    matchers: ["CNA", "CUSTOMER NOT AVAILABLE"]
  },
  {
    code: "ICA",
    label: "INCOMPLETE ADDRESS",
    display: "ICA - Incomplete Address",
    matchers: ["ICA", "INCOMPLETE ADDRESS"]
  },
  {
    code: "OPN",
    label: "CONSIGNEE WANTS TO OPEN PARCEL",
    display: "OPN - Consignee Wants To Open Parcel",
    matchers: ["OPN", "CONSIGNEE WANTS TO OPEN PARCEL", "WANTS TO OPEN PARCEL", "OPEN PARCEL"]
  },
  {
    code: "PNA",
    label: "PAYMENT NOT AVAILABLE",
    display: "PNA - Payment Not Available",
    matchers: ["PNA", "PAYMENT NOT AVAILABLE"]
  }
];

/**
 * Extract attempt reason code and label from a text string
 * @param text The text to parse (e.g., "Attempt Made: RFD(REFUSED TO RECEIVE)")
 * @returns The matching AttemptReason or null
 */
export function parseAttemptReason(text: string | null | undefined): AttemptReason | null {
  if (!text) return null;

  const normalized = String(text).toUpperCase();

  for (const reason of ATTEMPT_REASONS) {
    if (reason.matchers.some((matcher) => normalized.includes(matcher))) {
      return reason;
    }
  }

  return null;
}

/**
 * Get the latest entry from transaction status history
 * @param transactionStatusHistory Array of history entries
 * @returns The most recent entry or null
 */
export function getLatestStatusHistoryEntry(
  transactionStatusHistory: PostExStatusHistoryEntry[] | null | undefined
): PostExStatusHistoryEntry | null {
  if (!Array.isArray(transactionStatusHistory) || transactionStatusHistory.length === 0) {
    return null;
  }

  return transactionStatusHistory[transactionStatusHistory.length - 1];
}

/**
 * Detect all attempt reasons from transaction status history
 * Scans for code 0013 entries and extracts reason codes
 * @param trackingResponse The tracking response from PostEx
 * @returns Array of detected AttemptMatches
 */
export function detectAttemptReasonsFromStatusHistory(
  trackingResponse: NormalizedTrackingResponse | null | undefined
): AttemptMatch[] {
  if (!trackingResponse) return [];

  const history = trackingResponse.transactionStatusHistory;
  if (!Array.isArray(history)) return [];

  const matches: AttemptMatch[] = [];

  for (const entry of history) {
    const message = entry?.transactionStatusMessage || "";
    const code = entry?.transactionStatusMessageCode || "";

    // Check if this is an attempt entry (code 0013 or message contains ATTEMPT)
    const isAttemptEntry = code === "0013" || message.toUpperCase().includes("ATTEMPT MADE");

    if (!isAttemptEntry) continue;

    const reason = parseAttemptReason(message);

    if (reason) {
      matches.push({
        ...reason,
        historyEntry: entry
      });
    }
  }

  return matches;
}

/**
 * Fallback attempt reason detection from transactionStatus field
 * Use only if status history does not contain proper 0013 entries
 * @param trackingResponse The tracking response from PostEx
 * @returns The detected AttemptReason or null
 */
export function detectAttemptReasonFallback(
  trackingResponse: NormalizedTrackingResponse | null | undefined
): AttemptReason | null {
  if (!trackingResponse) return null;

  const candidates: string[] = [];

  if (trackingResponse.transactionStatus) {
    candidates.push(trackingResponse.transactionStatus);
  }

  if (Array.isArray(trackingResponse.transactionStatusHistory)) {
    for (const item of trackingResponse.transactionStatusHistory) {
      if (item?.transactionStatusMessage) {
        candidates.push(item.transactionStatusMessage);
      }
    }
  }

  // Check in reverse order (most recent first)
  for (const candidate of candidates.reverse()) {
    const reason = parseAttemptReason(candidate);
    if (reason) return reason;
  }

  return null;
}

/**
 * Check if a status represents a delivered order
 * @param status The transaction status
 * @param latestHistoryEntry The latest history entry
 * @returns true if order is delivered
 */
export function isDeliveredStatus(
  status: string | null | undefined,
  latestHistoryEntry: PostExStatusHistoryEntry | null | undefined
): boolean {
  const normalizedStatus = String(status || "").toUpperCase();
  const historyCode = latestHistoryEntry?.transactionStatusMessageCode;
  const historyMessage = String(latestHistoryEntry?.transactionStatusMessage || "").toUpperCase();

  return (
    normalizedStatus.includes("DELIVERED") ||
    historyCode === "0005" ||
    historyMessage.includes("DELIVERED")
  );
}

/**
 * Check if a status represents a returned order
 * Only returns true for actual RETURNED status, not interim return statuses
 * @param status The transaction status
 * @param latestHistoryEntry The latest history entry
 * @returns true if order is actually returned
 */
export function isReturnedStatus(
  status: string | null | undefined,
  latestHistoryEntry: PostExStatusHistoryEntry | null | undefined
): boolean {
  const normalizedStatus = String(status || "").toUpperCase();
  const historyCode = latestHistoryEntry?.transactionStatusMessageCode;
  const historyMessage = String(latestHistoryEntry?.transactionStatusMessage || "").toUpperCase();

  return (
    normalizedStatus === "RETURNED" ||
    normalizedStatus.includes("RETURNED") ||
    historyCode === "0002" ||
    historyCode === "0006" ||
    historyCode === "0007" ||
    historyMessage === "RETURNED"
  );
}

/**
 * Normalize PostEx tracking responses from both bulk and single endpoints
 * Handles different response shapes from bulk vs single tracking APIs
 * @param apiResponse The raw API response
 * @returns Array of normalized tracking responses
 */
export function normalizePostexTrackingResponses(apiResponse: any): NormalizedTrackingResponse[] {
  if (!apiResponse) return [];

  // Handle bulk API response format
  if (Array.isArray(apiResponse.dist)) {
    return apiResponse.dist
      .map((item: any) => {
        // Bulk response wraps tracking data in trackingResponse property
        const trackingData = item.trackingResponse || item;
        return normalizeTrackingResponse(trackingData);
      })
      .filter((item: any) => item !== null);
  }

  // Handle single tracking API response format
  if (apiResponse.dist && typeof apiResponse.dist === "object" && !Array.isArray(apiResponse.dist)) {
    const normalized = normalizeTrackingResponse(apiResponse.dist);
    return normalized ? [normalized] : [];
  }

  return [];
}

/**
 * Normalize a single tracking response to standard format
 * @param trackingData The raw tracking data
 * @returns Normalized response or null if invalid
 */
function normalizeTrackingResponse(trackingData: any): NormalizedTrackingResponse | null {
  if (!trackingData) return null;

  return {
    trackingNumber: trackingData.trackingNumber || "",
    customerName: trackingData.customerName || "",
    customerPhone: trackingData.customerPhone || "",
    deliveryAddress: trackingData.deliveryAddress || "",
    orderRefNumber: trackingData.orderRefNumber || "",
    orderDetail: trackingData.orderDetail || "",
    orderPickupDate: trackingData.orderPickupDate || "",
    transactionStatus: trackingData.transactionStatus || "",
    transactionStatusHistory: Array.isArray(trackingData.transactionStatusHistory)
      ? trackingData.transactionStatusHistory
      : [],
    transactionFee: trackingData.transactionFee || 0,
    transactionTax: trackingData.transactionTax || 0,
    reversalFee: trackingData.reversalFee || 0,
    reversalTax: trackingData.reversalTax || 0,
    cityName: trackingData.cityName || "",
    transactionNotes: trackingData.transactionNotes || "",
    ...trackingData // Include all other fields
  };
}

/**
 * Format Pakistan phone number for WhatsApp
 * Converts various formats to international format (92XXXXXXXXXX)
 * @param phone The phone number to format
 * @returns Formatted phone number or empty string
 */
export function formatPakistanPhoneForWhatsApp(phone: string | null | undefined): string {
  if (!phone) return "";

  let cleaned = String(phone).replace(/\D/g, "");

  if (cleaned.startsWith("92")) {
    return cleaned;
  }

  if (cleaned.startsWith("0")) {
    return "92" + cleaned.slice(1);
  }

  if (cleaned.length === 10 && cleaned.startsWith("3")) {
    return "92" + cleaned;
  }

  return cleaned;
}

/**
 * Build WhatsApp message based on attempt reason
 * @param review The delivery review data
 * @returns The WhatsApp message text
 */
export function buildWhatsAppMessage(review: {
  customer_name?: string;
  order_ref_number?: string;
  order_detail?: string;
  review_reason_code?: string;
}): string {
  const name = review.customer_name || "Customer";
  const orderNo = review.order_ref_number || "";
  const detail = review.order_detail || "your order";

  switch (review.review_reason_code) {
    case "RFD":
      return `Hi ${name}, a delivery attempt was made for your AstroLamps order ${orderNo} (${detail}), but it was marked as refused to receive.\n\nCan you please confirm if you refused the parcel yourself, or if the rider did not contact/visit you?`;

    case "CNA":
      return `Hi ${name}, a delivery attempt was made for your AstroLamps order ${orderNo} (${detail}), but it was marked as customer not available.\n\nDo you still want to receive the order? If yes, please confirm your availability so we can request another delivery attempt.`;

    case "ICA":
      return `Hi ${name}, your AstroLamps order ${orderNo} (${detail}) could not be delivered because the address was marked incomplete.\n\nPlease share your complete address with house number, street, area, city, and nearest landmark so we can request delivery again.`;

    case "OPN":
      return `Hi ${name}, the rider marked your AstroLamps order ${orderNo} (${detail}) as customer wants to open parcel.\n\nCourier does not allow opening the parcel before payment, but your order has a warranty. Please confirm if we should request another delivery attempt.`;

    case "PNA":
      return `Hi ${name}, a delivery attempt was made for your AstroLamps order ${orderNo} (${detail}), but it was marked as payment not available.\n\nPlease confirm if you still want the order and have the payment ready so we can request another delivery attempt.`;

    default:
      return `Hi ${name}, there is an issue with the delivery attempt for your AstroLamps order ${orderNo} (${detail}).\n\nPlease confirm if you still want to receive the order so we can assist further.`;
  }
}

/**
 * Build WhatsApp URL for opening chat
 * @param review The delivery review data
 * @returns WhatsApp URL to open chat
 */
export function buildWhatsAppUrl(review: {
  customer_phone?: string;
  customer_name?: string;
  order_ref_number?: string;
  order_detail?: string;
  review_reason_code?: string;
}): string {
  const phone = formatPakistanPhoneForWhatsApp(review.customer_phone);
  const message = buildWhatsAppMessage(review);
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
