import type { Job, Song, Track, Voice } from "./types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    let body: unknown;
    try {
      body = await r.json();
    } catch {
      body = await r.text();
    }
    throw new ApiError(r.status, body);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const detail =
      typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : typeof body === "string"
          ? body
          : JSON.stringify(body);
    super(detail);
    this.status = status;
    this.body = body;
  }
}

export const api = {
  voices: {
    list: () => req<Voice[]>("/api/voices"),
    create: (form: FormData) => req<{ voice_id: string | null; job_id: string | null; voice?: Voice }>("/api/voices", { method: "POST", body: form }),
    remove: (id: string) => req<{ ok: boolean }>(`/api/voices/${id}`, { method: "DELETE" }),
  },
  tracks: {
    list: () => req<Track[]>("/api/tracks"),
    upload: (form: FormData) => req<Track>("/api/tracks", { method: "POST", body: form }),
    remove: (id: string) => req<{ ok: boolean }>(`/api/tracks/${id}`, { method: "DELETE" }),
    audioUrl: (id: string) => `/api/tracks/${id}/audio`,
  },
  songs: {
    list: () => req<Song[]>("/api/songs"),
    create: (form: FormData) => req<Song>("/api/songs", { method: "POST", body: form }),
    createJob: (form: FormData) => req<{ job_id: string }>("/api/songs/jobs", { method: "POST", body: form }),
    remove: (id: string) => req<{ ok: boolean }>(`/api/songs/${id}`, { method: "DELETE" }),
    audioUrl: (id: string) => `/api/songs/${id}/audio`,
  },
  jobs: {
    list: () => req<Job[]>("/api/jobs"),
    get: (id: string) => req<Job>(`/api/jobs/${id}`),
    cancel: (id: string) => req<{ ok: boolean; status: string }>(`/api/jobs/${id}/cancel`, { method: "POST" }),
    dismiss: (id: string) => req<{ ok: boolean }>(`/api/jobs/${id}`, { method: "DELETE" }),
  },
};
