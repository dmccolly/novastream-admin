import axios from 'axios';

// Use relative path so Vite proxy handles the connection to localhost:3001
const API_URL = '/api';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  type: string | null;
  color: string | null;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  category?: string;
  category_id?: number;
  subcategory_id?: number;
  category_name?: string;
  subcategory_name?: string;
  cue_out?: number; // Segue point in seconds
  cue_in?: number; // Start point in seconds
  segue_duration?: number; // Crossfade duration in seconds
  mood?: string;
  tags?: string[] | string;   // backend stores JSON string, normalize on read
  format?: string;
  isActive: boolean;
  isDownloaded: boolean;
  createdAt: number;
  status?: string;
  filepath?: string | null;
  source_url?: string;
  url?: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; }
    catch { return []; }
  }
  return [];
}

export const tracksApi = {
  getAll: async (params?: {
    search?: string;
    category?: string;
    status?: string;
    limit?: number;
    page?: number;
    offset?: number;
    tag?: string;
  }) => {
    const qs: Record<string, any> = { ...params, _t: Date.now() };
    if (params?.tag) qs['tag'] = params.tag;
    const response = await api.get<any>('/tracks', {
      params: qs
    });

    // Handle both old (array) and new (paginated object) formats
    if (Array.isArray(response.data)) {
      return {
        data: response.data,
        pagination: {
          total: response.data.length,
          limit: params?.limit || 50,
          offset: params?.offset || 0
        }
      };
    }

    return response.data;
  },

  getById: async (id: string) => {
    const response = await api.get<Track>(`/tracks/${id}`);
    return response.data;
  },

  update: async (id: string, data: Partial<Track>) => {
    const response = await api.put<Track>(`/tracks/${id}`, data);
    return response.data;
  },

  delete: async (id: string) => {
    await api.delete(`/tracks/${id}`);
  },

  download: async (id: string) => {
    await api.post(`/tracks/${id}/download`);
  },

  sync: async (syncType: 'full' | 'incremental' = 'incremental') => {
    const response = await api.post('/tracks/sync', { syncType });
    return response.data;
  },

  getStats: async () => {
    const response = await api.get('/tracks/stats');
    return response.data;
  },

  getPreviewUrl: async (id: string): Promise<string> => {
    const response = await api.get<{ url: string }>(`/tracks/${id}/preview`);
    return response.data.url;
  },

  updateCuePoints: async (id: string, cuePoints: {
    cueIn: number;
    cueOut: number;
    segueDuration: number
  }) => {
    const response = await api.patch<Track>(`/tracks/${id}/cuepoints`, cuePoints);
    return response.data;
  },

  batchUpdateCuePoints: async (payload: {
    trackIds?: string[];
    cueIn?: number;
    cueOut?: number;
    segueDuration?: number;
  }) => {
    const response = await api.patch<{ updated: number; total: number }>(
      '/tracks/batch/cuepoints',
      payload
    );
    return response.data;
  },

  batch: async (
    ids: (string | number)[] | "all",
    action:
      | "setCategory"
      | "setSubcategory"
      | "addTag"
      | "removeTag"
      | "clearTags"
      | "delete",
    value?: any,
    filter?: { search?: string; category?: string; status?: string }
  ) => {
    const res = await fetch("/api/tracks/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action, value, filter }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Batch failed");
    return res.json();
  },
};

export const categoriesApi = {
  getAll: async () => {
    const response = await api.get<Category[]>('/categories');
    return response.data;
  },
  create: async (data: {
    name: string;
    parent_id?: number | null;
    type?: string | null;
    color?: string | null;
  }) => {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Create failed");
    return res.json() as Promise<Category>;
  },
  update: async (
    id: number | string,
    data: Partial<{ name: string; color: string | null; type: string | null; parent_id: number | null }>
  ) => {
    const res = await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Update failed");
    return res.json() as Promise<Category>;
  },
  usage: async (id: number | string) => {
    const res = await fetch(`/api/categories/${id}/usage`);
    if (!res.ok) throw new Error((await res.json()).error || "Failed");
    return res.json() as Promise<{
      category: Category;
      trackCount: number;
      childCount: number;
      clockItemCount: number;
    }>;
  },
  delete: async (id: number | string, moveTo?: number | string | null) => {
    const qs = moveTo ? `?moveTo=${moveTo}` : "";
    const res = await fetch(`/api/categories/${id}${qs}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
    return res.json();
  },
};

export const tagsApi = {
  getAll: async (): Promise<string[]> => {
    const res = await fetch("/api/tags");
    if (!res.ok) throw new Error("Failed to fetch tags");
    return res.json();
  },
};

export const clocksApi = {
  getAll: async () => {
    const response = await api.get('/clocks');
    return response.data;
  },
  getById: async (id: number) => {
    const response = await api.get(`/clocks/${id}`);
    return response.data;
  },
  create: async (data: { name: string; color: string }) => {
    const response = await api.post('/clocks', data);
    return response.data;
  },
  updateItems: async (id: number, items: any[]) => {
    const response = await api.post(`/clocks/${id}/items`, { items });
    return response.data;
  },
  delete: async (id: number) => {
    await api.delete(`/clocks/${id}`);
  }
};

export const scheduleApi = {
  getGrid: async () => {
    const response = await api.get('/schedule/grid');
    return response.data;
  },
  updateGrid: async (assignments: any[]) => {
    const response = await api.post('/schedule/grid', { assignments });
    return response.data;
  },
  generatePreview: async (clockId: number) => {
    const response = await api.post('/schedule/preview', { clock_id: clockId });
    return response.data;
  }
};

export const rulesApi = {
  getAll: async () => {
    const response = await api.get('/rules');
    return response.data;
  },
  save: async (data: any) => {
    const response = await api.post('/rules', data);
    return response.data;
  }
};
