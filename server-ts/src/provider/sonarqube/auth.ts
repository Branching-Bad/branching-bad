// ---------------------------------------------------------------------------
// SonarQube Basic Auth Helpers — setup functions using username/password auth
// ---------------------------------------------------------------------------

export async function createProjectBasicAuth(
  baseUrl: string,
  user: string,
  pass: string,
  projectKey: string,
  projectName: string,
): Promise<void> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/projects/create`;
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const body = new URLSearchParams({ project: projectKey, name: projectName });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    // 400 with "already exists" is fine
    if (resp.status === 400 && text.includes('already exist')) return;
    throw new Error(
      `Project creation failed (${resp.status}): ${text.slice(0, 300)}`,
    );
  }
}

export async function generateTokenBasicAuth(
  baseUrl: string,
  user: string,
  pass: string,
  tokenName: string,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/user_tokens/generate`;
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const body = new URLSearchParams({ name: tokenName, type: 'USER_TOKEN' });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Token generation failed (${resp.status}): ${text.slice(0, 300)}`,
    );
  }

  const data: any = await resp.json();
  if (!data.token) throw new Error('Token field missing from response');
  return String(data.token);
}

export async function changePasswordBasicAuth(
  baseUrl: string,
  user: string,
  oldPass: string,
  newPass: string,
): Promise<void> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/users/change_password`;
  const auth = Buffer.from(`${user}:${oldPass}`).toString('base64');
  const body = new URLSearchParams({
    login: user,
    previousPassword: oldPass,
    password: newPass,
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Password change failed (${resp.status}): ${text.slice(0, 300)}`,
    );
  }
}
