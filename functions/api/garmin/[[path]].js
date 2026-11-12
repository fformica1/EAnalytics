/**
 * Stateless Cloudflare Pages Function acting as a zero-storage CORS bridge
 * for Garmin Connect Personal API.
 * - Never persists API keys, tokens, or health/activity data.
 * - Route: /api/garmin/*
 */

const GARMIN_BASE_URL = 'https://personal.connectapi.garmin.com';
const GARMIN_TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

export async function onRequest(context) {
  const { request, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Garmin-Api-Key, Accept',
      },
    });
  }

  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const subPath = '/' + segments.join('/');
  const urlObj = new URL(request.url);

  try {
    if (subPath === '/token' && request.method === 'POST') {
      const apiKey = request.headers.get('X-Garmin-Api-Key');
      if (!apiKey) {
        return Response.json({ error: 'Missing X-Garmin-Api-Key header' }, { status: 400 });
      }
      const upstream = await fetch(`${GARMIN_BASE_URL}${GARMIN_TOKEN_PATH}`, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          Authorization: `ApiKey ${apiKey.trim()}`,
        },
      });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return Response.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    const targetUrl = `${GARMIN_BASE_URL}${subPath}${urlObj.search}`;
    const acceptHeader = request.headers.get('Accept') || 'application/json';
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Accept: acceptHeader,
        Authorization: authHeader,
      },
    });

    const headers = new Headers();
    const ct = upstream.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);
    headers.set('Cache-Control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Upstream proxy error' },
      { status: 502 }
    );
  }
}
