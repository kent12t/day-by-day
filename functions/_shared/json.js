export function json(data, init = {}) {
  const status = init.status || 200;
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store, private");
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function error(code, message, status = 400) {
  return json(
    {
      ok: false,
      error: { code, message },
    },
    { status }
  );
}

export async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
