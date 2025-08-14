import { format } from "date-fns";

// API token configuration with date threshold
export const POSTEX_API_CONFIG = {
  OLD_TOKEN: "OTMxNzA0NTRhN2E3NGQ4MzkxMDE3YjdmYjEwNzZkM2U6NDYyNGZlMTZhNGRhNDY0NTg4YzhmZDc5OWVkYjEyMDI=",
  NEW_TOKEN: "YzliM2RhY2M4MGUzNDNhNGE3NDY5NmRiOTYyMzFmMWQ6MWVkMWYxMmY3MmZkNDk2YjgzZWQ0ZGNmMzNhNmNmYTI=",
  CUTOFF_DATE: "2025-08-11",
  NEW_START_DATE: "2025-08-13",
};

const extractDate = (value?: string): string => {
  if (!value) return "";
  return value.slice(0, 10); // safe even if shorter
};

/**
 * Determine which Postex API token to use based on order dispatch date
 * @param dispatchDate The order's dispatch date (YYYY-MM-DD format)
 * @returns The appropriate Postex API token
 */
export const getPostexApiToken = (dispatchDate: string): string => {
  const d = extractDate(dispatchDate);
  if (!d) return POSTEX_API_CONFIG.NEW_TOKEN;
  if (d <= POSTEX_API_CONFIG.CUTOFF_DATE) return POSTEX_API_CONFIG.OLD_TOKEN;
  return POSTEX_API_CONFIG.NEW_TOKEN;
};

/**
 * Make API call to Postex with the appropriate token
 * @param url The API endpoint URL
 * @param dispatchDate The order's dispatch date (for token selection)
 * @returns Response from the API
 */
export const callPostexApi = async (url: string, dispatchDate?: string): Promise<Response> => {
  const token = dispatchDate ? getPostexApiToken(dispatchDate) : POSTEX_API_CONFIG.NEW_TOKEN;
  return fetch(url, {
    method: 'GET',
    headers: {
      token,
      Accept: 'application/json'
    }
  });
};

/**
 * Fetch order details from PostEx API
 * @param trackingNumber The tracking number to look up
 * @param dispatchDate Optional dispatch date to determine token (if known)
 */
export const fetchOrderDetails = async (trackingNumber: string, dispatchDate?: string): Promise<any> => {
  try {
    const normalized = dispatchDate ? dispatchDate.slice(0,10) : undefined;
    console.log(`Fetching ${trackingNumber} (dispatch: ${normalized || 'N/A'}) -> token: ${normalized && normalized <= POSTEX_API_CONFIG.CUTOFF_DATE ? 'OLD' : 'NEW'}`);
    const apiUrl = `https://api.postex.pk/services/integration/api/order/v1/track-order/${trackingNumber}`;
    const response = await callPostexApi(apiUrl, normalized);
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`PostEx error ${response.status}: ${errorText}`);
      return null;
    }
    return await response.json();
  } catch (e) {
    console.error(`Fetch error ${trackingNumber}`, e);
    return null;
  }
};


