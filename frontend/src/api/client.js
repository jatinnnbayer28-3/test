/**
 * Central API client for all backend communication.
 *
 * Features:
 * - Attaches Google ID token as Bearer auth on every request
 * - Logs requests in development mode
 * - Normalizes error responses into standard Error objects
 * - Handles 401 by clearing auth and redirecting to login
 */

import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
const AUTH_STORAGE_KEY = 'wardrobeai_auth';

const api = axios.create({
  baseURL: BACKEND_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  // Attach auth token from localStorage to every request
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      const { token } = JSON.parse(stored);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  } catch {
    // Ignore parse errors
  }

  if (import.meta.env.DEV) {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;

    // On 401, clear auth and redirect to login
    if (status === 401) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    const message =
      err.response?.data?.detail || err.message || 'Something went wrong';
    const error = new Error(message);
    error.status = status;
    throw error;
  }
);

export async function uploadBatch(userId, files, wearPositions = []) {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  if (wearPositions.length > 0) {
    formData.append('wear_positions', JSON.stringify(wearPositions));
  }
  const res = await api.post(`/api/wardrobe/upload-batch/${userId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export function processWardrobe(userId, onEvent) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`${BACKEND_URL}/api/wardrobe/process/${userId}`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onEvent(data);
        if (data.status === 'complete' || data.message === 'nothing to process') {
          es.close();
          resolve(data);
        }
      } catch (e) {
        console.error('SSE parse error', e);
      }
    };
    es.onerror = (err) => {
      es.close();
      reject(new Error('SSE connection failed'));
    };
  });
}

export async function getWardrobe(userId) {
  const res = await api.get(`/api/wardrobe/${userId}`);
  return res.data;
}

export async function patchClothing(userId, itemId, updates) {
  const res = await api.patch(`/api/wardrobe/${userId}/${itemId}`, updates);
  return res.data;
}

export async function deleteClothing(userId, itemId) {
  const res = await api.delete(`/api/wardrobe/${userId}/${itemId}`);
  return res.data;
}

export async function saveCalendarDay(userId, date, data, lat, lng) {
  const params = {};
  if (lat != null && lng != null) {
    params.lat = lat;
    params.lng = lng;
  }
  const res = await api.post(`/api/calendar/${userId}/${date}`, data, { params });
  return res.data;
}

export async function getWeekCalendar(userId, startDate) {
  const params = {};
  if (startDate) params.start_date = startDate;
  const res = await api.get(`/api/calendar/${userId}/week`, { params });
  return res.data;
}

export async function deleteCalendarDay(userId, date) {
  const res = await api.delete(`/api/calendar/${userId}/${date}`);
  return res.data;
}

export async function setLocation(userId, lat, lng) {
  const res = await api.post(`/api/location/${userId}`, { lat, lng });
  return res.data;
}

export async function getLocation(userId) {
  const res = await api.get(`/api/location/${userId}`);
  return res.data;
}

export async function generateOutfits(userId, date, avatarProfile, forceRegenerate) {
  const params = {};
  if (forceRegenerate) params.force_regenerate = true;
  const body = avatarProfile ? { avatar_profile: avatarProfile } : {};
  const res = await api.post(`/api/recommendations/${userId}/${date}`, body, { params });
  return res.data;
}

export async function generateWeekOutfits(userId, startDate, forceRegenerate = false) {
  const params = {};
  if (startDate) params.start_date = startDate;
  if (forceRegenerate) params.force_regenerate = true;
  const res = await api.post(`/api/recommendations/${userId}/week`, {}, { params, timeout: 300000 });
  return res.data;
}

export async function getOutfits(userId, date) {
  const res = await api.get(`/api/recommendations/${userId}/${date}`);
  return res.data;
}

export async function confirmOutfit(userId, date, wornItemIds, recommendationId) {
  const res = await api.post(`/api/history/${userId}/${date}`, {
    worn_item_ids: wornItemIds,
    recommendation_id: recommendationId,
  });
  return res.data;
}

export async function submitFeedback(userId, date, feedback, tags) {
  const res = await api.post(`/api/feedback/${userId}/${date}`, {
    feedback,
    tags,
  });
  return res.data;
}

export async function getHistory(userId, days = 30) {
  const res = await api.get(`/api/history/${userId}`, { params: { days } });
  return res.data;
}

export async function getWearStats(userId, days = 36500) {
  const res = await api.get(`/api/stats/${userId}`, { params: { days } });
  return res.data;
}

export async function createAvatar(userId, file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post(`/api/avatar/${userId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return res.data;
}

export async function getAvatar(userId) {
  const res = await api.get(`/api/avatar/${userId}`);
  return res.data;
}

export async function tryOnOutfit(userId, upperItemId, lowerItemId, shoesItemId) {
  const res = await api.post(`/api/tryon/${userId}`, {
    upper_item_id: upperItemId,
    lower_item_id: lowerItemId,
    shoes_item_id: shoesItemId,
  }, { timeout: 180000 });
  return res.data;
}

export async function analyseOutfit(userId, imageFile, categories) {
  const formData = new FormData();
  formData.append('file', imageFile);
  formData.append('categories', categories.join(','));
  const res = await api.post(`/api/recommendations/${userId}/analyse-outfit`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return res.data;
}

export async function getShoppingSuggestions(userId, categories) {
  const res = await api.post(`/api/recommendations/${userId}/shopping-suggestions`, {
    categories,
  }, { timeout: 120000 });
  return res.data;
}
