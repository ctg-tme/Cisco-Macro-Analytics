import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  connectToEndpoint,
  getEndpointBroadcastName,
  getEndpointMacros,
  normalizeEndpointHost,
  type EndpointConnector,
  type EndpointXapi,
} from './device';

describe('endpoint connection boundary', () => {
  it('normalizes a host without retaining a URL path or credentials', () => {
    expect(normalizeEndpointHost('room-kit.example.com')).toBe('room-kit.example.com');
    expect(normalizeEndpointHost('https://10.0.0.12:443')).toBe('10.0.0.12');
    expect(() => normalizeEndpointHost('https://admin:secret@room-kit.example.com')).toThrow(
      'Enter a valid endpoint hostname or IP address without a path.',
    );
    expect(() => normalizeEndpointHost('https://room-kit.example.com/web')).toThrow(
      'Enter a valid endpoint hostname or IP address without a path.',
    );
  });

  it('opens the exact secure WebSocket target and resolves only when JSXAPI is ready', async () => {
    const socket = Object.assign(new EventEmitter(), {
      close: vi.fn(),
      command: vi.fn(),
    }) as unknown as EndpointXapi;
    const connector = vi.fn(() => socket) as unknown as EndpointConnector;
    const connection = connectToEndpoint({
      host: 'room-kit.example.com',
      username: 'review-user',
      password: 'review-password',
    }, 1_000, connector);

    expect(connector).toHaveBeenCalledWith('wss://room-kit.example.com', {
      username: 'review-user',
      password: 'review-password',
    });
    socket.emit('ready', socket);

    await expect(connection).resolves.toBe(socket);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it('retrieves macro source with the required read-only xAPI command', async () => {
    const command = vi.fn().mockResolvedValue({
      Macro: [
        { Name: 'Main', Active: 'True', Content: "import xapi from 'xapi';" },
        { Name: 'Helpers', Active: 'False', Content: 'export const value = 1;' },
      ],
    });

    const macros = await getEndpointMacros({ command } as unknown as EndpointXapi);

    expect(command).toHaveBeenCalledOnce();
    expect(command).toHaveBeenCalledWith('Macros Macro Get', { Content: 'True' });
    expect(macros).toEqual([
      { name: 'Helpers', active: false, content: 'export const value = 1;' },
      { name: 'Main', active: true, content: "import xapi from 'xapi';" },
    ]);
  });

  it('retrieves and normalizes the device broadcast name after connection', async () => {
    const get = vi.fn().mockResolvedValue('  Boardroom East  ');

    await expect(getEndpointBroadcastName({
      status: { get },
    } as unknown as EndpointXapi)).resolves.toBe('Boardroom East');

    expect(get).toHaveBeenCalledWith('SystemUnit BroadcastName');
  });

  it('rejects a missing broadcast name instead of caching an unnamed device', async () => {
    const get = vi.fn().mockResolvedValue('  ');

    await expect(getEndpointBroadcastName({
      status: { get },
    } as unknown as EndpointXapi)).rejects.toThrow(
      'The endpoint did not return its broadcast name.',
    );
  });

  it('accepts the single-macro response shape and rejects missing content', async () => {
    const single = vi.fn().mockResolvedValue({
      Macro: { Name: 'Main', Content: 'xapi.Status.Audio.Volume.get();' },
    });
    await expect(getEndpointMacros({ command: single } as unknown as EndpointXapi)).resolves.toEqual([
      { name: 'Main', content: 'xapi.Status.Audio.Volume.get();' },
    ]);

    const missingContent = vi.fn().mockResolvedValue({
      Macro: { Name: 'Main', Active: 'True' },
    });
    await expect(getEndpointMacros({ command: missingContent } as unknown as EndpointXapi)).rejects.toThrow(
      'The endpoint did not return any macros with source content.',
    );
  });
});
