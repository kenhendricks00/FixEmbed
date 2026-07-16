export const DISCORD_CLIENT_ID = '1173820242305224764';
export const SERVER_INSTALL_PERMISSIONS = '274878295040';

export const INSTALL_CONTEXTS = ['user', 'server'] as const;
export type InstallContext = typeof INSTALL_CONTEXTS[number];

export const INSTALL_SOURCES = [
    'home-nav',
    'home-hero',
    'home-mobile',
    'home-final',
    'site-nav',
    'support-action',
    'twitter-landing',
    'instagram-landing',
    'reddit-landing',
] as const;
export type InstallSource = typeof INSTALL_SOURCES[number];

export function parseInstallContext(value: string): InstallContext | null {
    return (INSTALL_CONTEXTS as readonly string[]).includes(value)
        ? value as InstallContext
        : null;
}

export function parseInstallSource(value: string): InstallSource | null {
    return (INSTALL_SOURCES as readonly string[]).includes(value)
        ? value as InstallSource
        : null;
}

export function discordInstallUrl(context: InstallContext): string {
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', DISCORD_CLIENT_ID);
    url.searchParams.set('integration_type', context === 'user' ? '1' : '0');
    url.searchParams.set(
        'scope',
        context === 'user' ? 'applications.commands' : 'bot applications.commands',
    );
    if (context === 'server') {
        url.searchParams.set('permissions', SERVER_INSTALL_PERMISSIONS);
    }
    return url.toString();
}
