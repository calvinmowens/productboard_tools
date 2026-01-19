import { action } from "./_generated/server";
import { v } from "convex/values";
import { sanitizeApiError, sanitizeCatchError } from "./utils/errorSanitizer";

const API_BASE_URL = "https://api.productboard.com";

function getHeaders(apiToken: string) {
  return {
    "accept": "application/json",
    "Authorization": `Bearer ${apiToken}`,
    "X-Version": "1",
  };
}

// Custom field types to fetch
const CUSTOM_FIELD_TYPES = ["number", "text", "dropdown", "date", "member", "multi_select"];

export const validateApiKey = action({
  args: { apiToken: v.string() },
  handler: async (_, { apiToken }) => {
    try {
      // Just try to fetch one type to validate the API key
      const response = await fetch(`${API_BASE_URL}/hierarchy-entities/custom-fields?type=number`, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (response.ok) {
        return { valid: true, error: null };
      } else {
        const errorText = await response.text();
        return { valid: false, error: sanitizeApiError(response.status, errorText, "validateApiKey") };
      }
    } catch (error) {
      return { valid: false, error: sanitizeCatchError(error, "validateApiKey") };
    }
  },
});

export const listCustomFields = action({
  args: { apiToken: v.string() },
  handler: async (_, { apiToken }) => {
    try {
      // Fetch each field type separately and combine results
      const allFields: any[] = [];

      for (const fieldType of CUSTOM_FIELD_TYPES) {
        try {
          const response = await fetch(`${API_BASE_URL}/hierarchy-entities/custom-fields?type=${fieldType}`, {
            method: "GET",
            headers: getHeaders(apiToken),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.data) {
              allFields.push(...data.data);
            }
          }
        } catch {
          // Continue with other types if one fails
          console.error(`Failed to fetch ${fieldType} fields`);
        }
      }

      return { success: true, data: allFields };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "listCustomFields"), data: [] };
    }
  },
});

export const listFeatures = action({
  args: { apiToken: v.string(), pageToken: v.optional(v.string()) },
  handler: async (_, { apiToken, pageToken }) => {
    try {
      let url = `${API_BASE_URL}/features`;
      if (pageToken) {
        url += `?pageCursor=${pageToken}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "listFeatures"), data: [], nextPage: null };
      }

      const data = await response.json();
      return {
        success: true,
        data: data.data || [],
        nextPage: data.links?.next || null,
      };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "listFeatures"), data: [], nextPage: null };
    }
  },
});

export const getCustomFieldValue = action({
  args: {
    apiToken: v.string(),
    customFieldId: v.string(),
    featureId: v.string(),
  },
  handler: async (_, { apiToken, customFieldId, featureId }) => {
    try {
      const url = `${API_BASE_URL}/hierarchy-entities/custom-fields-values/value?customField.id=${customFieldId}&hierarchyEntity.id=${featureId}`;

      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: true, value: null, hasValue: false };
        }
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "getCustomFieldValue"), value: null, hasValue: false };
      }

      const data = await response.json();
      const value = data.data?.value;
      return { success: true, value, hasValue: value !== null && value !== undefined };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "getCustomFieldValue"), value: null, hasValue: false };
    }
  },
});

export const setCustomFieldValue = action({
  args: {
    apiToken: v.string(),
    customFieldId: v.string(),
    featureId: v.string(),
    value: v.any(),
    fieldType: v.string(),
  },
  handler: async (_, { apiToken, customFieldId, featureId, value, fieldType }) => {
    try {
      const url = `${API_BASE_URL}/hierarchy-entities/custom-fields-values/value?customField.id=${customFieldId}&hierarchyEntity.id=${featureId}`;

      const payload = {
        data: {
          type: fieldType,
          value: value,
        },
      };

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          ...getHeaders(apiToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "setCustomFieldValue"), response: null };
      }

      const responseText = await response.text();
      return { success: true, response: responseText };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "setCustomFieldValue"), response: null };
    }
  },
});

export const getBatchCustomFieldValues = action({
  args: {
    apiToken: v.string(),
    customFieldId: v.string(),
    featureIds: v.array(v.string()),
  },
  handler: async (_, { apiToken, customFieldId, featureIds }) => {
    const results: Record<string, { value: any; hasValue: boolean }> = {};

    // Process in batches of 10 to avoid rate limiting
    const batchSize = 10;
    for (let i = 0; i < featureIds.length; i += batchSize) {
      const batch = featureIds.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (featureId) => {
          try {
            const url = `${API_BASE_URL}/hierarchy-entities/custom-fields-values/value?customField.id=${customFieldId}&hierarchyEntity.id=${featureId}`;

            const response = await fetch(url, {
              method: "GET",
              headers: getHeaders(apiToken),
            });

            if (!response.ok) {
              if (response.status === 404) {
                results[featureId] = { value: null, hasValue: false };
                return;
              }
              results[featureId] = { value: null, hasValue: false };
              return;
            }

            const data = await response.json();
            const value = data.data?.value;
            results[featureId] = { value, hasValue: value !== null && value !== undefined };
          } catch {
            results[featureId] = { value: null, hasValue: false };
          }
        })
      );

      // Small delay between batches
      if (i + batchSize < featureIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return { success: true, results };
  },
});

// ============================================
// Notes API Actions
// ============================================

export const listNotes = action({
  args: { apiToken: v.string(), pageCursor: v.optional(v.string()) },
  handler: async (_, { apiToken, pageCursor }) => {
    try {
      let url = `${API_BASE_URL}/notes?pageLimit=2000`;
      if (pageCursor) {
        url += `&pageCursor=${pageCursor}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "listNotes"), data: [], nextCursor: null };
      }

      const data = await response.json();
      return {
        success: true,
        data: data.data || [],
        nextCursor: data.pageCursor || null,
      };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "listNotes"), data: [], nextCursor: null };
    }
  },
});

export const listCompanies = action({
  args: { apiToken: v.string(), nextUrl: v.optional(v.string()) },
  handler: async (_, { apiToken, nextUrl }) => {
    try {
      const url = nextUrl || `${API_BASE_URL}/companies?pageLimit=100`;

      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "listCompanies"), data: [], nextUrl: null };
      }

      const data = await response.json();
      return {
        success: true,
        data: data.data || [],
        nextUrl: data.links?.next || null,
      };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "listCompanies"), data: [], nextUrl: null };
    }
  },
});

export const deleteNote = action({
  args: { apiToken: v.string(), noteId: v.string() },
  handler: async (_, { apiToken, noteId }) => {
    try {
      const url = `${API_BASE_URL}/notes/${noteId}`;

      const response = await fetch(url, {
        method: "DELETE",
        headers: getHeaders(apiToken),
      });

      // 204 = success, 404 = already deleted (still success)
      if (response.status === 204 || response.status === 404) {
        return { success: true, status: response.status };
      }

      if (response.status === 429) {
        return { success: false, error: "Rate limit exceeded - please wait and retry", status: 429 };
      }

      const errorText = await response.text();
      return { success: false, error: sanitizeApiError(response.status, errorText, "deleteNote"), status: response.status };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "deleteNote"), status: null };
    }
  },
});

export const createNote = action({
  args: {
    apiToken: v.string(),
    title: v.string(),
    content: v.string(),
    userEmail: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (_, { apiToken, title, content, userEmail, ownerEmail, tags }) => {
    const url = `${API_BASE_URL}/notes`;

    // Helper function to make the API request
    const makeRequest = async (includeOwner: boolean) => {
      const body: Record<string, unknown> = { title, content };

      if (userEmail) {
        body.user = { email: userEmail };
      }
      if (includeOwner && ownerEmail) {
        body.owner = { email: ownerEmail };
      }
      if (tags && tags.length > 0) {
        body.tags = tags;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...getHeaders(apiToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      return response;
    };

    try {
      // First attempt: with owner if provided
      let response = await makeRequest(true);

      // If it failed and we had an owner, check if it's an owner-related error
      if (!response.ok && ownerEmail) {
        const errorText = await response.text();
        const errorLower = errorText.toLowerCase();

        // Check if error is related to owner (e.g., owner not found in workspace)
        const isOwnerError = errorLower.includes('owner') ||
                            errorLower.includes('member') ||
                            (response.status === 400 && errorLower.includes('user'));

        if (isOwnerError) {
          // Retry without owner
          response = await makeRequest(false);

          if (!response.ok) {
            const retryErrorText = await response.text();
            return { success: false, error: sanitizeApiError(response.status, retryErrorText, "createNote"), data: null, createdWithoutOwner: false };
          }

          const data = await response.json();
          return { success: true, data: data.data || data, error: null, createdWithoutOwner: true };
        }

        // Not an owner error, return original error
        return { success: false, error: sanitizeApiError(response.status, errorText, "createNote"), data: null, createdWithoutOwner: false };
      }

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "createNote"), data: null, createdWithoutOwner: false };
      }

      const data = await response.json();
      return { success: true, data: data.data || data, error: null, createdWithoutOwner: false };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "createNote"), data: null, createdWithoutOwner: false };
    }
  },
});

// ============================================
// Feature API Actions (for CSV Bulk Update)
// ============================================

export const getFeature = action({
  args: { apiToken: v.string(), featureId: v.string() },
  handler: async (_, { apiToken, featureId }) => {
    try {
      const url = `${API_BASE_URL}/features/${featureId}`;

      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: false, error: "Feature not found", data: null };
        }
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "getFeature"), data: null };
      }

      const data = await response.json();
      return { success: true, data: data.data || data, error: null };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "getFeature"), data: null };
    }
  },
});

export const updateFeatureCustomFields = action({
  args: {
    apiToken: v.string(),
    featureId: v.string(),
    customFields: v.array(v.object({
      fieldId: v.string(),
      fieldType: v.string(),
      value: v.any(),
    })),
  },
  handler: async (_, { apiToken, featureId, customFields }) => {
    const errors: string[] = [];

    // Update each custom field using the custom-fields-values endpoint
    for (const field of customFields) {
      try {
        const url = `${API_BASE_URL}/hierarchy-entities/custom-fields-values/value?customField.id=${field.fieldId}&hierarchyEntity.id=${featureId}`;

        const payload = {
          data: {
            type: field.fieldType,
            value: field.value,
          },
        };

        const response = await fetch(url, {
          method: "PUT",
          headers: {
            ...getHeaders(apiToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          // Log full error server-side, return sanitized version
          console.error(`[updateFeatureCustomFields] Field ${field.fieldId}: ${response.status} - ${errorText}`);
          errors.push(`Field update failed: ${sanitizeApiError(response.status, errorText, "updateFeatureCustomFields")}`);
        }
      } catch (error) {
        errors.push(`Field update failed: ${sanitizeCatchError(error, "updateFeatureCustomFields")}`);
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: errors.join('; '),
        featureName: null,
      };
    }

    return {
      success: true,
      featureName: null,
      error: null,
    };
  },
});
