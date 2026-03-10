import { describe, it, expect } from 'vitest';
import { createServer } from '../server.js';

describe('createServer', () => {
  it('returns app, client, and config', () => {
    const result = createServer();
    expect(result.app).toBeDefined();
    expect(result.client).toBeDefined();
    expect(result.config).toBeDefined();
  });

  it('uses default config when none provided', () => {
    const { config } = createServer();
    expect(config.server.port).toBe(3000);
    expect(config.ui.title).toBe('Wingman');
    expect(config.model).toBe('claude-sonnet-4');
  });

  it('accepts custom config', () => {
    const { config } = createServer({
      config: {
        model: 'claude-opus-4',
        server: { port: 8080 },
        ui: { title: 'Custom' },
      },
    });
    expect(config.server.port).toBe(8080);
    expect(config.ui.title).toBe('Custom');
    expect(config.model).toBe('claude-opus-4');
  });

  describe('GET /api/health', () => {
    it('returns ok status', async () => {
      const { app } = createServer();
      // Use a simple supertest-like approach with the app
      const { default: request } = await import('supertest');
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.version).toBe('0.1.0');
    });
  });

  describe('GET / (default UI)', () => {
    it('serves built-in HTML when no staticDir is provided', async () => {
      const { app } = createServer({
        config: { ui: { title: 'TestBot', welcomeMessage: 'Hi there!' } },
      });
      const { default: request } = await import('supertest');
      const response = await request(app).get('/');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/html/);
      expect(response.text).toContain('TestBot');
      expect(response.text).toContain('Hi there!');
    });

    it('does not serve default UI when staticDir is provided', async () => {
      const { app } = createServer({
        staticDir: './nonexistent-dir',
      });
      const { default: request } = await import('supertest');
      const response = await request(app).get('/');
      // staticDir takes precedence — will fail to find the file
      expect(response.status).not.toBe(200);
    });
  });

  describe('GET /api/config', () => {
    it('returns UI config', async () => {
      const { app } = createServer({
        config: { ui: { title: 'Test App', theme: 'dark' } },
      });
      const { default: request } = await import('supertest');
      const response = await request(app).get('/api/config');
      expect(response.status).toBe(200);
      expect(response.body.title).toBe('Test App');
      expect(response.body.theme).toBe('dark');
    });
  });

  describe('POST /api/chat', () => {
    it('rejects empty message', async () => {
      const { app } = createServer();
      const { default: request } = await import('supertest');
      const response = await request(app)
        .post('/api/chat')
        .send({ message: '' });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('message is required');
    });

    it('rejects missing message', async () => {
      const { app } = createServer();
      const { default: request } = await import('supertest');
      const response = await request(app)
        .post('/api/chat')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('message is required');
    });

    it('rejects non-string sessionId', async () => {
      const { app } = createServer();
      const { default: request } = await import('supertest');
      const response = await request(app)
        .post('/api/chat')
        .send({ message: 'hello', sessionId: 123 });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('sessionId must be a string');
    });
  });

  describe('CORS', () => {
    it('sets wildcard origin when cors: true', async () => {
      const { app } = createServer({ config: { server: { cors: true } } });
      const { default: request } = await import('supertest');
      const response = await request(app).get('/api/health');
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('omits CORS headers when cors: false', async () => {
      const { app } = createServer({ config: { server: { cors: false } } });
      const { default: request } = await import('supertest');
      const response = await request(app).get('/api/health');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows matching origin when cors is a string', async () => {
      const { app } = createServer({ config: { server: { cors: 'https://myapp.com' } } });
      const { default: request } = await import('supertest');
      const response = await request(app)
        .get('/api/health')
        .set('Origin', 'https://myapp.com');
      expect(response.headers['access-control-allow-origin']).toBe('https://myapp.com');
      expect(response.headers['vary']).toMatch(/Origin/);
    });

    it('rejects non-matching origin when cors is a string', async () => {
      const { app } = createServer({ config: { server: { cors: 'https://myapp.com' } } });
      const { default: request } = await import('supertest');
      const response = await request(app)
        .get('/api/health')
        .set('Origin', 'https://evil.com');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows matching origin from an array', async () => {
      const origins = ['https://a.com', 'https://b.com'];
      const { app } = createServer({ config: { server: { cors: origins } } });
      const { default: request } = await import('supertest');
      const response = await request(app)
        .get('/api/health')
        .set('Origin', 'https://b.com');
      expect(response.headers['access-control-allow-origin']).toBe('https://b.com');
    });

    it('handles OPTIONS preflight', async () => {
      const { app } = createServer({ config: { server: { cors: true } } });
      const { default: request } = await import('supertest');
      const response = await request(app).options('/api/health');
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
    });

    it('treats empty string cors as disabled', async () => {
      const { app } = createServer({ config: { server: { cors: '' as unknown as string } } });
      const { default: request } = await import('supertest');
      const response = await request(app).get('/api/health');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('treats empty array cors as disabled', async () => {
      const { app } = createServer({ config: { server: { cors: [] } } });
      const { default: request } = await import('supertest');
      const response = await request(app).get('/api/health');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

});
