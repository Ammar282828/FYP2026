import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default {
  searchArticles: async (keyword: string, params: any = {}) => {
    const response = await api.get('/api/search/articles', {
      params: { keyword, ...params }
    });
    return response.data;
  },

  getArticles: async (params: any = {}) => {
    const response = await api.get('/api/articles', { params });
    return response.data;
  },

  getArticleDetail: async (articleId: string) => {
    const response = await api.get(`/api/articles/${articleId}`);
    return response.data;
  },

  getArticleNewspaperImage: async (articleId: string) => {
    const response = await api.get(`/api/articles/${articleId}/newspaper-image`);
    return response.data;
  },

  getNewspaperImageUrl: (newspaperId: string) => {
    return `${API_BASE_URL}/api/newspapers/${newspaperId}/image`;
  },

  searchEntities: async (entityText: string) => {
    const response = await api.get('/api/search/entities', {
      params: { entity_text: entityText }
    });
    return response.data;
  },

  getTopEntities: async (type?: string, limit = 10, startDate?: string, endDate?: string) => {
    const response = await api.get('/api/analytics/top-entities-fixed', {
      params: {
        entity_type: type,
        limit,
        start_date: startDate,
        end_date: endDate
      }
    });
    return response.data;
  },

  getSentimentOverview: async () => {
    const response = await api.get('/api/analytics/sentiment-fixed');
    return response.data;
  },

  getKeywordTrend: async (keyword: string, startDate?: string, endDate?: string) => {
    const response = await api.get('/api/analytics/keyword-trend', {
      params: { keyword, start_date: startDate, end_date: endDate }
    });
    return response.data;
  },

  getKeywordSuggestions: async (limit = 20) => {
    const response = await api.get('/api/suggestions/keywords', {
      params: { limit }
    });
    return response.data;
  },

  deleteArticle: async (articleId: string) => {
    const response = await api.delete(`/api/articles/${articleId}`);
    return response.data;
  },

  deleteNewspaper: async (newspaperId: string) => {
    const response = await api.delete(`/api/newspapers/${newspaperId}`);
    return response.data;
  },

  generateAISummary: async (startDate: string, endDate: string, topic?: string) => {
    const response = await api.post('/api/analytics/ai-summary', {
      start_date: startDate,
      end_date: endDate,
      topic: topic || undefined
    });
    return response.data;
  }
};
