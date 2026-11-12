/**
 * Stateless Cloudflare Pages Function acting as a zero-storage CORS bridge
 * for Intervals.icu API v1.
 * - Never persists API keys, tokens, or health/activity data.
 * - Route: /api/intervals/*
 */

const INTERVALS_BASE_URL = 'https://intervals.icu/api/v1';

export async function onRequest(context) {
  const { request, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Accept',
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

  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const subPath = '/' + segments.join('/');
  const urlObj = new URL(request.url);
  const targetUrl = `${INTERVALS_BASE_URL}${subPath}${urlObj.search}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Accept: request.headers.get('Accept') || 'application/json',
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
      { error: err instanceof Error ? err.message : 'Intervals upstream proxy error' },
      { status: 502 }
    );
  }
}
