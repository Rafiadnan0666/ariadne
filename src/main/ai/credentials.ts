import * as keytar from 'keytar';

const SERVICE_NAME = 'ariadne-browser';

export interface StoredCredential {
  providerId: string;
  keyName: string;
  value: string;
}

function getAccountKey(providerId: string, keyName: string): string {
  return `${providerId}:${keyName}`;
}

export async function storeCredential(
  providerId: string,
  keyName: string,
  value: string
): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, getAccountKey(providerId, keyName), value);
}

export async function getCredential(providerId: string, keyName: string): Promise<string | null> {
  return keytar.getPassword(SERVICE_NAME, getAccountKey(providerId, keyName));
}

export async function deleteCredential(providerId: string, keyName: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE_NAME, getAccountKey(providerId, keyName));
}

export async function listCredentials(providerId: string): Promise<string[]> {
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  return credentials
    .filter((c) => c.account.startsWith(`${providerId}:`))
    .map((c) => c.account.split(':')[1]);
}

export async function clearAllCredentials(): Promise<void> {
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  for (const c of credentials) {
    await keytar.deletePassword(SERVICE_NAME, c.account);
  }
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '********';
  return key.slice(0, 4) + '...' + key.slice(-4);
}