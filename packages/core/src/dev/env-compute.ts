/**
 * Environment variable computation for dev mode
 *
 * Auto-rewrites cluster references (service DNS, ClusterIPs) to localhost
 * using port-forward mappings discovered from the cluster.
 */

import type { ClusterServiceInfo } from '../k8s'

/**
 * Lookup table entry for a dependency that is port-forwarded
 */
export interface DependencyLookup {
  readonly serviceName: string
  readonly clusterIP?: string
  readonly dnsNames: readonly string[]
  readonly remotePort: number
  readonly localPort: number
}

/**
 * Build dependency lookups from cluster service info and port-forward mappings
 */
export function buildDependencyLookups(
  clusterServices: ClusterServiceInfo[],
  portForwards: ReadonlyArray<{ serviceName: string; remotePort: number; localPort: number }>
): DependencyLookup[] {
  const lookups: DependencyLookup[] = []

  for (const pf of portForwards) {
    const clusterSvc = clusterServices.find(s => s.name === pf.serviceName)
    lookups.push({
      serviceName: pf.serviceName,
      clusterIP: clusterSvc?.clusterIP,
      dnsNames: clusterSvc?.dnsNames ?? [pf.serviceName],
      remotePort: pf.remotePort,
      localPort: pf.localPort,
    })
  }

  return lookups
}

/**
 * Try to parse a value as a URL and rewrite the host/port if it matches
 * a known dependency.
 */
function tryRewriteUrl(value: string, lookups: DependencyLookup[]): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  const hostname = parsed.hostname

  for (const dep of lookups) {
    const matchesDns = dep.dnsNames.some(dns => hostname === dns)
    const matchesIP = dep.clusterIP ? hostname === dep.clusterIP : false

    if (matchesDns || matchesIP) {
      parsed.hostname = 'localhost'
      parsed.port = String(dep.localPort)
      return parsed.toString()
    }
  }

  return null
}

/**
 * Try to match an exact hostname/DNS string and replace with localhost
 */
function tryRewriteHostname(value: string, lookups: DependencyLookup[]): string | null {
  for (const dep of lookups) {
    if (dep.dnsNames.some(dns => value === dns)) {
      return 'localhost'
    }
    if (dep.clusterIP && value === dep.clusterIP) {
      return '127.0.0.1'
    }
  }
  return null
}

/**
 * Compute dev environment variables by rewriting cluster references to localhost.
 *
 * For each env var from the deployment spec:
 * 1. Try URL parse - if hostname matches a known dependency, rewrite host/port
 * 2. Detect split *_HOST / *_PORT patterns - rewrite both (checked before generic match)
 * 3. Skip *_PORT keys already rewritten by the HOST handler
 * 4. Exact match against known hostnames/DNS or ClusterIPs - replace with localhost/127.0.0.1
 * 5. Otherwise pass through unchanged
 *
 * Apply devEnvOverrides last.
 */
export function computeDevEnvVars(
  deploymentEnvVars: Record<string, string>,
  dependencyLookups: DependencyLookup[],
  devEnvOverrides?: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {}

  // Collect all env var entries for HOST/PORT pattern detection
  const entries = Object.entries(deploymentEnvVars)
  const envKeys = new Set(entries.map(([k]) => k))

  for (const [key, value] of entries) {
    // 1. Try URL rewrite
    const urlRewrite = tryRewriteUrl(value, dependencyLookups)
    if (urlRewrite !== null) {
      result[key] = urlRewrite
      continue
    }

    // 2. Detect *_HOST/*_PORT paired pattern before generic hostname match
    //    so we can also rewrite the paired PORT value
    if (key.endsWith('_HOST')) {
      const prefix = key.slice(0, -5)
      const portKey = `${prefix}_PORT`

      for (const dep of dependencyLookups) {
        const matchesDns = dep.dnsNames.some(dns => value === dns)
        const matchesIP = dep.clusterIP ? value === dep.clusterIP : false

        if (matchesDns || matchesIP) {
          result[key] = 'localhost'
          if (envKeys.has(portKey)) {
            result[portKey] = String(dep.localPort)
          }
          break
        }
      }

      if (result[key] !== undefined) continue
    }

    // 3. Skip *_PORT keys already rewritten by the HOST handler above
    if (key.endsWith('_PORT') && result[key] !== undefined) {
      continue
    }

    // 4. Exact hostname / ClusterIP match (non-URL, non-HOST/PORT pattern)
    const hostnameRewrite = tryRewriteHostname(value, dependencyLookups)
    if (hostnameRewrite !== null) {
      result[key] = hostnameRewrite
      continue
    }

    // 5. Pass through unchanged
    result[key] = value
  }

  // Apply dev.env overrides last
  if (devEnvOverrides) {
    Object.assign(result, devEnvOverrides)
  }

  return result
}
