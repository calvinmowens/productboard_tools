import { action } from "./_generated/server";
import { v } from "convex/values";
import { sanitizeApiError, sanitizeCatchError } from "./utils/errorSanitizer";

const API_BASE_URL = "https://api.productboard.com/v2";

function getHeaders(apiToken: string) {
  return {
    "accept": "application/json",
    "Authorization": `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
}

// Entity types supported by the V2 API
export const ENTITY_TYPES = [
  "product",
  "component",
  "feature",
  "subfeature",
  "initiative",
  "objective",
  "keyResult",
  "release",
  "releaseGroup",
] as const;

// Valid parent types for each entity type
export const PARENT_TYPE_MAP: Record<string, string[]> = {
  product: [],
  component: ["product"],
  feature: ["product", "component"],
  subfeature: ["feature"],
  initiative: [],
  objective: ["initiative"],
  keyResult: ["objective"],
  release: ["releaseGroup"],
  releaseGroup: [],
};

export const validateApiKeyV2 = action({
  args: { apiToken: v.string() },
  handler: async (_, { apiToken }) => {
    try {
      // Try to fetch entity configurations to validate the API key
      const response = await fetch(`${API_BASE_URL}/entities/configurations`, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (response.ok) {
        return { valid: true, error: null };
      } else {
        const errorText = await response.text();
        return { valid: false, error: sanitizeApiError(response.status, errorText, "validateApiKeyV2") };
      }
    } catch (error) {
      return { valid: false, error: sanitizeCatchError(error, "validateApiKeyV2") };
    }
  },
});

export const getEntityConfiguration = action({
  args: { apiToken: v.string(), entityType: v.string() },
  handler: async (_, { apiToken, entityType }) => {
    try {
      const response = await fetch(`${API_BASE_URL}/entities/configurations/${entityType}`, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "getEntityConfiguration"), data: null };
      }

      const data = await response.json();
      return { success: true, data: data.data || data };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "getEntityConfiguration"), data: null };
    }
  },
});

export const listEntities = action({
  args: {
    apiToken: v.string(),
    entityType: v.string(),
    filter: v.optional(v.string()),
    pageToken: v.optional(v.string()),
  },
  handler: async (_, { apiToken, entityType, filter, pageToken }) => {
    try {
      let url = `${API_BASE_URL}/entities?type=${entityType}`;
      if (filter) {
        url += `&filter=${encodeURIComponent(filter)}`;
      }
      if (pageToken) {
        url += `&pageToken=${pageToken}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "listEntities"), data: [], nextPageToken: null };
      }

      const data = await response.json();
      return {
        success: true,
        data: data.data || [],
        nextPageToken: data.links?.next ? new URL(data.links.next).searchParams.get('pageToken') : null,
      };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "listEntities"), data: [], nextPageToken: null };
    }
  },
});

export const searchEntityByName = action({
  args: {
    apiToken: v.string(),
    entityType: v.string(),
    name: v.string(),
  },
  handler: async (_, { apiToken, entityType, name }) => {
    try {
      // Use filter to search by name
      const url = `${API_BASE_URL}/entities?type=${entityType}&filter=name:${encodeURIComponent(name)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "searchEntityByName"), entity: null, allMatches: [] };
      }

      const data = await response.json();
      const entities = data.data || [];

      // Find exact match
      const exactMatch = entities.find((e: any) =>
        e.fields?.name?.toLowerCase() === name.toLowerCase()
      );

      return {
        success: true,
        entity: exactMatch || null,
        allMatches: entities,
      };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "searchEntityByName"), entity: null, allMatches: [] };
    }
  },
});

export const createEntity = action({
  args: {
    apiToken: v.string(),
    entityType: v.string(),
    fields: v.any(),
    parentId: v.optional(v.string()),
  },
  handler: async (_, { apiToken, entityType, fields, parentId }) => {
    try {
      const payload: any = {
        data: {
          type: entityType,
          fields: fields,
        },
      };

      // Add parent relationship if provided
      if (parentId) {
        payload.data.relationships = [
          {
            type: "parent",
            target: { id: parentId },
          },
        ];
      }

      const response = await fetch(`${API_BASE_URL}/entities`, {
        method: "POST",
        headers: getHeaders(apiToken),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: sanitizeApiError(response.status, errorText, "createEntity"), entity: null, response: null };
      }

      const responseText = await response.text();
      const data = JSON.parse(responseText);
      return { success: true, entity: data.data, response: responseText };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "createEntity"), entity: null, response: null };
    }
  },
});

export const deleteEntity = action({
  args: { apiToken: v.string(), entityId: v.string() },
  handler: async (_, { apiToken, entityId }) => {
    try {
      const response = await fetch(`${API_BASE_URL}/entities/${entityId}`, {
        method: "DELETE",
        headers: getHeaders(apiToken),
      });

      // 204 = success, 404 = already deleted
      if (response.status === 204 || response.status === 404) {
        return { success: true, status: response.status };
      }

      const errorText = await response.text();
      return { success: false, error: sanitizeApiError(response.status, errorText, "deleteEntity"), status: response.status };
    } catch (error) {
      return { success: false, error: sanitizeCatchError(error, "deleteEntity"), status: null };
    }
  },
});

// Batch search for parent entities by name
export const batchSearchParents = action({
  args: {
    apiToken: v.string(),
    parentType: v.string(),
    names: v.array(v.string()),
  },
  handler: async (_, { apiToken, parentType, names }) => {
    const results: Record<string, { id: string; name: string } | null> = {};
    const uniqueNames = [...new Set(names)];

    // Fetch all entities of the parent type
    let allParents: any[] = [];
    let nextPageToken: string | null = null;

    do {
      let url = `${API_BASE_URL}/entities?type=${parentType}&pageLimit=100`;
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (!response.ok) break;

      const data = await response.json();
      allParents.push(...(data.data || []));
      nextPageToken = data.links?.next ? new URL(data.links.next).searchParams.get('pageToken') : null;
    } while (nextPageToken);

    // Map names to entities
    for (const name of uniqueNames) {
      const match = allParents.find((p: any) =>
        p.fields?.name?.toLowerCase() === name.toLowerCase()
      );
      results[name] = match ? { id: match.id, name: match.fields?.name } : null;
    }

    return { success: true, results };
  },
});

// Check for duplicate entities by name
export const checkDuplicates = action({
  args: {
    apiToken: v.string(),
    entityType: v.string(),
    names: v.array(v.string()),
  },
  handler: async (_, { apiToken, entityType, names }) => {
    const duplicates: Record<string, { id: string; name: string }[]> = {};
    const uniqueNames = [...new Set(names.map(n => n.toLowerCase()))];

    // Fetch all entities of the type
    let allEntities: any[] = [];
    let nextPageToken: string | null = null;

    do {
      let url = `${API_BASE_URL}/entities?type=${entityType}&pageLimit=100`;
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(apiToken),
      });

      if (!response.ok) break;

      const data = await response.json();
      allEntities.push(...(data.data || []));
      nextPageToken = data.links?.next ? new URL(data.links.next).searchParams.get('pageToken') : null;
    } while (nextPageToken);

    // Find duplicates
    for (const name of uniqueNames) {
      const matches = allEntities.filter((e: any) =>
        e.fields?.name?.toLowerCase() === name
      );
      if (matches.length > 0) {
        duplicates[name] = matches.map((m: any) => ({
          id: m.id,
          name: m.fields?.name,
        }));
      }
    }

    return { success: true, duplicates, existingCount: allEntities.length };
  },
});
