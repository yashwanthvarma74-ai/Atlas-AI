import type {
  AddMemberInput,
  Conversation,
  Message,
  UpdateConversationInput,
  CreateWorkspaceInput,
  DocumentSummary,
  LoginInput,
  Member,
  MemberRole,
  Passage,
  RegisterInput,
  SearchSource,
  SessionUser,
  Workspace,
} from '@atlas/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error',
  ) {
    super(message);
  }
}

// The server checks everything that comes in and builds everything that goes out from the schemas in
// @atlas/shared, and the types here come from the same place. The browser trusts the types instead of
// running the schemas again, which keeps the validation library out of the bundle.
async function request<T = undefined>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    body: json === undefined ? rest.body : JSON.stringify(json),
    headers: {
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...rest.headers,
    },
    credentials: 'same-origin',
  });

  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; code?: string };
  } | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.message ?? 'Something went wrong. Try again.',
      body?.error?.code,
    );
  }
  return body as T;
}

export const api = {
  // ---- session ----
  // The signed-in user, or null when there is no session.
  async me() {
    try {
      return (await request<{ user: SessionUser }>('/auth/me')).user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  async register(input: RegisterInput) {
    return (await request<{ user: SessionUser }>('/auth/register', { method: 'POST', json: input }))
      .user;
  },
  async login(input: LoginInput) {
    return (await request<{ user: SessionUser }>('/auth/login', { method: 'POST', json: input }))
      .user;
  },
  async continueAsGuest() {
    return (await request<{ user: SessionUser }>('/auth/guest', { method: 'POST' })).user;
  },
  logout: () => request('/auth/logout', { method: 'POST' }),

  // ---- workspaces ----
  async workspaces() {
    return (await request<{ workspaces: Workspace[] }>('/workspaces')).workspaces;
  },
  async workspace(id: string) {
    return (await request<{ workspace: Workspace }>(`/workspaces/${id}`)).workspace;
  },
  async createWorkspace(input: CreateWorkspaceInput) {
    return (await request<{ workspace: Workspace }>('/workspaces', { method: 'POST', json: input }))
      .workspace;
  },

  // ---- documents ----
  async documents(workspaceId: string) {
    return (await request<{ documents: DocumentSummary[] }>(`/workspaces/${workspaceId}/documents`))
      .documents;
  },
  // The file is the request body, so the server can cut it off at the size limit.
  async uploadDocument(workspaceId: string, file: File) {
    return (
      await request<{ document: DocumentSummary }>(
        `/workspaces/${workspaceId}/documents?name=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': 'application/octet-stream' },
        },
      )
    ).document;
  },
  retryDocument: (workspaceId: string, documentId: string) =>
    request(`/workspaces/${workspaceId}/documents/${documentId}/retry`, { method: 'POST' }),
  deleteDocument: (workspaceId: string, documentId: string) =>
    request(`/workspaces/${workspaceId}/documents/${documentId}`, { method: 'DELETE' }),
  documentFileUrl: (workspaceId: string, documentId: string) =>
    `/api/workspaces/${workspaceId}/documents/${documentId}/file`,

  // ---- search ----
  async search(workspaceId: string, query: string) {
    return (
      await request<{ sources: SearchSource[] }>(`/workspaces/${workspaceId}/search`, {
        method: 'POST',
        json: { query },
      })
    ).sources;
  },
  async passages(workspaceId: string, documentId: string, page: number) {
    return (
      await request<{ passages: Passage[] }>(
        `/workspaces/${workspaceId}/documents/${documentId}/passages?page=${page}`,
      )
    ).passages;
  },

  // ---- conversations ----
  async conversations(workspaceId: string, search?: string) {
    const query = search ? `?q=${encodeURIComponent(search)}` : '';
    return (
      await request<{ conversations: Conversation[] }>(
        `/workspaces/${workspaceId}/conversations${query}`,
      )
    ).conversations;
  },
  async conversation(workspaceId: string, id: string) {
    return request<{ conversation: Conversation; messages: Message[] }>(
      `/workspaces/${workspaceId}/conversations/${id}`,
    );
  },
  async createConversation(workspaceId: string) {
    return (
      await request<{ conversation: Conversation }>(`/workspaces/${workspaceId}/conversations`, {
        method: 'POST',
      })
    ).conversation;
  },
  async updateConversation(workspaceId: string, id: string, changes: UpdateConversationInput) {
    return (
      await request<{ conversation: Conversation }>(
        `/workspaces/${workspaceId}/conversations/${id}`,
        {
          method: 'PATCH',
          json: changes,
        },
      )
    ).conversation;
  },
  deleteConversation: (workspaceId: string, id: string) =>
    request(`/workspaces/${workspaceId}/conversations/${id}`, { method: 'DELETE' }),

  // ---- members ----
  async members(workspaceId: string) {
    return (await request<{ members: Member[] }>(`/workspaces/${workspaceId}/members`)).members;
  },
  async addMember(workspaceId: string, input: AddMemberInput) {
    return (
      await request<{ member: Member }>(`/workspaces/${workspaceId}/members`, {
        method: 'POST',
        json: input,
      })
    ).member;
  },
  changeRole: (workspaceId: string, userId: string, role: MemberRole) =>
    request(`/workspaces/${workspaceId}/members/${userId}`, { method: 'PATCH', json: { role } }),
  removeMember: (workspaceId: string, userId: string) =>
    request(`/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' }),
};
