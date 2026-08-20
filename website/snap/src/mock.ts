import type { AdminState, StorefrontData } from './types';

export const mockStorefront: StorefrontData = {
  version: 'rolling',
  categories: [
    { name: 'Developer Tools', count: 28, glyph: '⌘' },
    { name: 'Productivity', count: 19, glyph: '◫' },
    { name: 'Media', count: 16, glyph: '▶' },
    { name: 'Networking', count: 14, glyph: '◎' },
    { name: 'Storage', count: 11, glyph: '▱' },
    { name: 'Utilities', count: 36, glyph: '✦' }
  ],
  apps: [
    { id: 'nextcloud', name: 'nextcloud', displayName: 'Nextcloud', publisher: 'Nextcloud', publisherUsername: 'nextcloud', summary: 'A safe home for all your data.', description: 'Access and collaborate across your devices with a private productivity platform.\n\nKeep files, calendars, conversations and collaborative work together on infrastructure you control.', category: 'Productivity', icon: 'https://dashboard.snapcraft.io/site_media/appmedia/2016/06/icon.svg_1.png', banner: 'https://dashboard.snapcraft.io/site_media/appmedia/2020/06/Nextcloud_Hub_Snap_background_Y4FhvPp.png', screenshots: ['https://dashboard.snapcraft.io/site_media/appmedia/2020/06/sidebar_and_new_share_dialog.png', 'https://dashboard.snapcraft.io/site_media/appmedia/2020/06/talk-promoted-view.png', 'https://dashboard.snapcraft.io/site_media/appmedia/2020/06/calendar.png'], videos: ['https://vimeo.com/555692548'], license: 'AGPL-3.0+', storeUrl: 'https://snapcraft.io/nextcloud', links: [{ label: 'Website', url: 'https://github.com/nextcloud/nextcloud-snap' }, { label: 'Report a bug', url: 'https://github.com/nextcloud-snap/nextcloud-snap/issues' }, { label: 'Source code', url: 'https://github.com/nextcloud/nextcloud-snap' }], confinement: 'strict', releasedAt: '2026-08-14T08:20:00+00:00', accent: '#1976d2', source: 'upstream', sourceName: 'Canonical', verified: true, featured: true, version: '31.0.8', channel: 'stable', architectures: ['amd64', 'arm64'], webdesktop: 'web', rating: 4.8, downloads: '2.4M', updated: '2 days ago' },
    { id: 'code', name: 'code', displayName: 'Visual Studio Code', publisher: 'Microsoft', summary: 'Code editing. Redefined.', description: 'A streamlined code editor with support for development operations.', category: 'Developer Tools', accent: '#168bd2', source: 'upstream', sourceName: 'Canonical', verified: true, featured: true, version: '1.104', channel: 'stable', architectures: ['amd64', 'arm64'], webdesktop: 'gui', rating: 4.9, downloads: '5.8M', updated: 'Today' },
    { id: 'jellyfin', name: 'jellyfin', displayName: 'Jellyfin', publisher: 'Jellyfin', summary: 'Your media, your way.', description: 'The volunteer-built media solution that puts you in control.', category: 'Media', accent: '#7b5cff', source: 'upstream', sourceName: 'Canonical', verified: true, featured: true, version: '10.10.7', channel: 'stable', architectures: ['amd64', 'arm64'], webdesktop: 'web', rating: 4.7, downloads: '890K', updated: '4 days ago' },
    { id: 'webdesktop', name: 'webdesktop', displayName: 'WebDesktop', publisher: 'CapOS', summary: 'The native desktop experience for CapOS.', description: 'Manage apps, files, storage and services in a coherent browser workspace.', category: 'Utilities', accent: '#2563eb', source: 'local', sourceName: 'CapOS', verified: true, featured: true, version: '2.0.0', channel: 'stable', architectures: ['amd64', 'arm64'], webdesktop: 'native', rating: 5, downloads: 'Built-in', updated: 'Today' },
    { id: 'lxd', name: 'lxd', displayName: 'LXD', publisher: 'Canonical', summary: 'Modern system containers and virtual machines.', description: 'A powerful system container and VM manager.', category: 'Developer Tools', accent: '#e95420', source: 'upstream', sourceName: 'Canonical', verified: true, version: '6.5', channel: 'stable', architectures: ['amd64', 'arm64'], webdesktop: 'service', downloads: '1.1M', updated: '1 week ago' },
    { id: 'tailscale', name: 'tailscale', displayName: 'Tailscale', publisher: 'Tailscale', summary: 'Private networks made easy.', description: 'Connect your devices and services securely from anywhere.', category: 'Networking', accent: '#242424', source: 'upstream', sourceName: 'Canonical', verified: true, version: '1.86', channel: 'stable', architectures: ['amd64', 'arm64'], webdesktop: 'service', downloads: '730K', updated: 'Yesterday' },
    { id: 'syncthing', name: 'syncthing', displayName: 'Syncthing', publisher: 'Syncthing', summary: 'Continuous file synchronization.', description: 'Synchronize files between two or more computers in real time.', category: 'Storage', accent: '#0891b2', source: 'upstream', sourceName: 'Canonical', verified: true, version: '1.30.0', channel: 'stable', architectures: ['amd64', 'arm64'], webdesktop: 'web', downloads: '410K', updated: '3 days ago' },
    { id: 'home-assistant', name: 'home-assistant', displayName: 'Home Assistant', publisher: 'Community', summary: 'Open source home automation.', description: 'Put local control and privacy first in your smart home.', category: 'Utilities', accent: '#18bcf2', source: 'upstream', sourceName: 'Canonical', verified: false, version: '2026.8', channel: 'stable', architectures: ['amd64', 'arm64'], webdesktop: 'web', downloads: '620K', updated: 'Today' }
  ]
};

export const mockAdmin: AdminState = {
  versions: [
    { name: 'rolling', label: 'Rolling', active: true, frozen: false, appCount: 134 },
    { name: '2.0', label: 'CapOS 2.0', active: true, frozen: false, appCount: 128 },
    { name: '1.0', label: 'CapOS 1.0', active: true, frozen: true, appCount: 103 }
  ],
  upstreams: [
    { id: 1, name: 'Canonical Snap Store', apiUrl: 'https://api.snapcraft.io', priority: 10, enabled: true, status: 'online', latencyMs: 183 },
    { id: 2, name: 'CapOS Community', apiUrl: 'https://community.example.invalid', priority: 20, enabled: false, status: 'offline' }
  ],
  localPackages: mockStorefront.apps.filter(a => a.source === 'local'),
  stats: { local: 1, upstream: 133, versions: 3, downloads24h: 1248 }
};
