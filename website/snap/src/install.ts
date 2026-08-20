import type { StoreApp } from './types';

export function installConfinement(value?: string) {
  const confinement = value?.trim().toLowerCase();
  return confinement === 'classic' || confinement === 'devmode' || confinement === 'strict'
    ? confinement
    : undefined;
}

export function snapInstallCommand(app: Pick<StoreApp, 'name' | 'confinement'>) {
  const confinement = installConfinement(app.confinement);
  const flag = confinement === 'classic' ? '--classic' : confinement === 'devmode' ? '--devmode' : '';
  return `sudo snap install ${app.name}${flag ? ` ${flag}` : ''}`;
}
