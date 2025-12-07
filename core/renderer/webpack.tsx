// webpack wizardry ooo
// TODO: this comment and other docs

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

export function findByProps(props: string[], all = false) {
  return findExport((exp) => props.every((p) => p in exp), all)
}
export function findComponent(name: string, all = false, filter?: filter) {
  return findExport(
    (exp) =>
      typeof exp === 'function' &&
      exp.displayName === name &&
      (!filter || filter(exp)),
    all
  )
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

type reactElement<P = any> = React.ComponentType<P> | string
function getElementName(element: reactElement): string {
  if (typeof element === 'string') return element
  if ('displayName' in element && element.displayName)
    return element.displayName
  if ('name' in element && element.name) return element.name
  return 'Component'
}

const elementReplacements = new Map<reactElement, reactElement>()

React.createElement = new Proxy(React.createElement, {
  apply(target, thisArg, [type, props, ...children]: any[]) {
    const replacementElement = elementReplacements.get(type)
    const __original = props && props['__original']
    if (__original) {
      delete props['__original']
    }
    if (replacementElement && !__original) {
      // console.log(
      //   `[Taut] React.createElement: Replacing element ${getElementName(type)} with ${getElementName(replacementElement)}`
      // )
      return Reflect.apply(target, thisArg, [
        replacementElement,
        props,
        ...children,
      ])
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

export function patchComponent<P = any>(
  original: reactElement<P>,
  replacement: reactElement<P> | null
) {
  if (typeof replacement === 'function' && !('displayName' in replacement)) {
    // Shows up as the original element name with a [Patched] tag in React DevTools
    replacement.displayName = `Patched(${getElementName(original)})`
  }
  if (replacement === null) {
    elementReplacements.delete(original)
    console.log(
      `[Taut] patchComponent: Unpatched component ${getElementName(original)}`,
      elementReplacements
    )
  } else {
    elementReplacements.set(original, replacement)
    console.log(
      `[Taut] patchComponent: Patched component ${getElementName(original)} with ${getElementName(replacement)}`,
      elementReplacements
    )
  }
  dirtyMemoizationCache()
}

// global.test = () => {
//   // patch BaseAvatar to make it inverted colors
//   const BaseAvatar = findComponent('BaseAvatar')
//   patchComponent(BaseAvatar, (props) => {
//     return (
//       <div style={{ filter: 'hue-rotate(180deg)' }}>
//         <BaseAvatar {...props} __original />
//       </div>
//     )
//   })
// }

export const commonModules = {
  React,
  ReactDOM,
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
