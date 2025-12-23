/**
 * Graph command - Visualize service dependency graph
 */

import chalk from 'chalk'
import { discoverServices, discoverPublishedServices, sortByDependencies } from '@pulumix/core'
import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'yaml'

export interface GraphCommandOptions {
  readonly path?: string
  readonly format?: 'tree' | 'dot' | 'mermaid'
}

/**
 * Execute graph command
 */
export async function graphCommand(options: GraphCommandOptions): Promise<void> {
  const rootPath = path.resolve(options.path || process.cwd())
  const format = options.format || 'tree'

  // Discover services
  const rootConfigPath = path.join(rootPath, 'pulumix.yaml')
  let allowlist: string[] = []

  if (fs.existsSync(rootConfigPath)) {
    const rootConfig = yaml.parse(fs.readFileSync(rootConfigPath, 'utf-8'))
    allowlist = rootConfig?.services?.allowed ?? []
  }

  const localResult = await discoverServices(rootPath)
  const publishedResult = await discoverPublishedServices(rootPath, allowlist)

  if (localResult.isLeft() || publishedResult.isLeft()) {
    console.error(chalk.red('Failed to discover services'))
    process.exit(1)
  }

  const localServices = localResult.unsafeCoerce()
  const publishedServices = publishedResult.unsafeCoerce()
  const allServices = [...localServices, ...publishedServices]

  // Sort by dependencies
  const sorted = sortByDependencies(allServices)

  console.log('')

  if (format === 'tree') {
    // Tree format (default)
    console.log(chalk.bold('Service Dependency Graph'))
    console.log('')

    for (let i = 0; i < sorted.length; i++) {
      const service = sorted[i]
      const isLast = i === sorted.length - 1
      const prefix = isLast ? '└─' : '├─'

      console.log(`${prefix} ${chalk.cyan(service.name)}`)

      if (service.dependencies.length > 0) {
        const depPrefix = isLast ? '   ' : '│  '
        for (let j = 0; j < service.dependencies.length; j++) {
          const dep = service.dependencies[j]
          const isLastDep = j === service.dependencies.length - 1
          const depLine = isLastDep ? '└─' : '├─'
          console.log(`${depPrefix}${depLine} ${chalk.dim(dep)}`)
        }
      }
    }
  } else if (format === 'dot') {
    // Graphviz DOT format
    console.log('digraph Services {')
    console.log('  rankdir=LR;')
    console.log('  node [shape=box];')
    console.log('')

    for (const service of allServices) {
      const label = service.hasDockerfile
        ? `${service.name}\\n(container)`
        : service.name
      console.log(`  "${service.name}" [label="${label}"];`)

      for (const dep of service.dependencies) {
        console.log(`  "${service.name}" -> "${dep}";`)
      }
    }

    console.log('}')
  } else if (format === 'mermaid') {
    // Mermaid format (for GitHub, GitLab, etc.)
    console.log('```mermaid')
    console.log('graph LR')

    for (const service of allServices) {
      const id = service.name.replace(/-/g, '_')
      const label = service.hasDockerfile
        ? `${service.name}<br/>(container)`
        : service.name
      console.log(`  ${id}[${label}]`)

      for (const dep of service.dependencies) {
        const depId = dep.replace(/-/g, '_')
        console.log(`  ${id} --> ${depId}`)
      }
    }

    console.log('```')
  }

  console.log('')
}
