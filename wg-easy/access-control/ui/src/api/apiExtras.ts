import { ACCESS_CONTROL_API_URL } from "../lib/queryClient";

/**
 * Override the base URL for API requests
 * This allows dynamic configuration at runtime
 */
export const getBaseUrl = (): string => {
  return ACCESS_CONTROL_API_URL;
};
