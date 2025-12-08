// Taut Webpack Utilities
// Provides utilities for finding and patching Slack's internal Webpack modules
// Exposes React, ReactDOM, and component patching for plugins

import type { Root } from 'react-dom/client'

const global = globalThis as any

const webpackChunkwebapp = global.webpackChunkwebapp
let __webpack_require__: any
webpackChunkwebapp.push([
  [Symbol()],
  {},
  (r: any) => {
    __webpack_require__ = r
  },
])
const __REACT_DEVTOOLS_GLOBAL_HOOK__ = global.__REACT_DEVTOOLS_GLOBAL_HOOK__

export function allExports() {
  return (webpackChunkwebapp as any[])
    .flatMap((chunk: any) => Object.keys(chunk[1]))
    .map((id: string) => {
      try {
        return [id, __webpack_require__(id)] as const
      } catch {}
    })
    .filter((exp): exp is [string, any] => exp && exp[1])
}

type filter = (exp: any) => boolean

/**
 * Find Webpack exports matching a filter function
 * @param filter - Filter function to match exports
 * @param all - Whether to return all matches or just the first (default: false)
 */
export function findExport(filter: filter, all?: false): any | null
export function findExport(filter: filter, all: true): any[]
export function findExport(filter: filter, all = false) {
  const exports = allExports()
  const results = new Set<any>()

  for (const [id, exp] of exports) {
    try {
      if (filter(exp)) {
        if (!all) return exp
        results.add(exp)
      }
    } catch {}
    for (const key in exp) {
      if (!Object.prototype.hasOwnProperty.call(exp, key)) continue
      try {
        const candidate = exp[key]
        if (filter(candidate)) {
          if (!all) return candidate
          results.add(candidate)
        }
      } catch {}
    }
  }
  return all ? [...results] : null
}

/**
 * Find Webpack exports by their properties
 * @param props - Array of property names to match
 * @param all - Whether to return all matches or just the first (default: false)
 */
export function findByProps(props: string[], all?: false): any | null
export function findByProps(props: string[], all: true): any[]
export function findByProps(props: string[], all = false) {
  const func = (exp: any) => props.every((prop) => prop in exp)

  if (all) {
    return findExport(func, true)
  } else {
    return findExport(func)
  }
}

/**
 * Find React components by their display name
 * @param name - Display name of the component
 * @param all - Whether to return all matches or just the first (default: false)
 * @param filter - Optional additional filter function
 */

export function findComponent<P extends {}>(
  name: string,
  all?: false,
  filter?: filter
): React.ComponentType<P>
export function findComponent<P extends {}>(
  name: string,
  all: true,
  filter?: filter
): React.ComponentType<P>[]
export function findComponent(name: string, all = false, filter?: filter) {
  const func = (exp: any) =>
    getComponentName(exp) === name && (filter ? filter(exp) : true)

  if (all) {
    const results = findExport(func, true)
    return results.map(getOriginalComponent)
  } else {
    const result = findExport(func)
    if (!result) throw new Error(`[Taut] Could not find component: ${name}`)
    return getOriginalComponent(result)
  }
}

export const React = findByProps([
  'createElement',
  'Component',
  'useState',
]) as typeof import('react')
global.React = React // Makes JSX work anywhere

export const ReactDOM = findByProps([
  'render',
  'createPortal',
]) as typeof import('react-dom')
export const ReactDOMClient = findByProps([
  'createRoot',
  'hydrateRoot',
]) as typeof import('react-dom/client')

export function getRootFiber() {
  const container = document.querySelector('.p-client_container')
  if (!container) throw new Error('Could not find root container')
  const key = Object.keys(container).find((k) =>
    k.startsWith('__reactContainer$')
  )
  if (!key) throw new Error('Could not find root fiber key on container')
  const rootFiber = (container as any)[key]
  return rootFiber
}
// getFiberRoot().current === getRootFiber()
export function getFiberRoot() {
  return [...__REACT_DEVTOOLS_GLOBAL_HOOK__.getFiberRoots(1)][0]
}

const tempRoot = ReactDOMClient.createRoot(document.createElement('div'))
tempRoot.unmount()
const ReactDOMRoot = tempRoot.constructor as new (fiberRoot: any) => Root
export function getRoot() {
  const fiberRoot = getFiberRoot()
  return new ReactDOMRoot(fiberRoot)
}

export function dirtyMemoizationCache() {
  const rootFiber = getFiberRoot()

  const poison = (node: any) => {
    if (!node) return
    if (node.memoizedProps && typeof node.memoizedProps === 'object') {
      node.memoizedProps = { ...node.memoizedProps, _poison: 1 }
    }
    poison(node.child)
    poison(node.sibling)
  }
  poison(rootFiber)
}

export type reactElement<P = any> = React.ComponentType<P> | string
function getComponentName(component: any): string | null {
  if (!component) return null

  if (typeof component === 'object') {
    if (component.$$typeof === Symbol.for('react.memo')) {
      return getComponentName(component.type)
    }
    if (component.$$typeof === Symbol.for('react.forward_ref')) {
      return (
        component.displayName ||
        component.render?.displayName ||
        component.render?.name ||
        null
      )
    }
  }

  if (typeof component === 'function') {
    return component.displayName || null
  }

  return null
}
function getElementName(element: reactElement): string {
  if (typeof element === 'string') return element
  const name = getComponentName(element)
  if (name) return name
  return 'Component'
}
// Get the original component if the original may be a memo or forwardRef
function getOriginalComponent(component: any): any {
  if (!component) return component

  if (typeof component === 'object') {
    if (component.$$typeof === Symbol.for('react.memo')) {
      return getOriginalComponent(component.type)
    }
    if (component.$$typeof === Symbol.for('react.forward_ref')) {
      return getOriginalComponent(component.render)
    }
  }

  return component
}

export type elementReplacer<P = any> = (
  OriginalElement: reactElement<P>
) => reactElement<P>

const elementReplacements = new Map<reactElement, elementReplacer[]>()
const originalElementSymbol = Symbol('OriginalElement')

type originalElementObject = {
  symbol: typeof originalElementSymbol
  originalType: reactElement
  displayName: string
}
function isOriginalElementObject(
  element: any
): element is originalElementObject {
  return (
    typeof element === 'object' &&
    element !== null &&
    element.symbol === originalElementSymbol &&
    'originalType' in element
  )
}

React.createElement = new Proxy(React.createElement, {
  apply(
    target: typeof React.createElement,
    thisArg: any,
    [type, props, ...children]: [
      type: reactElement | originalElementObject,
      props: any,
      ...children: any[],
    ]
  ) {
    const __original = props && props['__original']
    if (__original) {
      delete props['__original']
    }

    // This is a special object that is equivalent to the original type without replacement
    if (isOriginalElementObject(type)) {
      const originalType = type['originalType']
      return Reflect.apply(target, thisArg, [originalType, props, ...children])
    }

    if (!__original) {
      const elementReplacers = elementReplacements.get(
        getOriginalComponent(type)
      )
      if (elementReplacers && elementReplacers.length > 0) {
        // Can be used in place of the original type, but will not get replaced again
        const originalElement = {
          symbol: originalElementSymbol,
          originalType: type,
          displayName: getElementName(type),
        } as unknown as reactElement

        const replacedType = elementReplacers.reduce(
          (currentType, replacer) => {
            const replaced = replacer(currentType)
            if (
              typeof replaced === 'function' &&
              !('displayName' in replaced)
            ) {
              // Shows up as the original element name with a [Patched] tag in React DevTools
              replaced.displayName = `Patched(${getElementName(currentType)})`
            }
            return replaced
          },
          originalElement
        )
        return Reflect.apply(target, thisArg, [
          replacedType,
          props,
          ...children,
        ])
      }
    }

    return Reflect.apply(target, thisArg, [type, props, ...children])
  },
})
declare global {
  namespace React {
    interface Attributes {
      /**
       * [Taut] Marks this element to use the original component, bypassing any patches.
       *
       * You must use this when rendering the original component inside a patched component to avoid infinite loops.
       */
      __original?: true
    }
  }
}

/**
 * Patch a React component to replace it with a custom implementation
 * @param original - Original component to patch
 * @param replacement - Function that takes the original component and returns the patched component
 * @returns Unpatch function to restore the original component
 */
export function patchComponent<P = {}>(
  original: reactElement<P>,
  replacement: elementReplacer<P>
): () => void {
  let replacements = elementReplacements.get(original)
  if (!replacements) {
    replacements = []
    elementReplacements.set(original, replacements)
  }
  replacements.push(replacement)

  dirtyMemoizationCache()
  console.log(
    `[Taut] patchComponent: Patched component ${getElementName(original)}`,
    elementReplacements
  )
  return () => {
    unpatchComponent(replacement)
  }
}
export function unpatchComponent(replacement: elementReplacer) {
  for (const [original, replacements] of elementReplacements.entries()) {
    const index = replacements.indexOf(replacement)
    if (index !== -1) {
      replacements.splice(index, 1)
      if (replacements.length === 0) {
        elementReplacements.delete(original)
      }
    }
  }
}

global.test = () => {
  // patch BaseAvatar to make it inverted colors
  const BaseAvatar = findComponent('BaseAvatar')!
  patchComponent(BaseAvatar, (OriginalElement) => (props) => {
    return (
      <div style={{ filter: 'hue-rotate(180deg)' }}>
        <OriginalElement {...props} />
      </div>
    )
  })
}

/**
 * Commonly used modules exposed for plugins
 */
export const commonModules = {
  /** npm:react */
  React,
  /** npm:react-dom */
  ReactDOM,
  /** npm:react-dom/client */
  ReactDOMClient,
}

// Expose for debugging in console
global.__webpack_require__ = __webpack_require__
global.allExports = allExports
global.findExport = findExport
global.findByProps = findByProps
global.findComponent = findComponent
global.patchComponent = patchComponent
global.ReactDOM = ReactDOM
global.ReactDOMClient = ReactDOMClient
