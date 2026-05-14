const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Pulse API',
      version: '1.0.0',
      description: 'Pulse — Hyperlocal Social Network API. Complete REST API documentation for authentication, posts, feeds, messaging, and social features.',
      contact: {
        name: 'Rajveer Shekhawat',
        email: 'rajveershekhawat626@gmail.com'
      },
      license: {
        name: 'ISC'
      }
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API v1'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token obtained from /auth/verify-otp or /auth/refresh-token'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string' },
            code: { type: 'string' }
          }
        },
        User: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            username: { type: 'string', example: 'rajveer' },
            profile: {
              type: 'object',
              properties: {
                displayName: { type: 'string' },
                bio: { type: 'string' },
                avatar: { type: 'string' },
                location: { type: 'string' }
              }
            },
            stats: {
              type: 'object',
              properties: {
                posts: { type: 'number' },
                followers: { type: 'number' },
                following: { type: 'number' }
              }
            },
            isVerified: { type: 'boolean' }
          }
        },
        Post: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            author: { $ref: '#/components/schemas/User' },
            content: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                media: { type: 'array', items: { type: 'object' } },
                hashtags: { type: 'array', items: { type: 'string' } }
              }
            },
            stats: {
              type: 'object',
              properties: {
                likes: { type: 'number' },
                comments: { type: 'number' },
                views: { type: 'number' }
              }
            },
            visibility: { type: 'string', enum: ['public', 'followers', 'private'] },
            isAnonymous: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    },
    tags: [
      { name: 'Auth', description: 'Authentication & session management' },
      { name: 'Users', description: 'User profiles & social relationships' },
      { name: 'Posts', description: 'Post CRUD & interactions' },
      { name: 'Feed', description: 'Personalized content feeds' },
      { name: 'Chat', description: 'Real-time messaging' },
      { name: 'Reels', description: 'Short-form video content' },
      { name: 'Notifications', description: 'Push & in-app notifications' }
    ],
    paths: {
      // ===== AUTH =====
      '/auth/initiate': {
        post: {
          tags: ['Auth'],
          summary: 'Initiate authentication (send OTP)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['method', 'identifier'],
                  properties: {
                    method: { type: 'string', enum: ['email', 'phone'], example: 'email' },
                    identifier: { type: 'string', example: 'user@example.com' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'OTP sent successfully' },
            400: { description: 'Invalid input' },
            429: { description: 'Rate limited' }
          }
        }
      },
      '/auth/verify-otp': {
        post: {
          tags: ['Auth'],
          summary: 'Verify OTP and authenticate',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['method', 'identifier', 'otp', 'deviceId'],
                  properties: {
                    method: { type: 'string', enum: ['email', 'phone'] },
                    identifier: { type: 'string' },
                    otp: { type: 'string', example: '123456' },
                    deviceId: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'Authentication successful — returns tokens or temp token for username creation' },
            400: { description: 'Invalid OTP or input' }
          }
        }
      },
      '/auth/create-username': {
        post: {
          tags: ['Auth'],
          summary: 'Create username for new users',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['tempToken', 'username', 'password', 'deviceId'],
                  properties: {
                    tempToken: { type: 'string' },
                    username: { type: 'string', example: 'cooluser' },
                    password: { type: 'string', minLength: 6 },
                    deviceId: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: 'User created — returns access & refresh tokens' },
            400: { description: 'Username taken or invalid' }
          }
        }
      },
      '/auth/refresh-token': {
        post: {
          tags: ['Auth'],
          summary: 'Refresh access token',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['refreshToken'],
                  properties: {
                    refreshToken: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'New tokens issued' },
            401: { description: 'Invalid or expired refresh token' }
          }
        }
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get current authenticated user',
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Current user data' },
            401: { description: 'Not authenticated' }
          }
        }
      },
      '/auth/firebase-login': {
        post: {
          tags: ['Auth'],
          summary: 'Login with Google (Firebase)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    idToken: { type: 'string' },
                    deviceId: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'Login successful' }
          }
        }
      },

      // ===== USERS =====
      '/users/me': {
        get: {
          tags: ['Users'],
          summary: 'Get current user profile with stats',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'User profile with auto-healed stats' } }
        },
        patch: {
          tags: ['Users'],
          summary: 'Update current user profile',
          security: [{ BearerAuth: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    'profile.displayName': { type: 'string' },
                    'profile.bio': { type: 'string' },
                    'profile.avatar': { type: 'string' },
                    'settings.theme': { type: 'string' }
                  }
                }
              }
            }
          },
          responses: { 200: { description: 'Updated user' } }
        }
      },
      '/users/{username}': {
        get: {
          tags: ['Users'],
          summary: 'Get user by username',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'User profile' }, 404: { description: 'Not found' } }
        }
      },
      '/users/{username}/follow': {
        post: {
          tags: ['Users'],
          summary: 'Toggle follow/unfollow a user',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Follow toggled' } }
        }
      },

      // ===== POSTS =====
      '/posts': {
        post: {
          tags: ['Posts'],
          summary: 'Create a new post',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    text: { type: 'string', example: 'My first post!' },
                    media: { type: 'array', items: { type: 'object' } },
                    visibility: { type: 'string', enum: ['public', 'followers', 'private'] },
                    isAnonymous: { type: 'boolean' }
                  }
                }
              }
            }
          },
          responses: { 201: { description: 'Post created' } }
        }
      },
      '/posts/{postId}': {
        get: {
          tags: ['Posts'],
          summary: 'Get a single post',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Post data' }, 404: { description: 'Not found' } }
        },
        delete: {
          tags: ['Posts'],
          summary: 'Delete a post (soft delete)',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Post deleted' }, 403: { description: 'Not authorized' } }
        }
      },
      '/posts/{postId}/like': {
        post: {
          tags: ['Posts'],
          summary: 'Toggle like on a post',
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Like toggled' } }
        }
      },

      // ===== FEED =====
      '/feed/home': {
        get: {
          tags: ['Feed'],
          summary: 'Home feed (following + own posts)',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } }
          ],
          responses: { 200: { description: 'Feed posts' } }
        }
      },
      '/feed/foryou': {
        get: {
          tags: ['Feed'],
          summary: 'For You — AI-personalized discovery feed',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Personalized posts' } }
        }
      },

      // ===== CHAT =====
      '/chat/conversations': {
        get: {
          tags: ['Chat'],
          summary: 'Get user conversations',
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Conversation list' } }
        }
      }
    }
  },
  apis: [] // We're using inline paths above instead of JSDoc annotations
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
