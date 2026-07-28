import { connect } from 'jsxapi';

export interface EndpointCredentials {
  host: string;
  username: string;
  password: string;
}

export interface EndpointMacro {
  name: string;
  content: string;
  active?: boolean;
}

export type EndpointXapi = ReturnType<typeof connect>;
export type EndpointConnector = (
  url: string,
  options: { username: string; password: string },
) => EndpointXapi;

export function normalizeEndpointHost(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter the endpoint address.');

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('Enter a valid endpoint hostname or IP address.');
  }

  if (
    url.username
    || url.password
    || !url.host
    || url.hostname === '0.0.0.0'
    || (url.protocol !== 'https:' && url.protocol !== 'wss:')
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search
    || url.hash
  ) {
    throw new Error('Enter a valid endpoint hostname or IP address without a path.');
  }

  return url.host;
}

export function connectToEndpoint(
  credentials: EndpointCredentials,
  timeoutMs = 20_000,
  connector: EndpointConnector = connect,
): Promise<EndpointXapi> {
  return new Promise((resolve, reject) => {
    const xapi = connector(`wss://${credentials.host}`, {
      username: credentials.username,
      password: credentials.password,
    });
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      xapi.removeListener('error', onError);
      if (error) {
        xapi.close();
        reject(error);
        return;
      }

      // Keep a dropped socket from becoming an unhandled EventEmitter error.
      xapi.on('error', () => undefined);
      resolve(xapi);
    };
    const onError = () => finish(new Error(
      'Unable to connect to the endpoint. Verify its certificate is trusted, the address is reachable, and the credentials are correct.',
    ));
    const timer = globalThis.setTimeout(
      () => finish(new Error(
        'The endpoint connection timed out. Trust its certificate in this browser, then try again.',
      )),
      timeoutMs,
    );

    xapi.on('error', onError);
    xapi.on('ready', () => finish());
  });
}

function macroArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.Macro)) return record.Macro;
  if (record.Macro) return [record.Macro];
  return [];
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return undefined;
}

export async function getEndpointMacros(xapi: EndpointXapi): Promise<EndpointMacro[]> {
  const response = await xapi.command('Macros Macro Get', { Content: 'True' });
  const macros = macroArray(response)
    .map((item): EndpointMacro | undefined => {
      if (!item || typeof item !== 'object') return undefined;
      const record = item as Record<string, unknown>;
      const name = record.Name ?? record.name;
      const content = record.Content ?? record.content;
      const active = record.Active ?? record.active;
      if (typeof name !== 'string' || typeof content !== 'string') return undefined;
      return {
        name,
        content,
        ...(booleanValue(active) === undefined ? {} : { active: booleanValue(active) }),
      };
    })
    .filter((macro): macro is EndpointMacro => Boolean(macro))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (macros.length === 0) {
    throw new Error('The endpoint did not return any macros with source content.');
  }
  return macros;
}

export async function getEndpointBroadcastName(xapi: EndpointXapi): Promise<string> {
  const value = await xapi.status.get('SystemUnit BroadcastName');
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('The endpoint did not return its broadcast name.');
  }
  return value.trim();
}
