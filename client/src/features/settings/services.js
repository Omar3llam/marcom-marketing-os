import { api } from '@/api/client';

export async function getMetaCredentialStatus(projectId) {
  const response = await api.get('/api/credentials/status', {
    params: { platform: 'meta_ads', projectId },
  });
  return response.data;
}

export async function updateUserProfile(displayName) {
  return api.patch('/api/user/profile', { displayName });
}

export async function updateWorkspaceName(workspaceName) {
  return api.patch('/api/user/workspace', { workspaceName });
}

export async function getMetaConnectUrl(projectId) {
  const response = await api.get('/api/auth/meta/connect', { params: { projectId } });
  return response.data?.oauthUrl;
}

export async function deleteUserAccount() {
  return api.delete('/api/user/account');
}
