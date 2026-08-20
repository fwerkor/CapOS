import type { StoreApp } from './types';

export function installConfinement(value?: string) {
  const confinement = value?.trim().toLowerCase();
  return confinement === 'classic' || confinement === 'devmode' || confinement === 'strict'
    ? confinement
    : undefined;
}

function installFlag(confinement?: string) {
  const mode = installConfinement(confinement);
  return mode === 'classic' ? '--classic' : mode === 'devmode' ? '--devmode' : '';
}

function commandFor(name: string, confinement?: string) {
  const flag = installFlag(confinement);
  return `sudo snap install ${name}${flag ? ` ${flag}` : ''}`;
}

const unamePatterns: Record<string, string> = {
  amd64: 'x86_64',
  arm64: 'aarch64|arm64',
  armhf: 'armv7l|armv7*',
  i386: 'i386|i486|i586|i686',
  powerpc: 'ppc|powerpc',
  ppc64el: 'ppc64le',
  riscv64: 'riscv64',
  s390x: 's390x',
};

export function snapInstallCommand(app: Pick<StoreApp, 'name' | 'confinement' | 'confinementByArchitecture'>) {
  const modes = Object.entries(app.confinementByArchitecture || {})
    .map(([architecture, value]) => [architecture, installConfinement(value)] as const)
    .filter((entry): entry is readonly [string, 'strict' | 'classic' | 'devmode'] => Boolean(entry[1]));
  if (!modes.length) return commandFor(app.name, app.confinement);

  const uniqueModes = new Set(modes.map(([, mode]) => mode));
  if (uniqueModes.size === 1) return commandFor(app.name, modes[0][1]);

  const cases = modes.flatMap(([architecture, mode]) => {
    const pattern = unamePatterns[architecture];
    return pattern ? [`${pattern}) ${commandFor(app.name, mode)} ;;`] : [];
  });
  if (!cases.length) return commandFor(app.name, app.confinement);
  return `case "$(uname -m)" in ${cases.join(' ')} *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;; esac`;
}
