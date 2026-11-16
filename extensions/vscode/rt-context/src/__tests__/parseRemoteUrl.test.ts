import { describe, expect, test } from 'bun:test';
import { parseRemoteUrl } from '../branchParser';

describe('parseRemoteUrl', () => {
  test('reads scp-style and https remotes', () => {
    expect(parseRemoteUrl('git@gitlab.com:acme/web.git')).toEqual({ host: 'https://gitlab.com', projectPath: 'acme/web' });
    expect(parseRemoteUrl('https://gitlab.com/acme/web.git')).toEqual({ host: 'https://gitlab.com', projectPath: 'acme/web' });
  });

  test('reads ssh:// remotes and drops the sshd port from the web host', () => {
    expect(parseRemoteUrl('ssh://git@gitlab.example.com:2222/acme/group/web.git')).toEqual({
      host: 'https://gitlab.example.com',
      projectPath: 'acme/group/web',
    });
  });

  test('keeps the port of an https remote, which is the web server', () => {
    expect(parseRemoteUrl('https://gitlab.example.com:8443/acme/web')).toEqual({
      host: 'https://gitlab.example.com:8443',
      projectPath: 'acme/web',
    });
  });

  test('strips credentials and lowercases the host', () => {
    expect(parseRemoteUrl('https://oauth2:secret@GitLab.Example.com/acme/web.git')?.host).toBe('https://gitlab.example.com');
  });

  test('refuses local paths and file remotes', () => {
    expect(parseRemoteUrl('/srv/git/web.git')).toBeNull();
    expect(parseRemoteUrl('file:///srv/git/web.git')).toBeNull();
  });
});
