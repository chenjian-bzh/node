// This file creates the internal module & binding loaders used by built-in
// modules. In contrast, user land modules are loaded using
// lib/internal/modules/cjs/loader.js (CommonJS Modules) or
// lib/internal/modules/esm/* (ES Modules).
//
// This file is compiled and run by node.cc before bootstrap/node.js
// was called, therefore the loaders are bootstraped before we start to
// actually bootstrap Node.js. It creates the following objects:
//
// C++ binding loaders:
// - process.binding(): the legacy C++ binding loader, accessible from user land
//   because it is an object attached to the global process object.
//   These C++ bindings are created using NODE_BUILTIN_MODULE_CONTEXT_AWARE()
//   and have their nm_flags set to NM_F_BUILTIN. We do not make any guarantees
//   about the stability of these bindings, but still have to take care of
//   compatibility issues caused by them from time to time.
// - process._linkedBinding(): intended to be used by embedders to add
//   additional C++ bindings in their applications. These C++ bindings
//   can be created using NODE_MODULE_CONTEXT_AWARE_CPP() with the flag
//   NM_F_LINKED.
// - internalBinding(): the private internal C++ binding loader, inaccessible
//   from user land unless through `require('internal/test/binding')`.
//   These C++ bindings are created using NODE_MODULE_CONTEXT_AWARE_INTERNAL()
//   and have their nm_flags set to NM_F_INTERNAL.
//
// Internal JavaScript module loader:
// - NativeModule: a minimal module system used to load the JavaScript core
//   modules found in lib/**/*.js and deps/**/*.js. All core modules are
//   compiled into the node binary via node_javascript.cc generated by js2c.py,
//   so they can be loaded faster without the cost of I/O. This class makes the
//   lib/internal/*, deps/internal/* modules and internalBinding() available by
//   default to core modules, and lets the core modules require itself via
//   require('internal/bootstrap/loaders') even when this file is not written in
//   CommonJS style.
//
// Other objects:
// - process.moduleLoadList: an array recording the bindings and the modules
//   loaded in the process and the order in which they are loaded.

"use strict";

// This file is compiled as if it's wrapped in a function with arguments
// passed by node::RunBootstrapping()
/* global process, getLinkedBinding, getInternalBinding, primordials */

const {
  ReflectGet,
  ObjectCreate,
  ObjectDefineProperty,
  ObjectKeys,
  ObjectPrototypeHasOwnProperty,
  SafeSet
} = primordials;

// Set up process.moduleLoadList.
const moduleLoadList = [];
ObjectDefineProperty(process, "moduleLoadList", {
  value: moduleLoadList,
  configurable: true,
  enumerable: true,
  writable: false
});

debugger;
// internalBindingWhitelist contains the name of internalBinding modules
// that are whitelisted for access via process.binding()... This is used
// to provide a transition path for modules that are being moved over to
// internalBinding.
const internalBindingWhitelist = new SafeSet([
  "async_wrap",
  "buffer",
  "cares_wrap",
  "config",
  "constants",
  "contextify",
  "crypto",
  "fs",
  "fs_event_wrap",
  "http_parser",
  "icu",
  "inspector",
  "js_stream",
  "natives",
  "os",
  "pipe_wrap",
  "process_wrap",
  "signal_wrap",
  "spawn_sync",
  "stream_wrap",
  "tcp_wrap",
  "tls_wrap",
  "tty_wrap",
  "udp_wrap",
  "url",
  "util",
  "uv",
  "v8",
  "zlib"
]);

// Set up process.binding() and process._linkedBinding().
{
  const bindingObj = ObjectCreate(null);

  process.binding = function binding(module) {
    debugger;
    module = String(module);
    // Deprecated specific process.binding() modules, but not all, allow
    // selective fallback to internalBinding for the deprecated ones.
    if (internalBindingWhitelist.has(module)) {
      return internalBinding(module);
    }
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(`No such module: ${module}`);
  };

  process._linkedBinding = function _linkedBinding(module) {
    module = String(module);
    let mod = bindingObj[module];
    if (typeof mod !== "object")
      mod = bindingObj[module] = getLinkedBinding(module);
    return mod;
  };
}

// Set up internalBinding() in the closure.
let internalBinding;
{
  const bindingObj = ObjectCreate(null);
  // eslint-disable-next-line no-global-assign
  internalBinding = function internalBinding(module) {
    let mod = bindingObj[module];
    if (typeof mod !== "object") {
      mod = bindingObj[module] = getInternalBinding(module);
      moduleLoadList.push(`Internal Binding ${module}`);
    }
    return mod;
  };
}

// Think of this as module.exports in this file even though it is not
// written in CommonJS style.
const loaderExports = {
  internalBinding,
  NativeModule,
  require: nativeModuleRequire
};

const loaderId = "internal/bootstrap/loaders";

// Set up NativeModule.
function NativeModule(id) {
  this.filename = `${id}.js`;
  this.id = id;
  this.exports = {};
  this.module = undefined;
  this.exportKeys = undefined;
  this.loaded = false;
  this.loading = false;
  this.canBeRequiredByUsers = !id.startsWith("internal/");
}

// To be called during pre-execution when --expose-internals is on.
// Enables the user-land module loader to access internal modules.
NativeModule.exposeInternals = function() {
  for (const [id, mod] of NativeModule.map) {
    // Do not expose this to user land even with --expose-internals.
    if (id !== loaderId) {
      mod.canBeRequiredByUsers = true;
    }
  }
};

debugger;

//native_module是一个c++内建模块， 在node_native_module_env.cc中定义
const { moduleIds, compileFunction } = internalBinding("native_module");

NativeModule.map = new Map();
for (let i = 0; i < moduleIds.length; ++i) {
  const id = moduleIds[i];
  const mod = new NativeModule(id);
  NativeModule.map.set(id, mod);
}

function nativeModuleRequire(id) {
  if (id === loaderId) {
    return loaderExports;
  }

  const mod = NativeModule.map.get(id);
  // Can't load the internal errors module from here, have to use a raw error.
  // eslint-disable-next-line no-restricted-syntax
  if (!mod) throw new TypeError(`Missing internal module '${id}'`);
  return mod.compile();
}

NativeModule.exists = function(id) {
  return NativeModule.map.has(id);
};

NativeModule.canBeRequiredByUsers = function(id) {
  const mod = NativeModule.map.get(id);
  return mod && mod.canBeRequiredByUsers;
};

// Allow internal modules from dependencies to require
// other modules from dependencies by providing fallbacks.
function requireWithFallbackInDeps(request) {
  if (!NativeModule.map.has(request)) {
    request = `internal/deps/${request}`;
  }
  return nativeModuleRequire(request);
}

// This is exposed for public loaders
NativeModule.prototype.compileForPublicLoader = function() {
  if (!this.canBeRequiredByUsers) {
    // No code because this is an assertion against bugs
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(`Should not compile ${this.id} for public use`);
  }
  this.compile();
  if (!this.exportKeys) {
    // When using --expose-internals, we do not want to reflect the named
    // exports from core modules as this can trigger unnecessary getters.
    const internal = this.id.startsWith("internal/");
    this.exportKeys = internal ? [] : ObjectKeys(this.exports);
  }
  this.getESMFacade();
  this.syncExports();
  return this.exports;
};

const getOwn = (target, property, receiver) => {
  return ObjectPrototypeHasOwnProperty(target, property)
    ? ReflectGet(target, property, receiver)
    : undefined;
};

NativeModule.prototype.getURL = function() {
  return `node:${this.id}`;
};

NativeModule.prototype.getESMFacade = function() {
  if (this.module) return this.module;
  const { ModuleWrap } = internalBinding("module_wrap");
  const url = this.getURL();
  const nativeModule = this;
  this.module = new ModuleWrap(
    url,
    undefined,
    [...this.exportKeys, "default"],
    function() {
      nativeModule.syncExports();
      this.setExport("default", nativeModule.exports);
    }
  );
  // Ensure immediate sync execution to capture exports now
  this.module.instantiate();
  this.module.evaluate(-1, false);
  return this.module;
};

// Provide named exports for all builtin libraries so that the libraries
// may be imported in a nicer way for ESM users. The default export is left
// as the entire namespace (module.exports) and updates when this function is
// called so that APMs and other behavior are supported.
NativeModule.prototype.syncExports = function() {
  const names = this.exportKeys;
  if (this.module) {
    for (let i = 0; i < names.length; i++) {
      const exportName = names[i];
      if (exportName === "default") continue;
      this.module.setExport(
        exportName,
        getOwn(this.exports, exportName, this.exports)
      );
    }
  }
};

NativeModule.prototype.compile = function() {
  if (this.loaded || this.loading) {
    return this.exports;
  }

  const id = this.id;
  this.loading = true;

  try {
    const requireFn = this.id.startsWith("internal/deps/")
      ? requireWithFallbackInDeps
      : nativeModuleRequire;

    const fn = compileFunction(id);
    fn(this.exports, requireFn, this, process, internalBinding, primordials);

    this.loaded = true;
  } finally {
    this.loading = false;
  }

  moduleLoadList.push(`NativeModule ${id}`);
  return this.exports;
};
debugger;

// This will be passed to internal/bootstrap/node.js.
return loaderExports;
