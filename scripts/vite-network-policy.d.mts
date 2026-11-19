export type ViteNetworkPolicy = {
  host: '0.0.0.0' | '127.0.0.1'
  httpsEnabled: boolean
}

export function resolveViteNetworkPolicy(
  certPath: string | undefined,
  keyPath: string | undefined,
): ViteNetworkPolicy
