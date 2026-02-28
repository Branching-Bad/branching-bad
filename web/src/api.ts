export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("Backend is not reachable. Is the server running?");
  }
  const text = await response.text();
  if (!text) throw new Error("Empty response from server.");
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new Error("Invalid JSON response from server."); }
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? "Unexpected API error");
  return payload as T;
}
