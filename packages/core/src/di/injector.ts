/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Type} from '../type';
import {stringify} from '../util';

import {resolveForwardRef} from './forward_ref';
import {InjectionToken} from './injection_token';
import {Inject, Optional, Self, SkipSelf} from './metadata';
import {ConstructorProvider, ExistingProvider, FactoryProvider, StaticClassProvider, StaticProvider, ValueProvider} from './provider';

const _THROW_IF_NOT_FOUND = new Object();
export const THROW_IF_NOT_FOUND = _THROW_IF_NOT_FOUND;

class _NullInjector implements Injector {
  get(token: any, notFoundValue: any = _THROW_IF_NOT_FOUND): any {
    if (notFoundValue === _THROW_IF_NOT_FOUND) {
      throw new Error(`NullInjectorError: No provider for ${stringify(token)}!`);
    }
    return notFoundValue;
  }
}

/**
 * @whatItDoes Injector interface
 * @howToUse
 * ```
 * const injector: Injector = ...;
 * injector.get(...);
 * ```
 *
 * @description
 * For more details, see the {@linkDocs guide/dependency-injection "Dependency Injection Guide"}.
 *
 * ### Example
 *
 * {@example core/di/ts/injector_spec.ts region='Injector'}
 *
 * `Injector` returns itself when given `Injector` as a token:
 * {@example core/di/ts/injector_spec.ts region='injectInjector'}
 *
 * @stable
 */
export abstract class Injector {
  static THROW_IF_NOT_FOUND = _THROW_IF_NOT_FOUND;
  static NULL: Injector = new _NullInjector();

  /**
   * Retrieves an instance from the injector based on the provided token.
   * If not found:
   * - Throws an error if no `notFoundValue` that is not equal to
   * Injector.THROW_IF_NOT_FOUND is given
   * - Returns the `notFoundValue` otherwise
   */
  abstract get<T>(token: Type<T>|InjectionToken<T>, notFoundValue?: T): T;
  /**
   * @deprecated from v4.0.0 use Type<T> or InjectionToken<T>
   * @suppress {duplicate}
   */
  abstract get(token: any, notFoundValue?: any): any;

  /**
   * Create a new Injector which is configure using `StaticProvider`s.
   *
   * ### Example
   *
   * {@example core/di/ts/provider_spec.ts region='ConstructorProvider'}
   */
  static create(providers: StaticProvider[], parent?: Injector): Injector {
    return new StaticInjector(providers, parent);
  }
}



const IDENT = function<T>(value: T): T {
  return value;
};
const EMPTY = <any[]>[];
const CIRCULAR = IDENT;
const MULTI_PROVIDER_FN = function(): any[] {
  return Array.prototype.slice.call(arguments);
};
const GET_PROPERTY_NAME = {} as any;
const USE_CLASS = getClosureSafeProperty<StaticClassProvider>(
    {provide: String, useClass: GET_PROPERTY_NAME, deps: []});
const USE_VALUE =
    getClosureSafeProperty<ValueProvider>({provide: String, useValue: GET_PROPERTY_NAME});
const USE_FACTORY =
    getClosureSafeProperty<FactoryProvider>({provide: String, useFactory: GET_PROPERTY_NAME});
const USE_EXISTING =
    getClosureSafeProperty<ExistingProvider>({provide: String, useExisting: GET_PROPERTY_NAME});
const PROVIDE =
    getClosureSafeProperty<StaticProvider>({provide: GET_PROPERTY_NAME, useValue: null});
const MULTI = getClosureSafeProperty<ConstructorProvider>(
    {provide: String, multi: GET_PROPERTY_NAME, deps: EMPTY});
const NG_TOKEN_PATH = 'ngTokenPath';
const NG_TEMP_TOKEN_PATH = 'ngTempTokenPath';
const ID_EXPANDO = '__symbol_angular_id_' + new Date().getTime() + '__';
const OPT_OPTIONAL = 1;
const OPT_CHECK_SELF = 2;
const OPT_CHECK_PARENT = 4;
const OPT_DEFAULT = OPT_CHECK_PARENT | OPT_CHECK_SELF;
const NULL_INJECTOR = Injector.NULL;
const NEW_LINE = /\n/gm;
const NO_NEW_LINE = 'ɵ';

export class StaticInjector implements Injector {
  readonly parent: Injector;

  private _records: Records;

  constructor(providers: StaticProvider[], parent: Injector = NULL_INJECTOR) {
    this.parent = parent;
    const records = this._records = <Records>{};
    const id = getId(Injector);
    records[id] = <Record>{token: Injector, fn: IDENT, deps: EMPTY, value: this, useNew: false};
    recursivelyProcessProviders(records, providers);
  }

  get<T>(token: Type<T>|InjectionToken<T>, notFoundValue?: T): T;
  get(token: any, notFoundValue?: any): any;
  get(token: any, notFoundValue?: any): any {
    const record = this._records[getId(token)];
    try {
      return tryResolveToken(token, record, this._records, this.parent, notFoundValue);
    } catch (e) {
      const tokenPath: any[] = e[NG_TEMP_TOKEN_PATH];
      let message: string = e.message;
      message = message && message.charAt(0) === NO_NEW_LINE ? message.substr(1) : '\n' + message;
      const error = staticError(message, tokenPath);
      e.message = error.message;
      e[NG_TOKEN_PATH] = tokenPath;
      e[NG_TEMP_TOKEN_PATH] = null;
      throw e;
    }
  }

  toString() {
    const tokens = <string[]>[], records = this._records;
    for (let key in records) {
      if (records.hasOwnProperty(key)) {
        tokens.push(stringify(records[key].token));
      }
    }
    return `StaticInjector[${tokens.join(', ')}]`;
  }
}

type SupportedProvider =
    ValueProvider | ExistingProvider | StaticClassProvider | ConstructorProvider | FactoryProvider;

interface Record {
  token: any;
  fn: Function;
  useNew: boolean;
  deps: DependencyRecord[];
  value: any;
}

interface DependencyRecord {
  id: string;
  token: any;
  options: number;
}

interface Records {
  [key: string]: Record;
}


type TokenPath = Array<any>;

function resolveProvider(provider: SupportedProvider): Record {
  const deps = computeDeps(provider);
  let fn: Function = IDENT;
  let value: any = EMPTY;
  let useNew: boolean = false;
  let provide = resolveForwardRef(provider.provide);
  if (USE_VALUE in provider) {
    value = (provider as ValueProvider).useValue;
  } else if (USE_FACTORY in provider) {
    fn = (provider as FactoryProvider).useFactory;
  } else if (USE_EXISTING in provider) {
    // Just use IDENT
  } else if (USE_CLASS in provider) {
    useNew = true;
    fn = resolveForwardRef((provider as StaticClassProvider).useClass);
  } else if (typeof provide == 'function') {
    useNew = true;
    fn = provide;
  } else {
    throw staticError(
        'StaticProvider does not have [useValue|useFactory|useExisting|useClass] or [provide] is not newable',
        provider);
  }
  return {token: provide, deps, fn, useNew, value};
}

function multiProviderMixError(token: any) {
  return staticError('Cannot mix multi providers and regular providers', token);
}

function recursivelyProcessProviders(records: Records, provider: StaticProvider) {
  if (provider) {
    provider = resolveForwardRef(provider);
    if (provider instanceof Array) {
      // if we have an array recurse into the array
      for (let i = 0; i < provider.length; i++) {
        recursivelyProcessProviders(records, provider[i]);
      }
    } else if (typeof provider === 'function') {
      // Functions were supported in ReflectiveInjector, but are not here. For safety give useful
      // error messages
      throw staticError('Function/Class not supported', provider);
    } else if (provider && typeof provider === 'object' && PROVIDE in provider) {
      // At this point we have what looks like a provider: {provide: ?, ....}
      let token = resolveForwardRef(provider.provide), id = getId(token);
      const resolvedProvider = resolveProvider(provider);
      if ((provider as any)[MULTI] === true) {
        // This is a multi provider.
        let multiProvider: Record|undefined = records[id];
        if (multiProvider) {
          if (multiProvider.fn !== MULTI_PROVIDER_FN) {
            throw multiProviderMixError(token);
          }
        } else {
          // Create a placeholder factory which will look up the constituents of the multi provider.
          multiProvider = records[id] = <Record>{
            token: provider.provide,
            deps: [],
            useNew: false,
            fn: MULTI_PROVIDER_FN,
            value: EMPTY
          };
        }
        // Munge the ID by prefixing the multi index which the main provider can retrieve.
        id = '_' + multiProvider.deps.length + '_' + id;
        multiProvider.deps.push({id, token, options: OPT_DEFAULT});
      }
      if (records.hasOwnProperty(id) && records[id].fn == MULTI_PROVIDER_FN) {
        throw multiProviderMixError(token);
      }
      records[id] = resolvedProvider;
    } else {
      throw staticError('Unexpected provider', provider);
    }
  }
}

function tryResolveToken(
    token: any, record: Record | undefined, records: Records, parent: Injector,
    notFoundValue: any): any {
  try {
    return resolveToken(token, record, records, parent, notFoundValue);
  } catch (e) {
    // ensure that 'e' is of type Error.
    if (!(e instanceof Error)) {
      e = new Error(e);
    }
    const path: any[] = e[NG_TEMP_TOKEN_PATH] = e[NG_TEMP_TOKEN_PATH] || [];
    path.unshift(token || record !.token);
    if (record && record.value == CIRCULAR) {
      // Reset the Circular flag.
      record.value = EMPTY;
    }
    throw e;
  }
}

function resolveToken(
    token: any, record: Record | undefined, records: Records, parent: Injector,
    notFoundValue: any): any {
  let value;
  if (record) {
    // If we don't have a record, this implies that we don't own the provider hence don't know how
    // to resolve it.
    value = record.value;
    if (value == CIRCULAR) {
      throw Error(NO_NEW_LINE + 'Circular dependency');
    } else if (value === EMPTY) {
      record.value = CIRCULAR;
      let obj = undefined, useNew = record.useNew, fn = record.fn, depRecords = record.deps,
          deps = EMPTY;
      if (depRecords.length) {
        deps = [];
        for (let i = 0; i < depRecords.length; i++) {
          const depRecord: DependencyRecord = depRecords[i], options = depRecord.options,
                           childRecord =
                               options & OPT_CHECK_SELF ? records[depRecord.id] : undefined;
          deps.push(tryResolveToken(
              // Current Token to resolve
              depRecord.token,
              // A record which describes how to resolve the token.
              // If undefined, this means we don't have such a record
              childRecord,
              // Other records we know about.
              records,
              // If we don't know how to resolve dependency and we should not check parent for it,
              // than pass in Null injector.
              !childRecord && !(options & OPT_CHECK_PARENT) ? NULL_INJECTOR : parent,
              options & OPT_OPTIONAL ? null : Injector.THROW_IF_NOT_FOUND));
        }
      }
      if (useNew) {
        obj = Object.create(fn.prototype);
      }
      value = fn.apply(obj, deps);
      if (useNew && value === undefined) {
        // if this was a new and it did not return any value (most dont) than return instance.
        value = obj;
      }
      record.value = value;
    }
  } else {
    value = parent.get(token, notFoundValue);
  }
  return value;
}


let idCounter = 0;

function getId(obj: any): string {
  if (!obj) {
    throw staticError('Token must be truthy', obj);
  }
  const type = typeof obj;
  let id;
  if (type && (type == 'function' || type == 'object')) {
    id = obj.hasOwnProperty(ID_EXPANDO) && obj[ID_EXPANDO];
    if (!id) {
      id = type + '_' + idCounter++;
      obj[ID_EXPANDO] = id;
    }
  } else {
    id = type + '_' + obj;
  }
  return id;
}

function computeDeps(provider: StaticProvider): DependencyRecord[] {
  let deps: DependencyRecord[] = EMPTY;
  const providerDeps: any[] =
      (provider as ExistingProvider & StaticClassProvider & ConstructorProvider).deps;
  if (providerDeps && providerDeps.length) {
    deps = [];
    for (let i = 0; i < providerDeps.length; i++) {
      let options = OPT_DEFAULT;
      let token = resolveForwardRef(providerDeps[i]);
      if (token instanceof Array) {
        for (let j = 0, annotations = token; j < annotations.length; j++) {
          const annotation = annotations[j];
          if (annotation instanceof Optional || annotation == Optional) {
            options = options | OPT_OPTIONAL;
          } else if (annotation instanceof SkipSelf || annotation == SkipSelf) {
            options = options & ~OPT_CHECK_SELF;
          } else if (annotation instanceof Self || annotation == Self) {
            options = options & ~OPT_CHECK_PARENT;
          } else if (annotation instanceof Inject) {
            token = (annotation as Inject).token;
          } else {
            token = resolveForwardRef(annotation);
          }
        }
      }
      deps.push({token, id: getId(token), options});
    }
  } else if (USE_EXISTING in provider) {
    const token = resolveForwardRef((provider as ExistingProvider).useExisting);
    deps = [{token, id: getId(token), options: OPT_DEFAULT}];
  } else if (!providerDeps && !(USE_VALUE in provider)) {
    // useValue & useExisting are the only ones which are exempt from deps all others need it.
    throw staticError('\'deps\' required', provider);
  }
  return deps;
}

function staticError(text: string, obj: any): Error {
  let context = stringify(obj);
  if (obj instanceof Array) {
    context = obj.map(stringify).join(' -> ');
  } else if (typeof obj === 'object') {
    let parts = <string[]>[];
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        let value = obj[key];
        parts.push(
            key + ':' + (typeof value === 'string' ? JSON.stringify(value) : stringify(value)));
      }
    }
    context = `{${parts.join(', ')}}`;
  }
  return new Error(`StaticInjectorError[${context}]: ${text.replace(NEW_LINE, '\n  ')}`);
}

function getClosureSafeProperty<T>(objWithPropertyToExtract: T): string {
  for (let key in objWithPropertyToExtract) {
    if (objWithPropertyToExtract[key] === GET_PROPERTY_NAME) {
      return key;
    }
  }
  throw Error('!prop');
}
