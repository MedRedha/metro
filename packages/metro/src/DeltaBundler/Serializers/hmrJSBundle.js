/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

const addParamsToDefineCall = require('../../lib/addParamsToDefineCall');
const getInlineSourceMappingURL = require('./helpers/getInlineSourceMappingURL');
const getSourceMapInfo = require('./helpers/getSourceMapInfo');
const path = require('path');
const url = require('url');

const {isJsModule, wrapModule} = require('./helpers/js');
const {fromRawMappings} = require('metro-source-map');

import type {EntryPointURL} from '../../HmrServer';
import type {ModuleMap} from '../../lib/bundle-modules/types.flow';
import type {DeltaResult, Graph, Module} from '../types.flow';

type Options = {
  +clientUrl: EntryPointURL,
  +createModuleId: string => number,
  +projectRoot: string,
};

function generateModules(
  sourceModules: Iterable<Module<>>,
  graph: Graph<>,
  options: Options,
): {|
  +modules: ModuleMap,
  +sourceMappingURLs: $ReadOnlyArray<string>,
  +sourceURLs: $ReadOnlyArray<string>,
|} {
  const modules = [];
  const sourceMappingURLs = [];
  const sourceURLs = [];

  for (const module of sourceModules) {
    if (isJsModule(module)) {
      const code = _prepareModule(module, graph, options);

      const mapInfo = getSourceMapInfo(module, {
        excludeSource: false,
      });

      sourceMappingURLs.push(
        getInlineSourceMappingURL(
          fromRawMappings([mapInfo]).toString(undefined, {
            excludeSource: false,
          }),
        ),
      );

      // Construct a bundle URL for this specific module
      options.clientUrl.pathname = path.relative(
        options.projectRoot,
        path.join(
          path.dirname(mapInfo.path),
          path.basename(mapInfo.path, path.extname(mapInfo.path)) + '.bundle',
        ),
      );

      sourceURLs.push(url.format(options.clientUrl));

      modules.push([options.createModuleId(module.path), code]);
    }
  }

  return {modules, sourceMappingURLs, sourceURLs};
}

function hmrJSBundle(
  delta: DeltaResult<>,
  graph: Graph<>,
  options: Options,
): {|
  +added: ModuleMap,
  +addedSourceMappingURLs: $ReadOnlyArray<string>,
  +addedSourceURLs: $ReadOnlyArray<string>,
  +deleted: $ReadOnlyArray<number>,
  +modified: ModuleMap,
  +modifiedSourceMappingURLs: $ReadOnlyArray<string>,
  +modifiedSourceURLs: $ReadOnlyArray<string>,
|} {
  const {
    modules: added,
    sourceMappingURLs: addedSourceMappingURLs,
    sourceURLs: addedSourceURLs,
  } = generateModules(delta.added.values(), graph, options);
  const {
    modules: modified,
    sourceMappingURLs: modifiedSourceMappingURLs,
    sourceURLs: modifiedSourceURLs,
  } = generateModules(delta.modified.values(), graph, options);

  return {
    added,
    modified,
    deleted: [...delta.deleted].map((path: string) =>
      options.createModuleId(path),
    ),
    addedSourceMappingURLs,
    addedSourceURLs,
    modifiedSourceMappingURLs,
    modifiedSourceURLs,
  };
}

function _prepareModule(
  module: Module<>,
  graph: Graph<>,
  options: Options,
): string {
  const code = wrapModule(module, {
    ...options,
    dev: true,
  });

  const inverseDependencies = _getInverseDependencies(module.path, graph);

  // Transform the inverse dependency paths to ids.
  const inverseDependenciesById = Object.create(null);
  Object.keys(inverseDependencies).forEach((path: string) => {
    inverseDependenciesById[options.createModuleId(path)] = inverseDependencies[
      path
    ].map(options.createModuleId);
  });

  return addParamsToDefineCall(code, inverseDependenciesById);
}

/**
 * Instead of adding the whole inverseDependncies object into each changed
 * module (which can be really huge if the dependency graph is big), we only
 * add the needed inverseDependencies for each changed module (we do this by
 * traversing upwards the dependency graph).
 */
function _getInverseDependencies(
  path: string,
  graph: Graph<>,
  inverseDependencies: {[key: string]: Array<string>} = {},
): {[key: string]: Array<string>} {
  // Dependency alredy traversed.
  if (path in inverseDependencies) {
    return inverseDependencies;
  }

  const module = graph.dependencies.get(path);
  if (!module) {
    return inverseDependencies;
  }

  inverseDependencies[path] = [];

  for (const inverse of module.inverseDependencies) {
    inverseDependencies[path].push(inverse);

    _getInverseDependencies(inverse, graph, inverseDependencies);
  }

  return inverseDependencies;
}

module.exports = hmrJSBundle;
