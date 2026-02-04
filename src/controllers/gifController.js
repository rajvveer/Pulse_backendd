const axios = require('axios');

const TENOR_API_KEY = process.env.TENOR_API_KEY || "AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ"
const TENOR_CLIENT_KEY = process.env.TENOR_CLIENT_KEY || 'pulse_app';
const TENOR_BASE_URL = 'https://tenor.googleapis.com/v2';

// Search GIFs
exports.searchGifs = async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;

    if (!q || !q.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const response = await axios.get(`${TENOR_BASE_URL}/search`, {
      params: {
        q: q.trim(),
        key: TENOR_API_KEY,
        client_key: TENOR_CLIENT_KEY,
        limit: parseInt(limit),
        media_filter: 'gif,tinygif',
        contentfilter: 'medium',
      },
    });

    const gifs = response.data.results.map(gif => ({
      id: gif.id,
      url: gif.media_formats?.gif?.url || '',
      preview: gif.media_formats?.tinygif?.url || gif.media_formats?.gif?.url || '',
      width: gif.media_formats?.gif?.dims?.[0] || 200,
      height: gif.media_formats?.gif?.dims?.[1] || 200,
      description: gif.content_description || ''
    }));

    res.json({
      success: true,
      data: gifs,
      count: gifs.length
    });

  } catch (error) {
    console.error('Tenor search error:', error?.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to search GIFs'
    });
  }
};

// Get trending/featured GIFs
exports.getTrendingGifs = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const response = await axios.get(`${TENOR_BASE_URL}/featured`, {
      params: {
        key: TENOR_API_KEY,
        client_key: TENOR_CLIENT_KEY,
        limit: parseInt(limit),
        media_filter: 'gif,tinygif',
        contentfilter: 'medium',
      },
    });

    const gifs = response.data.results.map(gif => ({
      id: gif.id,
      url: gif.media_formats?.gif?.url || '',
      preview: gif.media_formats?.tinygif?.url || gif.media_formats?.gif?.url || '',
      width: gif.media_formats?.gif?.dims?.[0] || 200,
      height: gif.media_formats?.gif?.dims?.[1] || 200,
      description: gif.content_description || ''
    }));

    res.json({
      success: true,
      data: gifs,
      count: gifs.length
    });

  } catch (error) {
    console.error('Tenor trending error:', error?.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trending GIFs'
    });
  }
};

// Get GIF categories
exports.getCategories = async (req, res) => {
  try {
    const response = await axios.get(`${TENOR_BASE_URL}/categories`, {
      params: {
        key: TENOR_API_KEY,
        client_key: TENOR_CLIENT_KEY,
      },
    });

    res.json({
      success: true,
      data: response.data.tags || []
    });

  } catch (error) {
    console.error('Tenor categories error:', error?.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
};
