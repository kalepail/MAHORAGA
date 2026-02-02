export const API_BASE = '/api'

export interface ApiResponse<T> {
  ok: boolean
  data: T
  error?: string
}

export function getApiToken(): string {
  return localStorage.getItem('mahoraga_api_token') || import.meta.env.VITE_MAHORAGA_API_TOKEN || ''
}

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getApiToken()
  const headers = new Headers(options.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(url, { ...options, headers })
}

export async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const res = await authFetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, data: undefined as T, error: `${res.status}: ${text || res.statusText}` }
  }
  return res.json() as Promise<ApiResponse<T>>
}
