import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  category?: string;
  mood?: string;
  tags?: string[];
  format?: string;
  isActive: boolean;
  isDownloaded: boolean;
  createdAt: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export const tracksApi = {
  getAll: async (params?: { 
    search?: string; 
    category?: string; 
    limit?: number; 
    offset?: number 
  }) => {
    const response = await api.get<PaginatedResponse<Track>>('/tracks', { 
      params: { ...params, _t: Date.now() } 
    });
    return response.data;
  },

  getById: async (id: string) => {
    const response = await api.get<Track>(`/tracks/${id}`);
    return response.data;
  },

  update: async (id: string, data: Partial<Track>) => {
    const response = await api.patch<Track>(`/tracks/${id}`, data);
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
};
